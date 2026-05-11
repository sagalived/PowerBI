param(
    [string]$StartDate = "2026-01-01",
    [string]$EndDate = $([DateTime]::UtcNow.AddHours(-3).ToString("yyyy-MM-dd")),
    [int]$PageSize = 200,
    [int]$MaxRetries = 8
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptDir "..")
$pqPath = Join-Path $root "sienge_financeiro_powerbi.pq"
$outputDir = Join-Path $root "dados_sienge"

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null


function Get-EnvText {
    param([string]$Name)
    $v = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($Name, 'User') }
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($Name, 'Machine') }
    return ([string]$v).Trim()
}

$instance = Get-EnvText "SIENGE_INSTANCE"
$accessName = Get-EnvText "SIENGE_ACCESS_NAME"
$token = Get-EnvText "SIENGE_TOKEN"

if (-not $instance -or -not $accessName -or -not $token) {
    $pq = Get-Content $pqPath -Raw
    if (-not $instance) { $instance = [regex]::Match($pq, 'SIENGE_INSTANCE\s*=\s*"([^"]+)"').Groups[1].Value }
    if (-not $accessName) { $accessName = [regex]::Match($pq, 'SIENGE_ACCESS_NAME\s*=\s*"([^"]+)"').Groups[1].Value }
    if (-not $token) { $token = [regex]::Match($pq, 'SIENGE_TOKEN\s*=\s*"([^"]+)"').Groups[1].Value }
}

if (-not $instance -or -not $accessName -or -not $token) {
    throw "Credenciais Sienge nao encontradas. Defina as variaveis de ambiente SIENGE_INSTANCE, SIENGE_ACCESS_NAME, SIENGE_TOKEN (recomendado) ou preencha no $pqPath."
}

$auth = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($accessName + ":" + $token))
$headers = @{
    Authorization = $auth
    Accept = "application/json"
}

function ConvertFrom-ResponseContent {
    param($Content)

    if ($Content -is [byte[]]) {
        return [Text.Encoding]::UTF8.GetString($Content)
    }

    return [string]$Content
}

function New-SiengeUrl {
    param(
        [string]$Path,
        [hashtable]$Params
    )

    $query = ($Params.GetEnumerator() | Sort-Object Name | ForEach-Object {
        "$($_.Key)=$([Uri]::EscapeDataString([string]$_.Value))"
    }) -join "&"

    return "https://api.sienge.com.br/$instance/public/api/v1/$($Path.TrimStart('/'))`?$query"
}

function Invoke-SiengeRest {
    param(
        [string]$Path,
        [hashtable]$Params
    )

    $url = New-SiengeUrl -Path $Path -Params $Params

    for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $url -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 120
            $jsonText = ConvertFrom-ResponseContent $response.Content
            return $jsonText | ConvertFrom-Json
        }
        catch {
            $statusCode = $null
            $retryAfter = $null
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
                $retryAfter = $_.Exception.Response.Headers["Retry-After"]
            }

            if ($statusCode -eq 429 -and $attempt -lt $MaxRetries) {
                $wait = 10 * $attempt
                if ($retryAfter) {
                    [int]::TryParse([string]$retryAfter, [ref]$wait) | Out-Null
                }
                $wait = [Math]::Max($wait, 10)
                Write-Host "429 no REST Sienge. Aguardando $wait segundos..."
                Start-Sleep -Seconds $wait
                continue
            }

            throw
        }
    }
}

function Get-Results {
    param($Payload)

    if ($null -eq $Payload) {
        return @()
    }
    if ($Payload -is [array]) {
        return @($Payload)
    }
    if ($null -ne $Payload.results) {
        return @($Payload.results)
    }
    if ($null -ne $Payload.data -and $Payload.data -is [array]) {
        return @($Payload.data)
    }
    if ($null -ne $Payload.data.results) {
        return @($Payload.data.results)
    }
    return @($Payload)
}

