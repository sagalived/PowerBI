param(
    [switch]$SkipSiengeUpdate,
    [switch]$SkipAttachments
)

$ErrorActionPreference = 'Stop'

function Require-Env {
    param([string]$Name)
    # Prioriza variavel da sessao atual (Process) para permitir overrides em testes
    $value = (Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue).Value
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, 'User') }
    if (-not $value) {
        throw "Variavel de ambiente obrigatoria nao definida: $Name"
    }
    return $value
}

function Get-EnvOrEmpty {
    param([string]$Name)
    $value = (Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue).Value
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, 'User') }
    return $value
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not $SkipSiengeUpdate) {
    Write-Host 'Atualizando dados do Sienge (REST -> normalizacao -> JSON)...' -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\download_sienge_financeiro_rest.ps1')
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\normalize_dados_sienge.ps1')
    & node (Join-Path $root 'scripts\build_web_dashboard_data.js')
}

Write-Host 'Gerando relatorio semanal (HTML + PDF + snapshot)...' -ForegroundColor Cyan
$reportJsonRaw = & node (Join-Path $root 'scripts\generate_weekly_report.js')
$reportInfo = $reportJsonRaw | ConvertFrom-Json

if (-not $reportInfo.ok) {
    throw 'Falha ao gerar relatorio semanal.'
}

$smtpHost = Require-Env 'SMTP_HOST'
$smtpPort = [int](Require-Env 'SMTP_PORT')
$smtpUser = Require-Env 'SMTP_USER'
$smtpPass = Require-Env 'SMTP_PASS'
$smtpFrom = Require-Env 'SMTP_FROM'
$smtpTo = Require-Env 'SMTP_TO'
$dashboardUrl = Get-EnvOrEmpty 'DASHBOARD_URL'

$securePass = ConvertTo-SecureString $smtpPass -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($smtpUser, $securePass)

$weekStart = $reportInfo.week.start
$weekEnd = $reportInfo.week.end
$subject = "Relatorio financeiro semanal (Sienge) - $weekStart a $weekEnd"

$body = @"
<p>Segue o relat&oacute;rio semanal (semana fechada <strong>$weekStart</strong> a <strong>$weekEnd</strong>), com evolu&ccedil;&atilde;o de valores e volume de dados.</p>
<p>Anexos: <strong>PDF</strong> (para leitura/compartilhamento) e <strong>HTML</strong> (vers&atilde;o interativa).</p>
"@

if ($dashboardUrl) {
    $body += "<p>Dashboard: <a href=`"$dashboardUrl`">$dashboardUrl</a></p>"
}

$attachments = @()
if (-not $SkipAttachments) {
    $attachments += $reportInfo.reportHtml
    $attachments += $reportInfo.reportPdf
}

Write-Host "Enviando e-mail para $smtpTo..." -ForegroundColor Cyan

# Office 365/SMTP moderno normalmente requer TLS 1.2 no PowerShell 5.1
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
    # ignora se nao suportado
}

$mailParams = @{
    SmtpServer = $smtpHost
    Port = $smtpPort
    UseSsl = $true
    Credential = $credential
    From = $smtpFrom
    To = ($smtpTo -split '[;,\s]+' | Where-Object { $_ })
    Subject = $subject
    BodyAsHtml = $true
    Body = $body
}

if ($attachments.Count -gt 0) {
    $mailParams.Attachments = $attachments
}

Send-MailMessage @mailParams

Write-Host 'Ok: relatorio enviado.' -ForegroundColor Green
