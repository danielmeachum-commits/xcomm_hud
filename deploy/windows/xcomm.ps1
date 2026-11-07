<#
.SYNOPSIS
  Run xcomm_hud on a Windows host - the Windows counterpart of deploy/bundle/xcomm.

.DESCRIPTION
  One host runs the stack in a Podman machine (WSL2); every other machine on
  the local network opens it in a browser at http://<this-host>/.

  The stack publishes on 127.0.0.1:18080 (Podman on Windows only ever binds
  published ports to localhost), and a Windows port proxy that install.ps1
  sets up forwards port 80 on every interface to it. That's what lets other
  machines reach it, and why the machine can stay rootless.

    xcomm.ps1 start [-OpenBrowser]   start the machine and the stack
    xcomm.ps1 stop                   stop the stack (data is kept)
    xcomm.ps1 restart
    xcomm.ps1 status                 containers, health, URLs, version
    xcomm.ps1 logs [service]         follow logs (api, webui, postgres, minio)
    xcomm.ps1 load-images [file]     load a saved images file
    xcomm.ps1 update                 with internet: pull the latest code from
                                     GitHub, build it here, and switch to it
    xcomm.ps1 update <file>          update to a newer images file instead
                                     (both back up the database first;
                                     -SkipBackup to not)
    xcomm.ps1 admin-password         print the initial admin login

  To update from an update package, double-click its update.cmd instead: it
  also brings this checkout (and this script) up to date, then runs update.

  Written for Windows PowerShell 5.1, which every supported Windows has.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = 'help',
  [Parameter(Position = 1)][string]$Argument,
  [switch]$OpenBrowser,
  [switch]$SkipBackup
)

$ErrorActionPreference = 'Stop'

$RepoRoot    = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$StateDir    = Join-Path $RepoRoot '.bundle'
$ImagesDir   = Join-Path $StateDir 'images'
$EnvFile     = Join-Path $StateDir 'xcomm.env'
$ComposeFile = Join-Path $RepoRoot 'deploy\bundle\compose.prod.yml'
$ComposeLog  = Join-Path $StateDir 'compose.log'
$BackupDir   = Join-Path $StateDir 'backups'
$GitExe      = Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
# The app images (deploy/bundle/xcomm uses the same names).
$ApiImage    = 'localhost/xcomm-hud-api'
$WebuiImage  = 'localhost/xcomm-hud-webui'
$MinioImage  = 'localhost/xcomm-hud-minio'
$Project     = 'xcomm-hud'
# xcomm's own Podman machine. Never the default one: a host may already have a
# podman-machine-default from another Podman install, possibly a different
# version, and the kit must neither depend on it nor touch its containers.
$Machine     = 'xcomm'
# Where the stack listens on this machine. Port 80 is the proxy in front of it.
$InternalPort = if ($env:XCOMM_INTERNAL_PORT) { [int]$env:XCOMM_INTERNAL_PORT } else { 18080 }
$HealthUrl    = "http://127.0.0.1:$InternalPort/api/be/healthz"
# Kit tools live outside the checkout, so `git pull` never touches them.
$ToolsDir     = if ($env:XCOMM_TOOLS) { $env:XCOMM_TOOLS } else { 'C:\xcomm\bin' }

function Write-Ok([string]$Message)   { Write-Host "OK  $Message" -ForegroundColor Green }
function Write-Info([string]$Message) { Write-Host "..  $Message" -ForegroundColor DarkGray }
function Write-Warn([string]$Message) { Write-Host "!   $Message" -ForegroundColor Yellow }
function Stop-WithError([string]$Message) {
  Write-Host "X   $Message" -ForegroundColor Red
  exit 1
}

function Get-PodmanPath {
  $cmd = Get-Command podman.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in @(
      (Join-Path $env:ProgramFiles 'Podman\podman.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'))) {
    if (Test-Path $candidate) { return $candidate }
  }
  Stop-WithError 'Podman is not installed. Run the kit''s install.cmd first.'
}

# Run a native program and capture its output without PowerShell 5.1 turning
# anything it writes to stderr into a terminating error (it does that under
# $ErrorActionPreference = 'Stop' when stderr is redirected).
function Invoke-Native {
  param([string]$Exe, [string[]]$ArgumentList)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $Exe @ArgumentList 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  return [pscustomobject]@{ Code = $code; Output = @($output) }
}

