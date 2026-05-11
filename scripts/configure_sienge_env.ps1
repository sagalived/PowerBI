param(
    [string]$Instance,
    [string]$AccessName,
    [string]$Token
)

$ErrorActionPreference = 'Stop'

function Ensure-Value {
    param(
        [string]$Current,
        [string]$Label
    )

    if ($Current) {
        return $Current
    }

    return Read-Host -Prompt $Label
}

$Instance = Ensure-Value -Current $Instance -Label 'SIENGE_INSTANCE (ex: dinamicaempreendimentos)'
$AccessName = Ensure-Value -Current $AccessName -Label 'SIENGE_ACCESS_NAME (ex: dinamicaempreendimentos-jrmorais)'
$Token = Ensure-Value -Current $Token -Label 'SIENGE_TOKEN (token da API)'

if (-not $Instance -or -not $AccessName -or -not $Token) {
    throw 'Valores invalidos. Todos os 3 precisam ser informados.'
}

[Environment]::SetEnvironmentVariable('SIENGE_INSTANCE', $Instance, 'User')
[Environment]::SetEnvironmentVariable('SIENGE_ACCESS_NAME', $AccessName, 'User')
[Environment]::SetEnvironmentVariable('SIENGE_TOKEN', $Token, 'User')

Write-Host 'Variaveis gravadas no escopo User.' -ForegroundColor Green
Write-Host 'Reabra o terminal/VS Code para aplicar na sessao atual.' -ForegroundColor Yellow