function Get-TotalCount {
    param($Payload)

    if ($null -ne $Payload.resultSetMetadata.count) {
        return [int]$Payload.resultSetMetadata.count
    }
    if ($null -ne $Payload.data.resultSetMetadata.count) {
        return [int]$Payload.data.resultSetMetadata.count
    }
    return $null
}

function Fetch-AllPages {
    param(
        [string]$Name,
        [string]$Path,
        [hashtable]$BaseParams
    )

    $all = New-Object System.Collections.Generic.List[object]
    $offset = 0
    $total = $null

    while ($true) {
        $params = @{}
        foreach ($key in $BaseParams.Keys) {
            $params[$key] = $BaseParams[$key]
        }
        $params["limit"] = $PageSize
        $params["offset"] = $offset

        $payload = Invoke-SiengeRest -Path $Path -Params $params
        $rows = @(Get-Results -Payload $payload)
        if ($null -eq $total) {
            $total = Get-TotalCount -Payload $payload
        }

        foreach ($row in $rows) {
            $all.Add($row) | Out-Null
        }

        Write-Host "$Name offset=$offset linhas=$($rows.Count) acumulado=$($all.Count) total=$total"

        if ($rows.Count -lt $PageSize) {
            break
        }
        $offset += $rows.Count
        if ($null -ne $total -and $offset -ge $total) {
            break
        }

        Start-Sleep -Milliseconds 250
    }

    return $all.ToArray()
}

function Save-JsonUtf8 {
    param(
        [string]$Path,
        [object]$Data
    )

    $json = @{ data = @($Data) } | ConvertTo-Json -Depth 100
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Normalize-SNToBool {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }
    if ($Value -is [bool]) {
        return $Value
    }

    $t = ([string]$Value).Trim().ToUpperInvariant()
    if ($t -eq 'S') {
        return $true
    }
    if ($t -eq 'N') {
        return $false
    }
    return $null
}

function Normalize-RowsForEndpoint {
    param(
        [string]$Name,
        [object[]]$Rows
    )

    switch ($Name) {
        'fornecedores_db' {
            foreach ($r in $Rows) {
                if ($null -ne $r.PSObject.Properties['supplier']) { $r.supplier = Normalize-SNToBool $r.supplier }
                if ($null -ne $r.PSObject.Properties['broker']) { $r.broker = Normalize-SNToBool $r.broker }
                if ($null -ne $r.PSObject.Properties['employee']) { $r.employee = Normalize-SNToBool $r.employee }
            }
        }
        'contas_correntes_db' {
            foreach ($r in $Rows) {
                if ($null -ne $r.PSObject.Properties['accountType']) {
                    $at = $r.accountType
                    if ($at -is [pscustomobject]) {
                        if ($null -ne $at.PSObject.Properties['description'] -and $at.description) {
                            $r.accountType = [string]$at.description
                        }
                        elseif ($null -ne $at.PSObject.Properties['id'] -and $at.id) {
                            $r.accountType = [string]$at.id
                        }
                        else {
                            $r.accountType = $null
                        }
                    }
                    else {
                        $r.accountType = if ($at) { [string]$at } else { $null }
                    }
                }
            }
        }
        'indexadores_db' {
            foreach ($r in $Rows) {
                if ($null -ne $r.PSObject.Properties['lastValue']) {
                    $lv = $r.lastValue
                    if ($lv -is [pscustomobject]) {
                        if ($null -ne $lv.PSObject.Properties['value']) {
                            $r.lastValue = if ($null -eq $lv.value) { $null } else { [double]$lv.value }
                        }
                        else {
                            $r.lastValue = $null
                        }
                    }
                    else {
                        try {
                            $r.lastValue = if ($null -eq $lv) { $null } else { [double]$lv }
                        }
                        catch {
                            $r.lastValue = $null
                        }
                    }
                }
            }
        }
    }

    return $Rows
}

