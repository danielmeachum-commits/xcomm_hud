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
    xcomm.ps1 admin-password         print the initial admin login

  Written for Windows PowerShell 5.1, which every supported Windows has.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = 'help',
  [Parameter(Position = 1)][string]$Argument,
  [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'

$RepoRoot    = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$StateDir    = Join-Path $RepoRoot '.bundle'
$ImagesDir   = Join-Path $StateDir 'images'
$EnvFile     = Join-Path $StateDir 'xcomm.env'
$ComposeFile = Join-Path $RepoRoot 'deploy\bundle\compose.prod.yml'
$ComposeLog  = Join-Path $StateDir 'compose.log'
$Project     = 'xcomm-hud'
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

$Podman = Get-PodmanPath

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
  $r = Invoke-Native $Podman @('machine', 'inspect', '--format', '{{.State}}')
  if ($r.Code -ne 0) { return 'missing' }
  return ($r.Output | Select-Object -Last 1).Trim()
}

# The named pipe the machine's API is served on, e.g. \\.\pipe\podman-machine-default.
# `podman compose` points docker-compose at it.
function Get-MachinePipe {
  $r = Invoke-Native $Podman @('machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanPipe.Path}}')
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
  $r = Invoke-Native $Podman @('machine', $Verb)
  if ($r.Code -ne 0) {
    $r.Output | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" }
    Stop-WithError "podman machine $Verb failed."
  }
}

# "Running" is not enough: the API pipe only exists if `podman machine start`
# made it. WSL can report the machine's distro as running without that - e.g.
# left up by `podman machine init` - and then docker-compose fails with
# "failed to connect to the docker API at npipe:////./pipe/podman-machine-default".
function Start-Machine {
  $state = Get-MachineState
  if ($state -eq 'missing') { Stop-WithError 'No Podman machine. Run the kit''s install.cmd first.' }
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

function Invoke-Start {
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
    exit 1
  }
  Write-Ok "xcomm_hud is up ($(Get-RunningRevision))."
  Show-Urls
  if ($OpenBrowser) { Start-Process 'http://localhost' }
}

function Invoke-Stop {
  Write-Info 'Stopping xcomm_hud (data is kept)...'
  $r = Invoke-Compose @('down')
  $r.Output | Set-Content -Path $ComposeLog
  if ($r.Code -ne 0) { Stop-WithError "Couldn't stop cleanly (see $ComposeLog)." }
  Write-Ok 'Stopped.'
}

function Invoke-Status {
  Write-Host "xcomm_hud  version $(Get-RunningRevision)  -  Podman machine: $(Get-MachineState)"
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
  'admin-password' { Invoke-AdminPassword }
  default          { Get-Help $PSCommandPath -Detailed | Out-Host }
}
