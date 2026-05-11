param(
  [string]$Root = $(Resolve-Path (Join-Path $PSScriptRoot "..")),
  [switch]$Backup
)

$ErrorActionPreference = 'Stop'

$dataDir = Join-Path $Root 'dados_sienge'
if (-not (Test-Path $dataDir)) {
  throw "Pasta não encontrada: $dataDir"
}

function Read-JsonFile {
  param([string]$Path)
  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  return $raw | ConvertFrom-Json
}

function Write-JsonFile {
  param([string]$Path, [object]$Obj)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $json = $Obj | ConvertTo-Json -Depth 100
  [IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Normalize-SNToBool {
  param($Value)
  if ($null -eq $Value) { return $null }
  if ($Value -is [bool]) { return $Value }
  $t = ([string]$Value).Trim().ToUpperInvariant()
  if ($t -eq 'S') { return $true }
  if ($t -eq 'N') { return $false }
  return $null
}

function Normalize-Fornecedores {
  param($Payload)
  if ($null -eq $Payload.data) { return $Payload }
  foreach ($r in $Payload.data) {
    if ($null -ne $r.PSObject.Properties['supplier']) { $r.supplier = Normalize-SNToBool $r.supplier }
    if ($null -ne $r.PSObject.Properties['broker']) { $r.broker = Normalize-SNToBool $r.broker }
    if ($null -ne $r.PSObject.Properties['employee']) { $r.employee = Normalize-SNToBool $r.employee }
  }
  return $Payload
}

function Normalize-ContasCorrentes {
  param($Payload)
  if ($null -eq $Payload.data) { return $Payload }
  foreach ($r in $Payload.data) {
    if ($null -ne $r.PSObject.Properties['accountType']) {
      $at = $r.accountType
      if ($at -is [pscustomobject]) {
        if ($null -ne $at.PSObject.Properties['description'] -and $at.description) {
          $r.accountType = [string]$at.description
        } elseif ($null -ne $at.PSObject.Properties['id'] -and $at.id) {
          $r.accountType = [string]$at.id
        } else {
          $r.accountType = $null
        }
      } elseif ($at -is [hashtable]) {
        if ($at.ContainsKey('description') -and $at['description']) {
          $r.accountType = [string]$at['description']
        } elseif ($at.ContainsKey('id') -and $at['id']) {
          $r.accountType = [string]$at['id']
        } else {
          $r.accountType = $null
        }
      } else {
        $r.accountType = if ($at) { [string]$at } else { $null }
      }
    }
  }
  return $Payload
}

function Normalize-Indexadores {
  param($Payload)
  if ($null -eq $Payload.data) { return $Payload }
  foreach ($r in $Payload.data) {
    if ($null -ne $r.PSObject.Properties['lastValue']) {
      $lv = $r.lastValue
      if ($lv -is [pscustomobject]) {
        if ($null -ne $lv.PSObject.Properties['value']) {
          if ($null -eq $lv.value) { $r.lastValue = $null } else { $r.lastValue = [double]$lv.value }
        } else {
          $r.lastValue = $null
        }
      } else {
        try {
          $r.lastValue = if ($null -eq $lv) { $null } else { [double]$lv }
        } catch {
          $r.lastValue = $null
        }
      }
    }
  }
  return $Payload
}

$targets = @(
  @{ Name = 'fornecedores_db.json'; Normalize = { param($p) Normalize-Fornecedores $p } },
  @{ Name = 'contas_correntes_db.json'; Normalize = { param($p) Normalize-ContasCorrentes $p } },
  @{ Name = 'indexadores_db.json'; Normalize = { param($p) Normalize-Indexadores $p } }
)

foreach ($t in $targets) {
  $path = Join-Path $dataDir $t.Name
  if (-not (Test-Path $path)) {
    Write-Warning "Arquivo não encontrado, pulando: $path"
    continue
  }

  if ($Backup) {
    $backupPath = $path + '.bak'
    Copy-Item -LiteralPath $path -Destination $backupPath -Force
  }

  Write-Host "Normalizando $($t.Name)..." -ForegroundColor Cyan
  $payload = Read-JsonFile -Path $path
  $normalized = & $t.Normalize $payload
  Write-JsonFile -Path $path -Obj $normalized
}

Write-Host 'OK. Agora atualize o Power BI (Refresh).' -ForegroundColor Green
