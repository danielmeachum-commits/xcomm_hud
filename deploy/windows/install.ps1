<#
.SYNOPSIS
  Install xcomm_hud on a Windows host from the offline kit. Run as administrator
  (install.cmd does that for you), as the account that will run xcomm.

.DESCRIPTION
  Needs no internet: everything comes from the kit, which build-kit.sh made on
  a connected machine. Every step checks whether it is already done, so the
  script resumes after the reboot WSL needs, and is safe to run again.

    1. Copy the kit to C:\xcomm\kit (a USB drive can change letters across
       the reboot; the copy can't).
    2. Turn on the Windows features WSL2 needs. Reboot once if asked; setup
       continues by itself at the next login.
    3. Install WSL, Podman and Git for Windows from the kit, silently.
    4. Create the Podman machine from the kit's machine image.
    5. Clone the code from the kit's git bundle into C:\xcomm\xcomm_hud.
    6. Generate the secrets.
    7. Forward port 80 to the stack and allow it through the firewall, so
       other machines can reach http://<this-host>/.
    8. Start xcomm at every login, and put an "xcomm" shortcut on the desktop.
    9. Load the images and start xcomm.

  Written for Windows PowerShell 5.1, which every supported Windows has.
#>
[CmdletBinding()]
param([switch]$Resume)

$ErrorActionPreference = 'Stop'

$InstallRoot  = 'C:\xcomm'
$KitDir       = Join-Path $InstallRoot 'kit'
$ToolsDir     = Join-Path $InstallRoot 'bin'
$Checkout     = Join-Path $InstallRoot 'xcomm_hud'
$Upstream     = 'https://github.com/danielmeachum-commits/xcomm_hud.git'
$InternalPort = 18080   # must match xcomm.ps1
$RunOnceKey   = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce'
$RunOnceName  = 'xcomm-install'
$TaskName     = 'xcomm'
# xcomm's own machine (must match xcomm.ps1). Never podman-machine-default: a
# host may already have one from another Podman install - on the first real
# install it did, from an older Podman, and starting it with this Podman failed.
$Machine      = 'xcomm'
$Log          = Join-Path $InstallRoot 'install.log'

function Write-Step([string]$Message) { Write-Host ''; Write-Host "== $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "OK  $Message" -ForegroundColor Green }
function Write-Info([string]$Message) { Write-Host "..  $Message" -ForegroundColor DarkGray }
function Stop-WithError([string]$Message) {
  Write-Host "X   $Message" -ForegroundColor Red
  Write-Host "    Full log: $Log"
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}

# Native programs: capture output without PowerShell 5.1 turning stderr into a
# terminating error under $ErrorActionPreference = 'Stop'.
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
  $output | Add-Content -Path $Log -ErrorAction SilentlyContinue
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

function Install-Msi([string]$Msi, [string[]]$Properties) {
  $msiArgs = @('/i', "`"$Msi`"", '/quiet', '/norestart', '/l*v', "`"$Log.msi.txt`"") + $Properties
  $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru
  # 3010 = installed, reboot required.
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    Stop-WithError "Installing $(Split-Path $Msi -Leaf) failed (msiexec exit $($p.ExitCode)). Details: $Log.msi.txt"
  }
  return ($p.ExitCode -eq 3010)
}

function Find-Installer([string]$Pattern) {
  $file = Get-ChildItem -Path (Join-Path $KitDir 'installers') -Filter $Pattern | Select-Object -First 1
  if (-not $file) { Stop-WithError "The kit has no installer matching $Pattern." }
  return $file.FullName
}

# ---------- 0. preconditions ----------

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Run this as administrator - double-click install.cmd instead.' -ForegroundColor Red
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}
if (-not [Environment]::Is64BitOperatingSystem) { Stop-WithError 'xcomm needs 64-bit Windows.' }
New-Item -ItemType Directory -Force -Path $InstallRoot, $ToolsDir | Out-Null
"---- install.ps1 $(Get-Date -Format s) Resume=$Resume user=$env:USERNAME" | Add-Content -Path $Log

# ---------- 1. copy the kit ----------

Write-Step '1/9  Copying the kit to C:\xcomm\kit'
$here = (Resolve-Path $PSScriptRoot).Path.TrimEnd('\')
if ($here -ieq $KitDir) {
  Write-Ok 'Running from C:\xcomm\kit already.'
} else {
  Write-Info "From $here (about 3 GB)..."
  $r = Start-Process -FilePath 'robocopy.exe' -ArgumentList @("`"$here`"", "`"$KitDir`"", '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') -Wait -PassThru -NoNewWindow
  # robocopy: 0-7 are success codes.
  if ($r.ExitCode -ge 8) { Stop-WithError "Copying the kit failed (robocopy exit $($r.ExitCode))." }
  Write-Ok 'Copied.'
}

# ---------- 2. Windows features ----------

Write-Step '2/9  Windows features for WSL2'
$restartNeeded = $false
foreach ($feature in @('VirtualMachinePlatform', 'Microsoft-Windows-Subsystem-Linux')) {
  $state = (Get-WindowsOptionalFeature -Online -FeatureName $feature).State
  if ($state -eq 'Enabled') {
    Write-Ok "$feature is on."
  } else {
    Write-Info "Turning on $feature..."
    $result = Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart
    if ($result.RestartNeeded) { $restartNeeded = $true }
    Write-Ok "$feature turned on."
  }
}

# ---------- 3. WSL, Podman, Git ----------

Write-Step '3/9  Installing WSL, Podman and Git'
$wslVersion = Get-WslVersion
if ($wslVersion -and $wslVersion -ge $MinWslVersion) {
  Write-Ok "WSL $wslVersion is installed."
} else {
  if ($wslVersion) {
    # An older WSL is already here (e.g. from Docker Desktop). Upgrading it is
    # required: Podman's networking doesn't work on it.
    Write-Info "WSL $wslVersion is too old for Podman's networking (needs $MinWslVersion or later); upgrading..."
  } else {
    Write-Info 'Installing WSL...'
  }
  if (Install-Msi (Find-Installer 'wsl.*.x64.msi') @()) { $restartNeeded = $true }
  if ($wslVersion) {
    # Running distros keep the old kernel until WSL restarts. This also stops
    # any other WSL distros (Docker Desktop's, Ubuntu); they start again on use.
    Invoke-Native 'wsl.exe' @('--shutdown') | Out-Null
  }
  if (-not $restartNeeded) {
    $wslVersion = Get-WslVersion
    if (-not $wslVersion -or $wslVersion -lt $MinWslVersion) {
      Stop-WithError "WSL is still $wslVersion after installing the kit's WSL. Restart Windows and run install.cmd again."
    }
  }
  Write-Ok "WSL $wslVersion installed."
}

if ($restartNeeded) {
  # HKLM RunOnce runs elevated at the next administrator login, from the copy
  # on C: - so it doesn't matter which letter the USB drive comes back as.
  $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$KitDir\install.ps1`" -Resume"
  New-ItemProperty -Path $RunOnceKey -Name $RunOnceName -Value $cmd -PropertyType String -Force | Out-Null
  Write-Host ''
  Write-Host 'Windows needs to restart to finish turning on WSL.' -ForegroundColor Yellow
  Write-Host 'Setup continues by itself after you log back in (as this same account).'
  $answer = Read-Host 'Restart now? [Y/n]'
  if ($answer -notmatch '^[nN]') { Restart-Computer -Force }
  exit 0
}

$podmanExe = Join-Path $env:ProgramFiles 'Podman\podman.exe'
if (Test-Path $podmanExe) {
  Write-Ok 'Podman is installed.'
} else {
  Write-Info 'Installing Podman...'
  # Machine scope (all users, Program Files) with the WSL provider.
  Install-Msi (Find-Installer 'podman-installer-windows-amd64.msi') @('ALLUSERS=1', 'MACHINE_PROVIDER=wsl') | Out-Null
  if (-not (Test-Path $podmanExe)) { Stop-WithError "Podman installed, but $podmanExe is missing." }
  Write-Ok 'Podman installed.'
}

$gitExe = Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
if (Test-Path $gitExe) {
  Write-Ok 'Git is installed.'
} else {
  Write-Info 'Installing Git for Windows...'
  $gitArgs = @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES')
  $p = Start-Process -FilePath (Find-Installer 'Git-*-64-bit.exe') -ArgumentList $gitArgs -Wait -PassThru
  if ($p.ExitCode -ne 0 -or -not (Test-Path $gitExe)) { Stop-WithError "Installing Git failed (exit $($p.ExitCode))." }
  Write-Ok 'Git installed.'
}

Copy-Item -Force (Find-Installer 'docker-compose-windows-x86_64.exe') (Join-Path $ToolsDir 'docker-compose.exe')
Write-Ok "docker-compose in $ToolsDir."

# ---------- 4. the Podman machine ----------

Write-Step "4/9  Creating the Podman machine '$Machine'"
$inspect = Invoke-Native $podmanExe @('machine', 'inspect', $Machine)
if ($inspect.Code -eq 0) {
  Write-Ok "The Podman machine '$Machine' exists."
} else {
  Write-Info 'Importing the machine image into WSL (a few minutes)...'
  # From the kit's copy - `podman machine init` would otherwise download it.
  $image = Find-Installer 'podman-machine.x86_64.wsl.tar.zst'
  $r = Invoke-Native $podmanExe @('machine', 'init', '--image', $image, $Machine)
  if ($r.Code -ne 0) {
    $r.Output | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" }
    Stop-WithError 'Creating the Podman machine failed.'
  }
  Write-Ok 'Machine created.'
}

# ---------- 5. the code ----------

Write-Step '5/9  Setting up the code in C:\xcomm\xcomm_hud'
$seed = Join-Path $KitDir 'seed'
if (Test-Path (Join-Path $Checkout '.git')) {
  Write-Ok 'Checkout exists.'
} else {
  $branch    = (Get-Content (Join-Path $seed 'branch')).Trim()
  $bundleRef = (Get-Content (Join-Path $seed 'bundle-ref')).Trim()
  $partial   = "$Checkout.partial"
  if (Test-Path $partial) { Remove-Item -Recurse -Force $partial }
  # core.autocrlf=false: Git for Windows converts line endings by default, which
  # would leave the checkout differing from GitHub and every `git pull` noisy.
  $r = Invoke-Native $gitExe @('clone', '-q', '-c', 'core.autocrlf=false', '-b', $bundleRef,
    (Join-Path $seed 'xcomm_hud.bundle'), $partial)
  if ($r.Code -ne 0) { Stop-WithError 'Cloning from the kit''s bundle failed.' }
  # The bundle carries the branch under a throwaway name (make-seed.sh); rename
  # it and point it at GitHub, so updating on a connected network is a pull.
  Invoke-Native $gitExe @('-C', $partial, 'branch', '-q', '-m', $branch) | Out-Null
  Invoke-Native $gitExe @('-C', $partial, 'remote', 'set-url', 'origin', $Upstream) | Out-Null
  Invoke-Native $gitExe @('-C', $partial, 'config', "branch.$branch.remote", 'origin') | Out-Null
  Invoke-Native $gitExe @('-C', $partial, 'config', "branch.$branch.merge", "refs/heads/$branch") | Out-Null
  Move-Item $partial $Checkout
  Write-Ok "Checked out $branch at $((Get-Content (Join-Path $seed 'revision')).Trim())."
}
$imagesDir = Join-Path $Checkout '.bundle\images'
New-Item -ItemType Directory -Force -Path $imagesDir | Out-Null
Get-ChildItem (Join-Path $seed 'images') -Filter 'xcomm-*.tar' | ForEach-Object {
  $dest = Join-Path $imagesDir $_.Name
  if (-not (Test-Path $dest)) { Copy-Item $_.FullName $dest }
}
if (-not (Test-Path (Join-Path $Checkout 'deploy\windows\xcomm.ps1'))) {
  Stop-WithError 'The kit''s code has no deploy\windows\xcomm.ps1 - build the kit from a branch that has the Windows support.'
}

# ---------- 6. secrets ----------

Write-Step '6/9  Secrets'
$envFile = Join-Path $Checkout '.bundle\xcomm.env'
if (Test-Path $envFile) {
  Write-Ok 'Secrets exist (left as they are).'
} else {
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  function New-RandomBytes([int]$Count) { $b = New-Object byte[] $Count; $rng.GetBytes($b); return ,$b }
  # Same shapes as scripts/gen-env.sh: token_urlsafe(24) and a padded
  # base64url 32-byte key.
  function New-Token { ([Convert]::ToBase64String((New-RandomBytes 24))).Replace('+', '-').Replace('/', '_').TrimEnd('=') }
  $secretKey = ([Convert]::ToBase64String((New-RandomBytes 32))).Replace('+', '-').Replace('/', '_')
  $s3Key     = 'xcomm-' + (-join ((New-RandomBytes 6) | ForEach-Object { $_.ToString('x2') }))
  $s3Secret  = New-Token
  $values = @{
    'POSTGRES_PASSWORD'                = New-Token
    'XCOMM_HUD_SECRET_KEY'             = $secretKey
    'XCOMM_HUD_INITIAL_ADMIN_PASSWORD' = New-Token
    'S3_ACCESS_KEY'                    = $s3Key
    'S3_SECRET_KEY'                    = $s3Secret
  }
  $lines = foreach ($line in Get-Content (Join-Path $Checkout '.env.example')) {
    if ($line -match '^([A-Z0-9_]+)=' -and $values.ContainsKey($Matches[1])) {
      "$($Matches[1])=$($values[$Matches[1]])"
    } else {
      $line
    }
  }
  $lines += ''
  $lines += '# MinIO server credentials - must match S3_ACCESS_KEY / S3_SECRET_KEY above.'
  $lines += "MINIO_ROOT_USER=$s3Key"
  $lines += "MINIO_ROOT_PASSWORD=$s3Secret"
  # UTF-8 WITHOUT a byte-order mark, LF line endings. Windows PowerShell 5.1's
  # Set-Content -Encoding UTF8 writes a BOM, which would glue itself onto the
  # first variable name and silently break it.
  [IO.File]::WriteAllText($envFile, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
  # Readable by this account and SYSTEM only.
  Invoke-Native 'icacls.exe' @($envFile, '/inheritance:r', '/grant:r', "$($env:USERDOMAIN)\$($env:USERNAME):F", '/grant:r', 'SYSTEM:F') | Out-Null
  Write-Ok "Generated $envFile."
}

# ---------- 7. port 80 for the network ----------

Write-Step '7/9  Port 80 for other machines'
# Podman on Windows binds published ports to 127.0.0.1 only. The stack
# listens on 127.0.0.1:$InternalPort; this forwards port 80 on every interface
# to it, which is what other machines connect to.
$listener = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue |
  Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name -ne 'svchost' }
if ($listener) {
  $owner = (Get-Process -Id $listener[0].OwningProcess -ErrorAction SilentlyContinue).Name
  Stop-WithError "Port 80 is already in use by '$owner'. Stop it (IIS, Skype, another web server) and run install.cmd again."
}
Set-Service -Name iphlpsvc -StartupType Automatic
Start-Service -Name iphlpsvc
Invoke-Native 'netsh.exe' @('interface', 'portproxy', 'delete', 'v4tov4', 'listenport=80', 'listenaddress=0.0.0.0') | Out-Null
$r = Invoke-Native 'netsh.exe' @('interface', 'portproxy', 'add', 'v4tov4',
  'listenport=80', 'listenaddress=0.0.0.0', "connectport=$InternalPort", 'connectaddress=127.0.0.1')
if ($r.Code -ne 0) { Stop-WithError 'Setting up the port 80 forward failed.' }
Write-Ok "Port 80 forwards to 127.0.0.1:$InternalPort."
Get-NetFirewallRule -DisplayName 'xcomm (HTTP 80)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'xcomm (HTTP 80)' -Direction Inbound -Protocol TCP -LocalPort 80 `
  -Action Allow -Profile Any | Out-Null
Write-Ok 'Firewall allows port 80 on every network.'

# ---------- 8. start at login, desktop shortcut ----------

Write-Step '8/9  Start xcomm at login'
$xcommPs1 = Join-Path $Checkout 'deploy\windows\xcomm.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$xcommPs1`" start -OpenBrowser"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$($env:USERDOMAIN)\$($env:USERNAME)"
$principalTask = New-ScheduledTaskPrincipal -UserId "$($env:USERDOMAIN)\$($env:USERNAME)" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principalTask `
  -Settings $settings -Force | Out-Null
Write-Ok "Scheduled task '$TaskName' starts xcomm when $env:USERNAME logs in."

$desktop = [Environment]::GetFolderPath('Desktop')
[IO.File]::WriteAllText((Join-Path $desktop 'xcomm.url'), "[InternetShortcut]`r`nURL=http://localhost/`r`n")
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $desktop 'xcomm status.lnk'))
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-NoProfile -NoExit -ExecutionPolicy Bypass -File `"$xcommPs1`" status"
$shortcut.Save()
Write-Ok 'Desktop shortcuts: "xcomm" and "xcomm status".'

# ---------- 9. start ----------

Write-Step '9/9  Starting xcomm (the first start loads its images - a few minutes)'
Remove-ItemProperty -Path $RunOnceKey -Name $RunOnceName -ErrorAction SilentlyContinue
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $xcommPs1 start -OpenBrowser
if ($LASTEXITCODE -ne 0) { Stop-WithError 'xcomm did not start. Run "xcomm status" from the desktop for details.' }
Write-Host ''
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $xcommPs1 admin-password
Write-Host ''
Write-Ok 'Installed. xcomm starts by itself whenever this account logs in.'
Read-Host 'Press Enter to close' | Out-Null
