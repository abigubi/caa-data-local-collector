$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$distRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
$bundleRoot = [System.IO.Path]::GetFullPath((Join-Path $distRoot 'CAADataLocal-Windows-x64'))
$zipPath = [System.IO.Path]::GetFullPath((Join-Path $distRoot 'CAADataLocal-Windows-x64.zip'))

if (-not $bundleRoot.StartsWith($distRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Portable output resolved outside the project dist directory.'
}

if (Test-Path -LiteralPath $bundleRoot) {
  Remove-Item -LiteralPath $bundleRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$nodeCommand = Get-Command node -ErrorAction Stop
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
  throw 'node_modules is missing. Run npm ci before building the portable package.'
}

New-Item -ItemType Directory -Force -Path $bundleRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $bundleRoot 'runtime') | Out-Null

$directories = @('public', 'scripts', 'src', 'test', 'node_modules')
foreach ($directory in $directories) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination (Join-Path $bundleRoot $directory) -Recurse
}

$files = @(
  'README.md',
  'SECURITY.md',
  'Setup.bat',
  'Start.bat',
  'config.example.json',
  'manifest-local.xml',
  'package.json',
  'package-lock.json'
)
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $bundleRoot $file)
}

Copy-Item -LiteralPath $nodeCommand.Source -Destination (Join-Path $bundleRoot 'runtime\node.exe')

Compress-Archive -Path (Join-Path $bundleRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "Portable bundle created: $zipPath" -ForegroundColor Green