# Podman 6's container networking (netavark with nftables) needs kernel modules
# that WSL kernels before 6.18 don't have. WSL 2.7.5 is the first release with
# that kernel; on WSL 2.6.1 every container on a network fails with
#   nftables error: "nft" did not return successfully while applying ruleset
# (podman-container-tools/podman#25201, containers/netavark#1539).
$MinWslVersion = [version]'2.7.5'

# The installed WSL version, or $null. wsl.exe writes UTF-16, which Windows
# PowerShell 5.1 shows with a NUL between every character, and its labels are
# translated - so ask for UTF-8, strip any NULs, and take the first version
# number (the first line is the WSL version itself).
function Get-WslVersion {
  $env:WSL_UTF8 = '1'
  $r = Invoke-Native 'wsl.exe' @('--version')
  if ($r.Code -ne 0) { return $null }
  $text = ($r.Output -join "`n") -replace "`0", ''
  if ($text -match '(\d+\.\d+\.\d+(?:\.\d+)?)') { return [version]$Matches[1] }
  return $null
}

$Podman = Get-PodmanPath
# Every podman command below - ps, load, compose - goes to xcomm's machine,
# whatever the user's default connection is.
$env:CONTAINER_CONNECTION = $Machine

function Set-ComposeEnvironment {
  # Read by deploy/bundle/compose.prod.yml.
  $env:XCOMM_ENV_FILE = $EnvFile
  $env:XCOMM_WEB_PORT = "$InternalPort"
  # `podman compose` runs this provider and points it at the machine's socket.
  $compose = Join-Path $ToolsDir 'docker-compose.exe'
  if (-not (Test-Path $compose)) { Stop-WithError "docker-compose.exe not found at $compose." }
  $env:PODMAN_COMPOSE_PROVIDER = $compose
  $env:PODMAN_COMPOSE_WARNING_LOGS = 'false'
}

function Invoke-Compose([string[]]$ArgumentList) {
  Set-ComposeEnvironment
  $all = @('compose', '-p', $Project, '-f', $ComposeFile) + $ArgumentList
  return Invoke-Native $Podman $all
}

# ---------- the Podman machine ----------

function Get-MachineState {
  $r = Invoke-Native $Podman @('machine', 'inspect', '--format', '{{.State}}', $Machine)
  if ($r.Code -ne 0) { return 'missing' }
  return ($r.Output | Select-Object -Last 1).Trim()
}

# The named pipe the machine's API is served on, e.g. \\.\pipe\podman-machine-default.
# `podman compose` points docker-compose at it.
function Get-MachinePipe {
  $r = Invoke-Native $Podman @('machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanPipe.Path}}', $Machine)
  if ($r.Code -ne 0) { return $null }
  return ($r.Output | Select-Object -Last 1).Trim()
}

