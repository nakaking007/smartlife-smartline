param(
  [int]$Port = 3000,
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Read-EnvMap {
  $map = @{}
  Get-Content -Encoding UTF8 -Path '.env' | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $parts = $_ -split '=', 2
    $map[$parts[0].Trim()] = $parts[1].Trim()
  }
  return $map
}

function Set-EnvValue {
  param(
    [string]$Key,
    [string]$Value
  )

  $path = Join-Path $ProjectRoot '.env'
  $lines = [System.Collections.Generic.List[string]]::new()
  $found = $false

  Get-Content -Encoding UTF8 -Path $path | ForEach-Object {
    if ($_ -match "^\s*$([regex]::Escape($Key))=") {
      $lines.Add("$Key=$Value")
      $found = $true
    } else {
      $lines.Add($_)
    }
  }

  if (-not $found) {
    $lines.Add("$Key=$Value")
  }

  Set-Content -Encoding UTF8 -Path $path -Value $lines
}

function Stop-SmartLifeServerOnPort {
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -match 'server\.js') {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

function Stop-SmartLifeTunnels {
  $tunnels = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "--url\s+http://127\.0\.0\.1:$Port" }

  foreach ($tunnel in $tunnels) {
    Stop-Process -Id $tunnel.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ForHealth {
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    try {
      $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 5
      if ($res.StatusCode -eq 200) { return $true }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  throw "SmartLife server did not become healthy on port $Port"
}

function Start-SmartLifeServer {
  Stop-SmartLifeServerOnPort
  Start-Sleep -Seconds 2

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outLog = Join-Path $LogDir "server-$stamp.out.log"
  $errLog = Join-Path $LogDir "server-$stamp.err.log"
  $process = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

  Wait-ForHealth | Out-Null
  return $process
}

function Start-SmartLifeTunnel {
  Stop-SmartLifeTunnels
  Start-Sleep -Seconds 2

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outLog = Join-Path $LogDir "cloudflared-$stamp.out.log"
  $errLog = Join-Path $LogDir "cloudflared-$stamp.err.log"
  $process = Start-Process -FilePath 'cloudflared' -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$Port", '--no-autoupdate') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $content = ''
    if (Test-Path $outLog) { $content += Get-Content -Path $outLog -Raw -ErrorAction SilentlyContinue }
    if (Test-Path $errLog) { $content += "`n" + (Get-Content -Path $errLog -Raw -ErrorAction SilentlyContinue) }
    $match = [regex]::Match($content, 'https://[-a-zA-Z0-9]+\.trycloudflare\.com')
    if ($match.Success) {
      return @{
        Process = $process
        Url = $match.Value
      }
    }
  }

  throw "Cloudflare tunnel URL was not found in logs"
}

function Update-LineWebhook {
  param([string]$PublicUrl)

  $envMap = Read-EnvMap
  $token = $envMap['LINE_ACCESS_TOKEN']
  if (-not $token) {
    throw "LINE_ACCESS_TOKEN is not configured"
  }

  $endpoint = "$PublicUrl/webhooks/line"
  Invoke-RestMethod -Method Put -Uri 'https://api.line.me/v2/bot/channel/webhook/endpoint' -Headers @{
    Authorization = "Bearer $token"
    'Content-Type' = 'application/json'
  } -Body (@{ endpoint = $endpoint } | ConvertTo-Json -Compress) -TimeoutSec 30 | Out-Null

  $test = Invoke-RestMethod -Method Post -Uri 'https://api.line.me/v2/bot/channel/webhook/test' -Headers @{
    Authorization = "Bearer $token"
    'Content-Type' = 'application/json'
  } -Body (@{ endpoint = $endpoint } | ConvertTo-Json -Compress) -TimeoutSec 30

  if (-not $test.success) {
    throw "LINE webhook test failed for $endpoint"
  }

  return $endpoint
}

$server = Start-SmartLifeServer
$tunnel = Start-SmartLifeTunnel
Set-EnvValue -Key 'PUBLIC_BASE_URL' -Value $tunnel.Url

# Restart once so link cards use the fresh PUBLIC_BASE_URL from .env.
Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$server = Start-SmartLifeServer

$endpoint = Update-LineWebhook -PublicUrl $tunnel.Url

[pscustomobject]@{
  ServerPid = $server.Id
  TunnelPid = $tunnel.Process.Id
  PublicUrl = $tunnel.Url
  WebhookEndpoint = $endpoint
  StartedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
} | ConvertTo-Json -Compress
