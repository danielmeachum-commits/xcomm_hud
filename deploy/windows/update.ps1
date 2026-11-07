<#
.SYNOPSIS
  Update an installed xcomm_hud from an update package (build-update.sh).
  update.cmd runs this; run it as the account that runs xcomm.

.DESCRIPTION
  Needs no internet. Two steps:

    1. Bring the checkout in C:\xcomm\xcomm_hud to the package's version, from
       its git bundle - this is what updates xcomm.ps1 itself, so a host whose
       xcomm.ps1 predates the update command can still be updated.
    2. Run the (new) xcomm.ps1 update with the package's images file: it
       backs up the database, loads the images, restarts xcomm and checks it
       answers. Data, secrets and settings are kept.

  Written for Windows PowerShell 5.1, which every supported Windows has.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$PackageDir = $PSScriptRoot
$Seed       = Join-Path $PackageDir 'seed'
$Checkout   = 'C:\xcomm\xcomm_hud'
$Upstream   = 'https://github.com/danielmeachum-commits/xcomm_hud.git'

function Write-Step([string]$Message) { Write-Host ''; Write-Host "== $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "OK  $Message" -ForegroundColor Green }
function Write-Info([string]$Message) { Write-Host "..  $Message" -ForegroundColor DarkGray }
function Stop-WithError([string]$Message) {
  Write-Host "X   $Message" -ForegroundColor Red
  exit 1
}

# Run a native program and capture its output without PowerShell 5.1 turning
# anything it writes to stderr into a terminating error.
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

function Invoke-Git([string[]]$ArgumentList) {
  $r = Invoke-Native $GitExe (@('-C', $Checkout) + $ArgumentList)
  if ($r.Code -ne 0) {
    $r.Output | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" }
    Stop-WithError "git $($ArgumentList[0]) failed."
  }
  return $r.Output
}

$GitExe = Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
if (-not (Test-Path $GitExe)) { Stop-WithError 'Git is not installed - is xcomm installed on this machine? (install.cmd from the kit)' }
if (-not (Test-Path (Join-Path $Checkout '.git'))) { Stop-WithError "xcomm isn't installed here ($Checkout is missing). Use the install kit first." }
foreach ($f in @('branch', 'bundle-ref', 'revision', 'xcomm_hud.bundle')) {
  if (-not (Test-Path (Join-Path $Seed $f))) { Stop-WithError "This package is incomplete (seed\$f is missing)." }
}
$branch    = (Get-Content (Join-Path $Seed 'branch')).Trim()
$bundleRef = (Get-Content (Join-Path $Seed 'bundle-ref')).Trim()
$revision  = (Get-Content (Join-Path $Seed 'revision')).Trim()
$images    = Join-Path $Seed "images\xcomm-$revision.tar"
if (-not (Test-Path $images)) { Stop-WithError "This package is incomplete ($images is missing)." }

Write-Host "Updating xcomm_hud to $branch at $revision."

# ---------- 1. the code ----------

Write-Step "1/2  Code in $Checkout"
# Never overwrite edits made on this machine. Untracked files are fine:
# secrets, images and backups live in the ignored .bundle folder.
$changed = Invoke-Git @('status', '--porcelain', '--untracked-files=no')
if (($changed -join '').Trim()) {
  $changed | ForEach-Object { Write-Host "    $_" }
  Stop-WithError "$Checkout has local changes (above), so nothing was updated. Undo them, or ask whoever supports xcomm."
}
Invoke-Git @('fetch', '-q', (Join-Path $Seed 'xcomm_hud.bundle'), $bundleRef) | Out-Null
Invoke-Git @('checkout', '-q', '-B', $branch, 'FETCH_HEAD') | Out-Null
# Track the same branch on GitHub, so a connected machine can also `git pull`.
Invoke-Git @('remote', 'set-url', 'origin', $Upstream) | Out-Null
Invoke-Git @('config', "branch.$branch.remote", 'origin') | Out-Null
Invoke-Git @('config', "branch.$branch.merge", "refs/heads/$branch") | Out-Null
Write-Ok "Code at $revision ($branch)."

# ---------- 2. xcomm itself ----------

Write-Step '2/2  Updating xcomm (backup, images, restart)'
$xcommPs1 = Join-Path $Checkout 'deploy\windows\xcomm.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $xcommPs1 update $images -OpenBrowser
exit $LASTEXITCODE
