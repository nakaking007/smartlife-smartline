param(
  [int]$Port = 3000,
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-SmartLifeHealth {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-PortOwner {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
}

if (Test-SmartLifeHealth) {
  [pscustomobject]@{
    status = 'already-running'
    port = $Port
    checkedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  } | ConvertTo-Json -Compress
  exit 0
}

$owner = Get-PortOwner
if ($owner -and $owner.CommandLine -notmatch 'server\.js') {
  throw "Port $Port is already used by another process. SmartLife was not started."
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outLog = Join-Path $LogDir "server-$stamp.out.log"
$errLog = Join-Path $LogDir "server-$stamp.err.log"
$process = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  if (Test-SmartLifeHealth) {
    [pscustomobject]@{
      status = 'started'
      port = $Port
      pid = $process.Id
      outLog = $outLog
      errLog = $errLog
      checkedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    } | ConvertTo-Json -Compress
    exit 0
  }

  if ($process.HasExited) {
    $errText = if (Test-Path $errLog) { Get-Content -Path $errLog -Raw -ErrorAction SilentlyContinue } else { '' }
    throw "SmartLife server exited early. $errText"
  }

  Start-Sleep -Seconds 2
}

throw "SmartLife server did not become healthy on port $Port"