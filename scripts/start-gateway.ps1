param(
  [ValidateSet("testnet", "mainnet")]
  [string]$Network = "testnet"
)

$envFile = if ($Network -eq "mainnet") { ".env.mainnet" } else { ".env" }

if (-not (Test-Path $envFile)) {
  Write-Error "Environment file '$envFile' not found. Copy .env.example and configure it."
  exit 1
}

# Load env vars from the chosen file
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#')) {
    $parts = $line -split '=', 2
    if ($parts.Length -eq 2) {
      [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')
    }
  }
}

Write-Host "Starting RequestTap Gateway ($Network) with $envFile" -ForegroundColor Cyan
Set-Location "C:\websites\RequestTap\RequestTap-Router"
node packages/gateway/dist/index.js
