param(
    [switch]$SkipSiengeUpdate,
    [switch]$SkipAttachments,
    [switch]$LayoutTest
)

$ErrorActionPreference = 'Stop'

function Invoke-Step {
    param(
        [string]$Label,
        [string]$Exe,
        [string[]]$Arguments
    )

    Write-Host $Label -ForegroundColor Cyan
    & $Exe @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "$Label (exit code=$code)"
    }
}

function Parse-EmailList {
    param([string]$Value)

    $raw = [string]$Value
    if (-not $raw) { return @() }

    $clean = $raw.Replace('；', ';')
    $clean = $clean -replace '[\r\n\t]+', ' '

    $items = @((($clean -split '[;,\s]+') | ForEach-Object { $_.Trim(' ', '"', "'") } | Where-Object { $_ }))

    foreach ($email in $items) {
        if ($email -match '[;,\s]') {
            throw "SMTP_TO invalido: endereco contem separador/espaco: '$email'"
        }
        try {
            [void]([System.Net.Mail.MailAddress]::new($email))
        }
        catch {
            throw "SMTP_TO invalido: '$email'"
        }
    }

    return $items
}

function Parse-EmailSingle {
    param([string]$Value, [string]$Name)

    $email = ([string]$Value).Trim(' ', '"', "'")
    if (-not $email) { throw "$Name vazio" }
    if ($email -match '[;,\s]') { throw "$Name invalido (deve ser 1 email). Parece lista (verifique secrets SMTP_FROM vs SMTP_TO): '$email'" }
    try {
        [void]([System.Net.Mail.MailAddress]::new($email))
    }
    catch {
        throw "$Name invalido: '$email'"
    }
    return $email
}

function Get-RequiredEnv {
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

function Format-IsoToBrDate {
    param([string]$Iso)

    $raw = [string]$Iso
    if (-not $raw) { return $raw }
    if ($raw -match '^(\d{4})-(\d{2})-(\d{2})$') {
        return "$($Matches[3])/$($Matches[2])/$($Matches[1])"
    }
    return $raw
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not $SkipSiengeUpdate) {
    Invoke-Step 'Atualizando dados do Sienge (REST)...' 'powershell' @(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'scripts\download_sienge_financeiro_rest.ps1')
    )
    Invoke-Step 'Normalizando dados do Sienge...' 'powershell' @(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'scripts\normalize_dados_sienge.ps1')
    )
    Invoke-Step 'Gerando JSON do dashboard web...' 'node' @(
        (Join-Path $root 'scripts\build_web_dashboard_data.js')
    )
}

Write-Host 'Gerando relatorio semanal (HTML + PDF + snapshot)...' -ForegroundColor Cyan
$reportJsonRaw = & node (Join-Path $root 'scripts\generate_weekly_report.js')
$code = $LASTEXITCODE
if ($code -ne 0) {
    throw "Falha ao gerar relatorio semanal (exit code=$code)."
}
$reportInfo = $reportJsonRaw | ConvertFrom-Json

if (-not $reportInfo.ok) {
    throw 'Falha ao gerar relatorio semanal.'
}

$smtpHost = Get-RequiredEnv 'SMTP_HOST'
$smtpPort = [int](Get-RequiredEnv 'SMTP_PORT')
$smtpUser = Get-RequiredEnv 'SMTP_USER'
$smtpPass = Get-RequiredEnv 'SMTP_PASS'
$smtpFrom = Get-RequiredEnv 'SMTP_FROM'
$smtpTo = Get-RequiredEnv 'SMTP_TO'
$dashboardUrl = Get-EnvOrEmpty 'DASHBOARD_URL'

$smtpFrom = Parse-EmailSingle -Value $smtpFrom -Name 'SMTP_FROM'
$smtpToList = Parse-EmailList -Value $smtpTo
if (-not $smtpToList -or $smtpToList.Count -eq 0) {
    throw 'SMTP_TO vazio (nenhum destinatario valido)'
}

$securePass = ConvertTo-SecureString $smtpPass -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($smtpUser, $securePass)

$weekStart = $reportInfo.week.start
$weekEnd = $reportInfo.week.end

$weekStartBr = Format-IsoToBrDate $weekStart
$weekEndBr = Format-IsoToBrDate $weekEnd

$subject = if ($LayoutTest) {
    "Teste de layout do relatório (HTML + PDF) - semana $weekStartBr a $weekEndBr"
}
else {
    "Relatorio financeiro semanal (Sienge) - $weekStartBr a $weekEndBr"
}

$body = if ($LayoutTest) {
@"
<p>Segue um <strong>teste de layout</strong> do relat&oacute;rio semanal (semana <strong>$weekStart</strong> a <strong>$weekEnd</strong>).</p>
<p>Anexos: <strong>PDF</strong> e <strong>HTML</strong>.</p>
<p>Objetivo: validar o <strong>layout</strong> e a <strong>renderiza&ccedil;&atilde;o</strong> (logo, tipografia, espa&ccedil;amentos e gr&aacute;ficos) no e-mail.</p>
"@
}
else {
@"
<p>Segue o relat&oacute;rio semanal (semana fechada <strong>$weekStartBr</strong> a <strong>$weekEndBr</strong>), com evolu&ccedil;&atilde;o de valores e volume de dados.</p>
<p>Anexos: <strong>PDF</strong> (para leitura/compartilhamento) e <strong>HTML</strong> (vers&atilde;o interativa).</p>
"@
}

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
    To = $smtpToList
    Subject = $subject
    BodyAsHtml = $true
    Body = $body
}

if ($attachments.Count -gt 0) {
    $mailParams.Attachments = $attachments
}

Send-MailMessage @mailParams

Write-Host 'Ok: relatorio enviado.' -ForegroundColor Green
