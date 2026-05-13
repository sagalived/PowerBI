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

function Ensure-Secret {
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

$SmtpHost = Ensure-Value -Current $SmtpHost -Label 'SMTP_HOST (ex: smtp.office365.com)'
$SmtpUser = Ensure-Value -Current $SmtpUser -Label 'SMTP_USER (email/usuario do SMTP)'
$SmtpPass = Ensure-Secret -Current $SmtpPass -Label 'SMTP_PASS (senha/app password)'
$MailFrom = Ensure-Value -Current $MailFrom -Label 'SMTP_FROM (remetente, ex: financeiro@empresa.com)'

if (-not $Recipients) {
    $Recipients = 'rafael@dinamicaempreendimentos.com.br;gestao@dinamicaempreendimentos.com.br;gestaoti@dinamicaempreendimentos.com'
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
