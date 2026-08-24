$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 22 or newer is required. Install it from https://nodejs.org and run this script again.'
}

npm install
npm run setup

Write-Host ''
Write-Host 'CAA Data Local is installed.' -ForegroundColor Green
Write-Host 'Next: run .\start.ps1, then sideload manifest-local.xml in Excel.'