function Test-Pipe([string]$Path) {
  if (-not $Path) { return $false }
  # Test-Path is unreliable on named pipes; list them instead.
  $pipes = [IO.Directory]::GetFiles('\\.\pipe\')
  return ($pipes -contains $Path)
}

function Invoke-MachineCommand([string]$Verb) {
  $r = Invoke-Native $Podman @('machine', $Verb, $Machine)
  if ($r.Code -ne 0) {
    $r.Output | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" }
    Stop-WithError "podman machine $Verb $Machine failed."
  }
}

# "Running" is not enough: the API pipe only exists if `podman machine start`
# made it. WSL can report the machine's distro as running without that - e.g.
# left up by `podman machine init` - and then docker-compose fails with
# "failed to connect to the docker API at npipe:////./pipe/podman-machine-default".
function Start-Machine {
  $wsl = Get-WslVersion
  if ($wsl -and $wsl -lt $MinWslVersion) {
    Stop-WithError ("WSL $wsl is too old for Podman's container networking (needs $MinWslVersion or later). " +
      'Run C:\xcomm\kit\install.cmd again - it upgrades WSL from the kit.')
  }
  $state = Get-MachineState
  if ($state -eq 'missing') { Stop-WithError "No Podman machine named '$Machine'. Run the kit's install.cmd first." }
  $pipe = Get-MachinePipe
  if ($state -eq 'running' -and (Test-Pipe $pipe)) { return }
  if ($state -eq 'running') {
    Write-Info "The Podman machine is running without its API ($pipe); restarting it..."
    Invoke-MachineCommand 'stop'
  } else {
    Write-Info 'Starting the Podman machine...'
  }
  Invoke-MachineCommand 'start'
  $pipe = Get-MachinePipe
  if (-not (Test-Pipe $pipe)) {
    Stop-WithError "The Podman machine started, but its API pipe ($pipe) isn't there."
  }
}

# ---------- images ----------

# Every image the stack runs, read from the compose file so the list lives in
# one place.
function Get-StackImages {
  Get-Content $ComposeFile | ForEach-Object {
    if ($_ -match '^\s+image:\s+(\S+)') { $Matches[1] }
  }
}

function Get-MissingImages {
  foreach ($image in Get-StackImages) {
    $r = Invoke-Native $Podman @('image', 'exists', $image)
    if ($r.Code -ne 0) { $image }
  }
}

function Import-Images([string]$File) {
  if (-not $File) {
    $latest = Get-ChildItem -Path $ImagesDir -Filter 'xcomm-*.tar' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { Stop-WithError "No saved images in $ImagesDir." }
    $File = $latest.FullName
  }
  Write-Info "Loading images from $File (a few minutes)..."
  $r = Invoke-Native $Podman @('load', '-q', '-i', $File)
  if ($r.Code -ne 0) {
    $r.Output | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" }
    Stop-WithError 'Loading the images failed.'
  }
  Write-Ok "Loaded $(Split-Path $File -Leaf)."
}

function Get-RunningRevision {
  $r = Invoke-Native $Podman @('image', 'inspect', '--format',
    '{{ index .Labels "org.opencontainers.image.revision" }}', 'localhost/xcomm-hud-api:current')
  if ($r.Code -ne 0) { return 'unknown' }
  return ($r.Output | Select-Object -Last 1).Trim()
}

# ---------- health and addresses ----------

# Through the web UI, so a pass means the whole chain answers:
# browser -> webui -> api -> postgres.
function Test-Healthy {
  try {
    $resp = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3
    return ($resp.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Wait-Healthy {
  for ($i = 0; $i -lt 90; $i++) {
    if (Test-Healthy) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Get-LanAddresses {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    $_.InterfaceAlias -notlike 'vEthernet*' -and
    $_.InterfaceAlias -notlike '*WSL*'
  } | Select-Object -ExpandProperty IPAddress
}

function Show-Urls {
  Write-Host '  On this machine:      http://localhost'
  $any = $false
  foreach ($ip in Get-LanAddresses) {
    Write-Host "  From other machines:  http://$ip"
    $any = $true
  }
  if (-not $any) { Write-Host '  (no network connection - only this machine can reach it)' }
}

# ---------- commands ----------

# Start the stack and wait for it to answer. $false if it never does (after
# printing the API's recent logs); stops the script on anything else.
function Start-Stack {
  if (-not (Test-Path $EnvFile)) { Stop-WithError "Not set up yet ($EnvFile is missing). Run the kit's install.cmd." }
  Start-Machine
  $missing = @(Get-MissingImages)
  if ($missing.Count -gt 0) {
    Write-Info "Images not loaded yet: $($missing -join ', ')"
    Import-Images $null
    $missing = @(Get-MissingImages)
    if ($missing.Count -gt 0) { Stop-WithError "Still missing after loading: $($missing -join ', ')" }
  }
  Write-Info 'Starting xcomm_hud...'
  $r = Invoke-Compose @('up', '-d')
  $r.Output | Set-Content -Path $ComposeLog
  if ($r.Code -ne 0) {
    $r.Output | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" }
    Stop-WithError "Couldn't start the containers (full output: $ComposeLog)."
  }
  if (-not (Wait-Healthy)) {
    Write-Warn 'Still not answering after 3 minutes. Recent API logs:'
    (Invoke-Compose @('logs', '--tail', '30', 'api')).Output | ForEach-Object { Write-Host "    $_" }
    return $false
  }
  return $true
}

function Invoke-Start {
  if (-not (Start-Stack)) { exit 1 }
  Write-Ok "xcomm_hud is up ($(Get-RunningRevision))."
  Show-Urls
  if ($OpenBrowser) { Start-Process 'http://localhost' }
}

# ---------- update ----------

function Get-StackContainer([string]$Service) {
  $r = Invoke-Native $Podman @('ps', '--filter', "label=com.docker.compose.project=$Project",
    '--filter', "label=com.docker.compose.service=$Service", '--format', '{{.Names}}')
  if ($r.Code -ne 0) { return $null }
  return ($r.Output | Where-Object { $_.Trim() } | Select-Object -First 1)
}

# A full pg_dump (custom format) of the database into .bundle\backups, taken
# before an update migrates it. A migration can't be undone by loading the
# old images again, so this file is the way back. Restore it with:
#   podman cp <file> <postgres container>:/tmp/restore.dump
#   podman exec <postgres container> sh -c 'pg_restore --clean --if-exists -U $POSTGRES_USER -d $POSTGRES_DB /tmp/restore.dump'
function Backup-Database([string]$Label) {
  # Postgres alone is enough for a dump; this starts it if the stack is down.
  $r = Invoke-Compose @('up', '-d', 'postgres')
  if ($r.Code -ne 0) {
    $r.Output | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" }
    return $null
  }
  $container = $null
  for ($i = 0; $i -lt 60; $i++) {
    $container = Get-StackContainer 'postgres'
    if ($container) {
      $ready = Invoke-Native $Podman @('exec', $container, 'sh', '-c', 'pg_isready -q -U $POSTGRES_USER -d $POSTGRES_DB')
      if ($ready.Code -eq 0) { break }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $container) { return $null }
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $dest = Join-Path $BackupDir "xcomm-$Label-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
  $inside = '/tmp/xcomm-update-backup.dump'
  # No double quotes inside: Windows PowerShell 5.1 mangles them in arguments
  # to native programs. The user and database names never contain spaces.
  $r = Invoke-Native $Podman @('exec', $container, 'sh', '-c',
    ('pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f ' + $inside))
  if ($r.Code -ne 0) {
    $r.Output | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" }
    return $null
  }
  $r = Invoke-Native $Podman @('cp', "${container}:$inside", $dest)
  Invoke-Native $Podman @('exec', $container, 'rm', '-f', $inside) | Out-Null
  if ($r.Code -ne 0 -or -not (Test-Path $dest) -or (Get-Item $dest).Length -eq 0) {
    $r.Output | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" }
    return $null
  }
  return $dest
}

# Remove app images other than the running revision: each revision is ~2 GB
# inside the Podman machine. Only after the new one is up, so a failed update
# still has the old images to go back to.
function Remove-OldImages([string]$Keep) {
  $r = Invoke-Native $Podman @('images', '--format', '{{.Repository}}:{{.Tag}}',
    '--filter', 'reference=localhost/xcomm-hud-*')
  if ($r.Code -ne 0) { return }
  foreach ($ref in $r.Output) {
    $tag = ($ref.Trim() -split ':')[-1]
    if ($tag -and $tag -ne 'current' -and $tag -ne $Keep -and $tag -ne '<none>') {
      Invoke-Native $Podman @('rmi', $ref.Trim()) | Out-Null
    }
  }
  Invoke-Native $Podman @('image', 'prune', '-f') | Out-Null
}

# Keep a copy of the images file in .bundle\images (the newest two), so a
# fresh Podman machine starts from this version, not the one installed first.
function Save-ImagesCopy([string]$File) {
  New-Item -ItemType Directory -Force -Path $ImagesDir | Out-Null
  $dest = Join-Path $ImagesDir (Split-Path $File -Leaf)
  if ((Resolve-Path $File).Path -ne $dest -and -not (Test-Path $dest)) {
    Write-Info "Keeping a copy in $ImagesDir..."
    Copy-Item $File $dest
  }
  Get-ChildItem -Path $ImagesDir -Filter 'xcomm-*.tar' | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 2 | Remove-Item -Force
}

# The backup every update takes before it changes anything. Stops the script
# (having changed nothing) if it fails.
function Invoke-PreUpdateBackup([string]$Label) {
  if ($SkipBackup) {
    Write-Warn 'Skipping the database backup (-SkipBackup).'
    return
  }
  Write-Info 'Backing up the database...'
  $backup = Backup-Database $Label
  if (-not $backup) {
    Stop-WithError 'The database backup failed, so nothing was changed. Run again with -SkipBackup to update without one.'
  }
  Write-Ok "Database backed up to $backup"
}

# Once the new images carry the :current tags: restart onto them, check they
# answer, then clear out the old ones.
function Complete-Update([string]$Old) {
  $new = Get-RunningRevision
  Invoke-Stop
  if (-not (Start-Stack)) {
    Write-Warn "The new version ($new) didn't come up. The old images are still here and the"
    Write-Warn 'database backup is above. Send the logs (xcomm.ps1 logs api) to whoever supports xcomm.'
    exit 1
  }
  Write-Ok "Updated: $Old -> $new."
  Remove-OldImages $new
  Show-Urls
  if ($OpenBrowser) { Start-Process 'http://localhost' }
}

function Invoke-Git([string[]]$ArgumentList) {
  return Invoke-Native $GitExe (@('-C', $RepoRoot) + $ArgumentList)
}

# Build the app images from this checkout - what deploy/bundle/xcomm build
# does on Linux. Needs internet (base images, npm, PyPI). Each image is tagged
# with the revision first; the :current tags the stack runs move only once
# everything built, so a failed build leaves the running version as it was.
function Build-Images([string]$Rev) {
  $pinLine = Select-String -Path (Join-Path $RepoRoot 'deploy\bundle\xcomm') -Pattern '^MINIO_PIN=(\S+)'
  if (-not $pinLine) { Stop-WithError 'No MINIO_PIN in deploy\bundle\xcomm.' }
  $minioPin = $pinLine.Matches[0].Groups[1].Value
  $upstream = @(Get-StackImages | Where-Object { $_ -notlike 'localhost/*' }) + $minioPin
  foreach ($image in $upstream) {
    Write-Info "Pulling $image..."
    $r = Invoke-Native $Podman @('pull', '-q', $image)
    if ($r.Code -ne 0) {
      $r.Output | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" }
      Stop-WithError "Couldn't pull $image. Nothing was changed."
    }
  }
  foreach ($part in @(@{ Dir = 'api'; Repo = $ApiImage }, @{ Dir = 'webui'; Repo = $WebuiImage })) {
    Write-Info "Building $($part.Dir) ($Rev) - several minutes..."
    $r = Invoke-Native $Podman @('build', '--target', 'prod',
      '--label', "org.opencontainers.image.revision=$Rev",
      '-t', "$($part.Repo):$Rev", (Join-Path $RepoRoot $part.Dir))
    if ($r.Code -ne 0) {
      $r.Output | Select-Object -Last 25 | ForEach-Object { Write-Host "    $_" }
      Stop-WithError "Building $($part.Dir) failed. Nothing was changed; xcomm is still on the old version."
    }
  }
  foreach ($pair in @(@($minioPin, "${MinioImage}:current"),
                      @("${ApiImage}:$Rev", "${ApiImage}:current"),
                      @("${WebuiImage}:$Rev", "${WebuiImage}:current"))) {
    $r = Invoke-Native $Podman @('tag', $pair[0], $pair[1])
    if ($r.Code -ne 0) { Stop-WithError "Couldn't tag $($pair[1])." }
  }
  Write-Ok "Built $Rev."
}

# `update` with no file, step 1: bring the checkout up to date from GitHub,
# then hand over to the NEW xcomm.ps1 for the rest, so a fix to the update
# itself takes effect in the same run.
function Invoke-OnlineUpdate {
  if (-not (Test-Path $GitExe)) { Stop-WithError "Git isn't installed ($GitExe)." }
  $r = Invoke-Git @('status', '--porcelain', '--untracked-files=no')
  if ($r.Code -ne 0) { Stop-WithError "$RepoRoot isn't a git checkout." }
  if (($r.Output -join '').Trim()) {
    $r.Output | ForEach-Object { Write-Host "    $_" }
    Stop-WithError "$RepoRoot has local changes (above), so nothing was updated."
  }
  $branch = ((Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')).Output | Select-Object -Last 1).Trim()
  if ($branch -eq 'HEAD') { Stop-WithError "$RepoRoot isn't on a branch, so there's nothing to update from." }
  Write-Info "Fetching $branch from GitHub..."
  $r = Invoke-Git @('fetch', '-q', 'origin', $branch)
  if ($r.Code -ne 0) {
    $r.Output | Select-Object -Last 5 | ForEach-Object { Write-Host "    $_" }
    Stop-WithError "Couldn't reach GitHub. Without internet, use an update package (update.cmd) instead."
  }
  $r = Invoke-Git @('merge', '-q', '--ff-only', "origin/$branch")
  if ($r.Code -ne 0) {
    $r.Output | Select-Object -Last 5 | ForEach-Object { Write-Host "    $_" }
    Stop-WithError "Couldn't fast-forward $branch to GitHub's (it has commits GitHub doesn't)."
  }
  Write-Ok "Code at $(Get-CheckoutRevision) ($branch)."
  $childArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, 'update-build')
  if ($SkipBackup) { $childArgs += '-SkipBackup' }
  if ($OpenBrowser) { $childArgs += '-OpenBrowser' }
  & powershell.exe @childArgs
  exit $LASTEXITCODE
}

function Get-CheckoutRevision {
  return ((Invoke-Git @('rev-parse', '--short', 'HEAD')).Output | Select-Object -Last 1).Trim()
}

# `update` with no file, step 2 (run by the freshly pulled xcomm.ps1).
function Invoke-UpdateBuild {
  Start-Machine
  $old = Get-RunningRevision
  $rev = Get-CheckoutRevision
  if ($old -eq $rev) {
    Write-Ok "Already up to date ($rev)."
    return
  }
  Write-Info "Updating xcomm_hud from $old to $rev (building here takes 10-20 minutes)."
  Invoke-PreUpdateBackup "before-$rev-from-$old"
  # Building doesn't touch the running containers; only the restart does.
  Build-Images $rev
  Complete-Update $old
}

function Invoke-Update {
  if (-not (Test-Path $EnvFile)) { Stop-WithError "Not set up yet ($EnvFile is missing). Run the kit's install.cmd." }
  if (-not $Argument) {
    Invoke-OnlineUpdate
    return
  }
  $file = $Argument
  if (-not (Test-Path $file)) { Stop-WithError "No such file: $file" }
  $file = (Resolve-Path $file).Path
  Start-Machine
  $old = Get-RunningRevision
  $new = if ((Split-Path $file -Leaf) -match '^xcomm-([0-9a-f]+)\.tar$') { $Matches[1] } else { 'new' }
  Write-Info "Updating xcomm_hud from $old to $new."
  Invoke-PreUpdateBackup "before-$new-from-$old"
  # While the old version keeps running: loading only moves the :current tags,
  # and running containers keep the images they started from. A failed load
  # leaves everything as it was.
  Import-Images $file
  Save-ImagesCopy $file
  Complete-Update $old
}

function Invoke-Stop {
  Write-Info 'Stopping xcomm_hud (data is kept)...'
  $r = Invoke-Compose @('down')
  $r.Output | Set-Content -Path $ComposeLog
  if ($r.Code -ne 0) { Stop-WithError "Couldn't stop cleanly (see $ComposeLog)." }
  Write-Ok 'Stopped.'
}

function Invoke-Status {
  Write-Host "xcomm_hud  version $(Get-RunningRevision)  -  Podman machine '$Machine': $(Get-MachineState)"
  $r = Invoke-Native $Podman @('ps', '-a', '--filter', "label=com.docker.compose.project=$Project",
    '--format', '{{.Names}}  {{.Status}}')
  if ($r.Code -ne 0 -or -not ($r.Output -join '').Trim()) {
    Write-Host '  not running - xcomm.ps1 start'
    return
  }
  $r.Output | ForEach-Object { Write-Host "  $_" }
  if (Test-Healthy) {
    Write-Ok 'Answering.'
    Show-Urls
  } else {
    Write-Warn "Not answering on $HealthUrl yet."
  }
}

function Invoke-Logs {
  Set-ComposeEnvironment
  $logArgs = @('compose', '-p', $Project, '-f', $ComposeFile, 'logs', '-f', '--tail', '100')
  if ($Argument) { $logArgs += $Argument }
  & $Podman @logArgs
}

function Invoke-AdminPassword {
  if (-not (Test-Path $EnvFile)) { Stop-WithError 'Not set up yet - run the kit''s install.cmd.' }
  $values = @{}
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
  }
  Write-Host 'Initial admin login  (only used until the first account exists)'
  Write-Host "  username: $($values['XCOMM_HUD_INITIAL_ADMIN_USER'])"
  Write-Host "  password: $($values['XCOMM_HUD_INITIAL_ADMIN_PASSWORD'])"
}

switch ($Command) {
  'start'          { Invoke-Start }
  'stop'           { Invoke-Stop }
  'restart'        { Invoke-Stop; Invoke-Start }
  'status'         { Invoke-Status }
  'logs'           { Invoke-Logs }
  'load-images'    { Start-Machine; Import-Images $Argument }
  'update'         { Invoke-Update }
  'update-build'   { if (-not (Test-Path $EnvFile)) { Stop-WithError 'Not set up yet.' }; Invoke-UpdateBuild }
  'admin-password' { Invoke-AdminPassword }
  default          { Get-Help $PSCommandPath -Detailed | Out-Host }
}
