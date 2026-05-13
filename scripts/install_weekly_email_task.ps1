param(
    [string]$TaskName = 'SiengeFinanceiroWeeklyEmail',
    [string]$At = '07:00'
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scriptPath = Join-Path $root 'scripts\weekly_email.ps1'

if (-not (Test-Path $scriptPath)) {
    throw "Arquivo nao encontrado: $scriptPath"
}

try {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
}
catch {
    # ignorar quando nao existe
}

$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At $At

# InteractiveToken = roda somente se o usuario estiver logado (nao precisa senha).
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType InteractiveToken -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Description 'Gera e envia relatorio semanal do dashboard financeiro (Sienge).' | Out-Null

Write-Host "Task instalada: $TaskName (toda segunda as $At)." -ForegroundColor Green
