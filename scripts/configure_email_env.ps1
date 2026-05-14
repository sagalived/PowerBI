param(
    [string]$SmtpHost,
    [int]$SmtpPort,
    [string]$SmtpUser,
    [string]$SmtpPass,
    [string]$MailFrom,
    [string]$Recipients,
    [string]$DashboardUrl
)

$ErrorActionPreference = 'Stop'

function Get-RequiredValue {
    param(
        [string]$Current,
        [string]$Label
    )

    if ($Current) {
        return $Current
    }

    return Read-Host -Prompt $Label
}

function Get-RequiredSecret {
    param(
        [string]$Current,
        [string]$Label
    )

    if ($Current) {
        return $Current
    }

    $secure = Read-Host -Prompt $Label -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if (-not $SmtpPort) { $SmtpPort = 587 }

if (-not $SmtpUser) {
    $SmtpUser = 'servicotecnicos@dinamicaempreendimentos.com'
}

if (-not $MailFrom) {
    $MailFrom = 'servicotecnicos@dinamicaempreendimentos.com'
}

$SmtpHost = Get-RequiredValue -Current $SmtpHost -Label 'SMTP_HOST (ex: smtp.office365.com)'
$SmtpUser = Get-RequiredValue -Current $SmtpUser -Label 'SMTP_USER (email/usuario do SMTP)'
$SmtpPass = Get-RequiredSecret -Current $SmtpPass -Label 'SMTP_PASS (senha/app password)'
$MailFrom = Get-RequiredValue -Current $MailFrom -Label 'SMTP_FROM (remetente, ex: financeiro@empresa.com)'

if (-not $Recipients) {
    $existingRecipients = [Environment]::GetEnvironmentVariable('SMTP_TO', 'User')
    if ($existingRecipients) {
        $Recipients = $existingRecipients
    }
    else {
        $Recipients = Read-Host -Prompt 'SMTP_TO (destinatarios separados por ; )'
    }
}

if (-not $DashboardUrl) {
    $DashboardUrl = ''
}

if (-not $SmtpHost -or -not $SmtpUser -or -not $SmtpPass -or -not $MailFrom) {
    throw 'Valores invalidos. SMTP_HOST, SMTP_USER, SMTP_PASS e SMTP_FROM sao obrigatorios.'
}

[Environment]::SetEnvironmentVariable('SMTP_HOST', $SmtpHost, 'User')
[Environment]::SetEnvironmentVariable('SMTP_PORT', "$SmtpPort", 'User')
[Environment]::SetEnvironmentVariable('SMTP_USER', $SmtpUser, 'User')
[Environment]::SetEnvironmentVariable('SMTP_PASS', $SmtpPass, 'User')
[Environment]::SetEnvironmentVariable('SMTP_FROM', $MailFrom, 'User')
[Environment]::SetEnvironmentVariable('SMTP_TO', $Recipients, 'User')
[Environment]::SetEnvironmentVariable('DASHBOARD_URL', $DashboardUrl, 'User')

Write-Host 'Variaveis gravadas no escopo User.' -ForegroundColor Green
Write-Host 'Reabra o terminal/VS Code para aplicar na sessao atual.' -ForegroundColor Yellow