function Is-IncomeStatement {
    param($Item)

    $type = [string]$Item.type
    if ($type.ToLowerInvariant() -eq "income") {
        return $true
    }
    if ($type.ToLowerInvariant() -eq "expense") {
        return $false
    }

    $rawValue = $Item.rawValue
    if ($null -ne $rawValue) {
        try {
            return ([double]$rawValue) -gt 0
        }
        catch {
            return $false
        }
    }

    return $false
}

$statementParams = @{
    startDate = $StartDate
    endDate = $EndDate
}
$billParams = @{
    startDate = $StartDate
    endDate = $EndDate
}
$balanceParams = @{
    balanceDate = $EndDate
    showLastBalanceIfNotExistBalance = "S"
}

$dimensionEndpoints = @(
    @{ Name = "empresas_db"; Path = "/companies"; Params = @{} },
    @{ Name = "obras_db"; Path = "/enterprises"; Params = @{} },
    @{ Name = "centros_custo_db"; Path = "/cost-centers"; Params = @{} },
    @{ Name = "plano_financeiro_db"; Path = "/payment-categories"; Params = @{} },
    @{ Name = "clientes_db"; Path = "/customers"; Params = @{} },
    @{ Name = "fornecedores_db"; Path = "/creditors"; Params = @{} },
    @{ Name = "contas_correntes_db"; Path = "/checking-accounts"; Params = @{} },
    @{ Name = "portadores_receber_db"; Path = "/bearers-receivable"; Params = @{} },
    @{ Name = "indexadores_db"; Path = "/indexers"; Params = @{} },
    @{ Name = "saldos_contas_db"; Path = "/accounts-balances"; Params = $balanceParams },
    @{ Name = "titulos_receber_db"; Path = "/accounts-receivable/receivable-bills"; Params = @{} }
)

$downloaded = New-Object System.Collections.Generic.List[object]

foreach ($endpoint in $dimensionEndpoints) {
    Write-Host "Baixando $($endpoint.Name) via $($endpoint.Path)..."
    $rows = @(Fetch-AllPages -Name $endpoint.Name -Path $endpoint.Path -BaseParams $endpoint.Params)
    $rows = Normalize-RowsForEndpoint -Name $endpoint.Name -Rows $rows
    $filePath = Join-Path $outputDir "$($endpoint.Name).json"
    Save-JsonUtf8 -Path $filePath -Data $rows
    $downloaded.Add([pscustomobject]@{ tabela = $endpoint.Name; linhas = @($rows).Count; arquivo = $filePath }) | Out-Null
    Start-Sleep -Milliseconds 400
}

Write-Host "Baixando movimentacoes_bancarias_db via /accounts-statements..."
$statements = Fetch-AllPages -Name "accounts-statements" -Path "/accounts-statements" -BaseParams $statementParams
$receitas = @($statements | Where-Object { Is-IncomeStatement $_ })
Save-JsonUtf8 -Path (Join-Path $outputDir "movimentacoes_bancarias_db.json") -Data $statements
Save-JsonUtf8 -Path (Join-Path $outputDir "receitas_db.json") -Data $receitas
$downloaded.Add([pscustomobject]@{ tabela = "receitas_db"; linhas = $receitas.Count; arquivo = (Join-Path $outputDir "receitas_db.json") }) | Out-Null
$downloaded.Add([pscustomobject]@{ tabela = "movimentacoes_bancarias_db"; linhas = $statements.Count; arquivo = (Join-Path $outputDir "movimentacoes_bancarias_db.json") }) | Out-Null

Write-Host "Baixando despesas_db via /bills..."
$bills = Fetch-AllPages -Name "bills" -Path "/bills" -BaseParams $billParams
Save-JsonUtf8 -Path (Join-Path $outputDir "despesas_db.json") -Data $bills
$downloaded.Add([pscustomobject]@{ tabela = "despesas_db"; linhas = $bills.Count; arquivo = (Join-Path $outputDir "despesas_db.json") }) | Out-Null

$downloaded | Sort-Object tabela | Format-Table -AutoSize
