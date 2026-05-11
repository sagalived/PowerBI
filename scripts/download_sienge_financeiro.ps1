param(
    [string]$StartDate = "2026-01-01",
    [string]$EndDate = $([DateTime]::UtcNow.AddHours(-3).ToString("yyyy-MM-dd")),
    [int]$MaxRetries = 5,
    [int]$RetrySeconds = 65
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptDir "..")
$pqPath = Join-Path $root "sienge_financeiro_powerbi.pq"
$outputDir = Join-Path $root "dados_sienge"

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$pq = Get-Content $pqPath -Raw
$instance = [regex]::Match($pq, 'SIENGE_INSTANCE\s*=\s*"([^"]+)"').Groups[1].Value
$accessName = [regex]::Match($pq, 'SIENGE_ACCESS_NAME\s*=\s*"([^"]+)"').Groups[1].Value
$token = [regex]::Match($pq, 'SIENGE_TOKEN\s*=\s*"([^"]+)"').Groups[1].Value

if (-not $instance -or -not $accessName -or -not $token) {
    throw "Credenciais Sienge nao encontradas em $pqPath"
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

    return "https://api.sienge.com.br/$instance/$Path`?$query"
}

function Invoke-SiengeJson {
    param(
        [string]$Path,
        [hashtable]$Params,
        [int]$TimeoutSeconds = 600
    )

    $url = New-SiengeUrl -Path $Path -Params $Params

    for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $url -Headers $headers -Method Get -UseBasicParsing -TimeoutSec $TimeoutSeconds
            return ConvertFrom-ResponseContent $response.Content
        }
        catch {
            $statusCode = $null
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
            }

            if ($statusCode -eq 429 -and $attempt -lt $MaxRetries) {
                Write-Host "429 no Sienge. Aguardando $RetrySeconds segundos antes de tentar novamente..."
                Start-Sleep -Seconds $RetrySeconds
                continue
            }

            throw
        }
    }
}

function Save-JsonUtf8 {
    param(
        [string]$Path,
        [string]$Content
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-RowCount {
    param([string]$JsonText)

    try {
        $payload = $JsonText | ConvertFrom-Json
        if ($payload -is [array]) {
            return $payload.Count
        }
        if ($null -ne $payload.data) {
            return @($payload.data).Count
        }
        if ($null -ne $payload.results) {
            return @($payload.results).Count
        }
        if ($null -ne $payload.items) {
            return @($payload.items).Count
        }
        return 1
    }
    catch {
        return $null
    }
}

$endpoints = @(
    @{
        Name = "receitas_db"
        Path = "public/api/bulk-data/v1/income"
        File = "receitas_db.json"
        Params = @{
            startDate = $StartDate
            endDate = $EndDate
            selectionType = "P"
        }
    },
    @{
        Name = "despesas_db"
        Path = "public/api/bulk-data/v1/outcome"
        File = "despesas_db.json"
        Params = @{
            startDate = $StartDate
            endDate = $EndDate
            selectionType = "P"
            correctionIndexerId = "0"
            correctionDate = $EndDate
            withBankMovements = "true"
        }
    },
    @{
        Name = "movimentacoes_bancarias_db"
        Path = "public/api/bulk-data/v1/bank-movement"
        File = "movimentacoes_bancarias_db.json"
        Params = @{
            startDate = $StartDate
            endDate = $EndDate
            selectionType = "M"
        }
    }
)

$summary = foreach ($endpoint in $endpoints) {
    $targetFile = Join-Path $outputDir $endpoint.File
    Write-Host "Baixando $($endpoint.Name)..."
    $json = Invoke-SiengeJson -Path $endpoint.Path -Params $endpoint.Params
    Save-JsonUtf8 -Path $targetFile -Content $json

    [pscustomobject]@{
        tabela = $endpoint.Name
        arquivo = $targetFile
        linhas = Get-RowCount -JsonText $json
        bytes = (Get-Item $targetFile).Length
    }

    Start-Sleep -Seconds 4
}

$summary | Format-Table -AutoSize
