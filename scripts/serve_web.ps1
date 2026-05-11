param(
  [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptDir "..")
$webDir = Join-Path $root "web"
$nodeServer = Join-Path $scriptDir "serve_web.js"

if (-not (Test-Path $webDir)) {
  throw "Pasta web nao encontrada: $webDir"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node -and (Test-Path $nodeServer)) {
  Write-Host "Servindo $root em http://localhost:$Port" -ForegroundColor Green
  Write-Host "Dica: abra http://localhost:$Port/web/index.html" -ForegroundColor Green
  Write-Host "API local habilitada: POST /api/atualizar-sienge" -ForegroundColor Green

  Push-Location $root
  try {
    & $node.Source $nodeServer --port $Port
  }
  finally {
    Pop-Location
  }
  exit $LASTEXITCODE
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  $python = Get-Command py -ErrorAction SilentlyContinue
}

if (-not $python) {
  throw "Python nao encontrado (python/py). Instale Python ou rode um servidor HTTP local de sua preferencia apontando para $webDir"
}

Write-Host "Servindo $root em http://localhost:$Port" -ForegroundColor Green
Write-Host "Dica: abra http://localhost:$Port/web/index.html" -ForegroundColor Green
Write-Host "Aviso: Node nao encontrado; botao Atualizar Sienge precisa da API local Node." -ForegroundColor Yellow

Push-Location $root
try {
  if ($python.Name -eq 'py') {
    py -m http.server $Port
  } else {
    python -m http.server $Port
  }
}
finally {
  Pop-Location
}
