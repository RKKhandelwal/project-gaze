# bootstrap.ps1
#
# Lightweight, public wrapper for Trellis VM Setup initialization.
# Exchanges Client credentials for a scoped JWT and executes the private installer.
# =============================================================================
[CmdletBinding()]
Param(
    [Parameter(Mandatory=$true)]
    [string]$ClientId,

    [Parameter(Mandatory=$true)]
    [string]$ClientSecret,

    [Parameter(Mandatory=$false)]
    [string]$BaseUrl = "https://coordinator.prod.api.runtrellis.com",

    [Parameter(Mandatory=$false)]
    [string]$BotsCsv,

    [Parameter(Mandatory=$false)]
    [string]$Ref = "main"
)

$ErrorActionPreference = "Stop"

# --- 1. ADMIN CHECK ---
$current = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Must be run elevated as Administrator!"
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host "--- Trellis Bootstrapper: Authenticating ---" -ForegroundColor Cyan

# --- 2. EXCHANGE M2M CREDENTIALS FOR SCOPED JWT ---
$tokenBody = @{
    client_id = $ClientId
    client_secret = $ClientSecret
} | ConvertTo-Json

try {
    $tokenResp = Invoke-RestMethod -Method POST -Uri "$BaseUrl/v1/m2m/token" `
        -ContentType "application/json" -Body $tokenBody
} catch {
    throw "Authentication failed: $_"
}

$Jwt = $tokenResp.access_token
if (-not $Jwt) {
    throw "Failed to retrieve access token from backend."
}

Write-Host "Authentication successful." -ForegroundColor Green
Write-Host "Fetching full installer script..." -ForegroundColor Gray

# --- 3. FETCH FULL PRIVATE INSTALLER (install.ps1) ---
$headers = @{
    Authorization = "Bearer $Jwt"
}

$url = "$BaseUrl/v1/scripts/tcu-cli/install.ps1?ref=$Ref"
try {
    $installerScript = Invoke-RestMethod -Uri $url -Headers $headers
} catch {
    throw "Failed to fetch private installer script from backend scripts proxy: $_"
}

# --- 4. EXECUTE FULL INSTALLER ---
$tmpPath = Join-Path $env:TEMP "trellis-install-$($Ref)-$(Get-Date -Format yyyyMMddHHmmss).ps1"
$installerScript | Set-Content -Path $tmpPath -Encoding UTF8

Write-Host "Executing full installer..." -ForegroundColor Green

$argsList = @("-AccessToken", $Jwt, "-BaseUrl", $BaseUrl)
if ($BotsCsv) {
    $argsList += @("-BotsCsv", $BotsCsv)
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmpPath @argsList

# Clean up temp file
Remove-Item $tmpPath -Force -ErrorAction SilentlyContinue
