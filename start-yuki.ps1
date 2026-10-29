$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 3031

function Test-PortOpen {
  param([int]$CandidatePort)
  $probe = [System.Net.Sockets.TcpClient]::new()
  try {
    $probe.Connect("127.0.0.1", $CandidatePort)
    return $true
  }
  catch {
    return $false
  }
  finally {
    $probe.Dispose()
  }
}

while (Test-PortOpen $port) { $port++ }

Set-Location -LiteralPath $projectRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$oldPort = $env:PORT
$env:PORT = [string]$port

try {
  $server = Start-Process -FilePath $nodePath `
    -ArgumentList @("--env-file-if-exists=.env", "server.js") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -PassThru
}
finally {
  $env:PORT = $oldPort
}

$ready = $false
for ($attempt = 0; $attempt -lt 80; $attempt++) {
  if ($server.HasExited) { break }
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $client.Connect("127.0.0.1", $port)
    $client.Dispose()
    $ready = $true
    break
  }
  catch {
    Start-Sleep -Milliseconds 150
  }
}

if (-not $ready) {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
  throw "Yuki sunucusu başlatılamadı (port $port)."
}

$browserCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe")
)
$browser = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if (-not $browser) {
  Write-Host "Edge veya Chrome bulunamadı. Yuki şu adreste hazır: http://127.0.0.1:$port"
  exit 0
}

Start-Process -FilePath $browser -ArgumentList @(
  "--new-window",
  "--app=http://127.0.0.1:$port"
)
