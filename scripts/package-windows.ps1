$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'release'
$unpacked = Join-Path $releaseDir 'win-unpacked'
$manifest = Join-Path $releaseDir 'SHA256SUMS.txt'
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
@($exeSetup,$exePortable,$zip) | ForEach-Object {
  $file=Get-Item $_
  $digest=(Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLower()
  "$digest  $($file.Name)"
} | Set-Content -Path $manifest -Encoding utf8
Write-Host 'Generated Setup.exe, Portable.exe, extracted-application ZIP and SHA256SUMS.txt.'
