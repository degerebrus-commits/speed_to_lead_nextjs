# Calls the reminder endpoint. Run on a schedule - every five minutes is
# plenty, because the endpoint is idempotent and an appointment already
# reminded is never picked up again.
#
# Reads the secret from .env rather than taking it as an argument, so it never
# appears in a scheduled-task definition or a process list.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

if (-not (Test-Path $envFile)) {
    Write-Error "No .env at $envFile"
    exit 1
}

$secret = $null
$baseUrl = "http://localhost:3100"

foreach ($line in Get-Content $envFile) {
    if ($line -match '^LEAD_WEBHOOK_SECRET=(.*)$') {
        $secret = $matches[1].Trim().Trim('"').Trim("'")
    }
    if ($line -match '^REMINDER_BASE_URL=(.*)$') {
        $baseUrl = $matches[1].Trim().Trim('"').Trim("'")
    }
}

if (-not $secret) {
    Write-Error "LEAD_WEBHOOK_SECRET is not set in .env"
    exit 1
}

try {
    $response = Invoke-RestMethod -Method Post `
        -Uri "$baseUrl/api/appointments/reminders" `
        -Headers @{ "x-webhook-secret" = $secret } `
        -TimeoutSec 60

    # Counts only. Message bodies carry customer names and appointment times,
    # and this output goes to a log file nobody is guarding.
    Write-Output ("{0}  due={1} sent={2} failed={3} skipped={4}" -f `
        (Get-Date -Format "s"), $response.due, $response.sent, $response.failed, $response.skipped)
}
catch {
    Write-Output ("{0}  reminder run failed: {1}" -f (Get-Date -Format "s"), $_.Exception.Message)
    exit 1
}
