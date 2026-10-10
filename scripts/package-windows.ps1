$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
# Standalone packaging must obey the SAME tag/checkout authorization as CI.
# Fail before changing the unpacked directory, creating a ZIP or writing hashes.
Push-Location $projectRoot
try {
  & node (Join-Path $PSScriptRoot 'final-build-authorization.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Windows release packaging refused by final tag authorization' }
} finally {
  Pop-Location
}
$releaseDir = Join-Path $projectRoot 'release'
$unpacked = Join-Path $releaseDir 'win-unpacked'
$manifest = Join-Path $releaseDir 'SHA256SUMS.txt'
if (Test-Path -LiteralPath (Join-Path $unpacked 'Data')) { throw 'Refuse to ZIP private Data directory' }
if (Test-Path -LiteralPath $manifest) { throw 'Existing checksum manifest cannot be overwritten' }
if (-not (Test-Path (Join-Path $unpacked 'resources/app.asar'))) { throw 'Missing app.asar: Windows bundle not created' }
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$exeSetup = Join-Path $releaseDir "Userscript-Self-Healing-Manager-Setup-$version-win-x64.exe"
$exePortable = Join-Path $releaseDir "Userscript-Self-Healing-Manager-Portable-$version-win-x64.exe"
$zip = Join-Path $releaseDir "Userscript-Self-Healing-Manager-$version-win-x64.zip"
foreach ($path in @($exeSetup, $exePortable)) { if (-not (Test-Path $path)) { throw "Missing binary: $path" } }
Set-Content -NoNewline -Path (Join-Path $unpacked '.usshm-portable') -Value 'zip-portable-v1'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zip) { throw 'Release ZIP already exists; preserve it and use a clean release directory' }
[System.IO.Compression.ZipFile]::CreateFromDirectory($unpacked,$zip)
if (-not (Test-Path $zip)) { throw 'ZIP did not materialize' }
# Share the CI's fail-closed three-format/ZIP privacy/PE/SHA256 validator.
# It creates and verifies SHA256SUMS.txt; never claim completion on a bad ZIP.
& node (Join-Path $PSScriptRoot 'windows-release-gate.mjs') $version $releaseDir
if ($LASTEXITCODE -ne 0) { throw 'Windows release packaging refused by ZIP, privacy or SHA256 verification' }
Write-Host 'Generated Setup.exe, Portable.exe, extracted-application ZIP and SHA256SUMS.txt.'
