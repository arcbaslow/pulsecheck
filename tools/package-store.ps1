$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -LiteralPath (Join-Path $project 'extension\manifest.json') | ConvertFrom-Json
$dist = Join-Path $project 'dist'
$archive = Join-Path $dist ("pulsecheck-chrome-web-store-{0}.zip" -f $manifest.version)

& node (Join-Path $project 'tools\validate-store.mjs')
New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }

Push-Location (Join-Path $project 'extension')
try {
  Compress-Archive -Path * -DestinationPath $archive -CompressionLevel Optimal
} finally {
  Pop-Location
}

Write-Output $archive
