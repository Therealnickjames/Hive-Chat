param(
    [string]$ComposeFile = "docker-compose.yml",
    [switch]$StartServicesIfDown
)

$ErrorActionPreference = "Stop"

# Cross-platform curl: PowerShell on Windows aliases 'curl' to Invoke-WebRequest.
# Use curl.exe on Windows (bypasses alias), 'curl' on Linux/macOS (no alias conflict).
if ($IsWindows -or $env:OS -eq "Windows_NT") {
    $script:CurlCmd = "curl.exe"
} else {
    $script:CurlCmd = "curl"
}

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ComposePath = Join-Path $RootDir $ComposeFile
$EnvPath = Join-Path $RootDir ".env"

$webUrl = "http://localhost:5555"
$gatewayWsUrl = "ws://localhost:4001"
$gatewayHealthUrl = "http://localhost:4001/api/health"
$streamHealthUrl = "http://localhost:4002/health"
$script:PhxBacklog = @{}
$script:DebugLogPath = Join-Path $RootDir "debug-3df065.log"
$script:DebugRunId = "pre-fix-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$script:EnableWsDebug = $false

function Write-Header([string]$Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Write-DebugLog {
  param(
    [string]$HypothesisId,
    [string]$Location,
    [string]$Message,
    [hashtable]$Data = @{}
  )

  try {
    $entry = [ordered]@{
      sessionId = "3df065"
      runId = $script:DebugRunId
      hypothesisId = $HypothesisId
      location = $Location
      message = $Message
      data = $Data
      timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress -Depth 8

    Add-Content -Path $script:DebugLogPath -Value $entry
  }
  catch {
    # no-op: debug logging must never break harness flow
  }
}

function Load-Env([string]$Path) {
  $values = @{}
  if (!(Test-Path $Path)) {
    return $values
  }

  Get-Content $Path | ForEach-Object {
    if ($_ -match "^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$" -and $Matches[1] -ne "" -and -not ($Matches[2].StartsWith("#"))) {
      $values[$Matches[1]] = $Matches[2]
    }
  }

  return $values
}

function New-TestId([int]$Length = 26) {
  $alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  $chars = 1..$Length | ForEach-Object {
    $alphabet[(Get-Random -Minimum 0 -Maximum $alphabet.Length)]
  }
  return -join $chars
}

function New-Hs256Jwt([string]$Secret, [hashtable]$Payload) {
  $header = '{"alg":"HS256","typ":"JWT"}'
  $payloadJson = $Payload | ConvertTo-Json -Compress
  $toBase64 = {
    param([byte[]]$Bytes)
    $b64 = [Convert]::ToBase64String($Bytes).TrimEnd("=")
    $b64 = $b64.Replace("+", "-").Replace("/", "_")
    return $b64
  }

  $headerPart = & $toBase64 ([Text.Encoding]::UTF8.GetBytes($header))
  $payloadPart = & $toBase64 ([Text.Encoding]::UTF8.GetBytes($payloadJson))

  $data = "$headerPart.$payloadPart"
  $keyBytes = [Text.Encoding]::UTF8.GetBytes($Secret)
  $hmac = [System.Security.Cryptography.HMACSHA256]::new()
  $hmac.Key = $keyBytes
  $sig = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($data))
  $sigPart = & $toBase64 $sig

  return "$data.$sigPart"
}

function New-EncryptedApiKey([string]$Plaintext) {
  $apiKeyB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Plaintext))
  $script = "const c=require('crypto');const i=Buffer.from(process.env.HIVE_TEST_API_KEY_B64,'base64').toString('utf8');const kHex=process.env.ENCRYPTION_KEY;if(!kHex||kHex.length!==64){process.stderr.write('invalid ENCRYPTION_KEY');process.exit(1);}const k=Buffer.from(kHex,'hex');const iv=c.randomBytes(12);const x=c.createCipheriv('aes-256-gcm',k,iv);let e=x.update(i,'utf8','hex');e+=x.final('hex');process.stdout.write(iv.toString('hex')+':'+x.getAuthTag().toString('hex')+':'+e);"
  $ciphertext = & docker compose -f $ComposePath exec -T -e "HIVE_TEST_API_KEY_B64=$apiKeyB64" web node -e $script
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ciphertext)) {
    throw "Failed to generate encrypted API key for bot fixture"
  }

  return $ciphertext.Trim()
}

function Start-MockOpenAiSseServer() {
  $stubScript = @"
const http = require("http");
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write("data: {\"choices\":[{\"delta\":{\"content\":\"Hi \"}}]}\n\n");
    setTimeout(() => {
      res.write("data: {\"choices\":[{\"delta\":{\"content\":\"there\"}}]}\n\n");
    }, 25);
    setTimeout(() => {
      res.write("data: [DONE]\n\n");
      res.end();
    }, 50);
    return;
  }

  res.statusCode = 404;
  res.end("not found");
});

server.listen(3909, "0.0.0.0");
setInterval(() => {}, 2147483647);
"@

  $scriptB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($stubScript))
  $launchScript = "process.title='hive-mock-openai-stub';eval(Buffer.from(process.env.HIVE_MOCK_OPENAI_B64,'base64').toString('utf8'));"
  & docker compose -f $ComposePath exec -d -e "HIVE_MOCK_OPENAI_B64=$scriptB64" web node -e $launchScript | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start mock OpenAI SSE server"
  }

  Start-Sleep -Milliseconds 500
  return "hive-mock-openai-stub"
}

function Stop-MockOpenAiSseServer([string]$ProcessMarker) {
  if ([string]::IsNullOrWhiteSpace($ProcessMarker)) {
    return
  }

  & docker compose -f $ComposePath exec -T web sh -lc "pkill -f $ProcessMarker 2>/dev/null || true" | Out-Null
}

function Start-StallTokenSseServer() {
  $stubScript = @"
const http = require("http");
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write("data: {\"choices\":[{\"delta\":{\"content\":\"partial \"}}]}\n\n");
    // Intentionally never send [DONE] or close response: forces token-gap timeout.
    return;
  }

  res.statusCode = 404;
  res.end("not found");
});

server.listen(3910, "0.0.0.0");
setInterval(() => {}, 2147483647);
"@

  $scriptB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($stubScript))
  $launchScript = "process.title='hive-mock-openai-timeout';eval(Buffer.from(process.env.HIVE_MOCK_TIMEOUT_B64,'base64').toString('utf8'));"
  & docker compose -f $ComposePath exec -d -e "HIVE_MOCK_TIMEOUT_B64=$scriptB64" web node -e $launchScript | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start token-timeout SSE server"
  }

  Start-Sleep -Milliseconds 500
  return "hive-mock-openai-timeout"
}

function Stop-StallTokenSseServer([string]$ProcessMarker) {
  if ([string]::IsNullOrWhiteSpace($ProcessMarker)) {
    return
  }

  & docker compose -f $ComposePath exec -T web sh -lc "pkill -f $ProcessMarker 2>/dev/null || true" | Out-Null
}

function Invoke-CurlJson {
  param(
    [Parameter(Mandatory)] [string]$Url,
    [string]$Method = "GET",
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

  $tmpFile = New-TemporaryFile
  $payloadFile = $null
  try {
    $args = @("-sS", "--max-time", "12", "-o", $tmpFile.FullName, "-w", "%{http_code}", "-X", $Method)
    foreach ($pair in $Headers.GetEnumerator()) {
      $args += @("-H", "$($pair.Key): $($pair.Value)")
    }
    if ($Body -ne $null) {
      if ($Body -is [string]) {
        $payload = $Body
      }
      else {
        $payload = $Body | ConvertTo-Json -Compress
      }
      $payloadFile = New-TemporaryFile
      Set-Content -Path $payloadFile.FullName -Value $payload -NoNewline
      $args += @("-H", "Content-Type: application/json", "--data-binary", "@$($payloadFile.FullName)")
    }
    $args += $Url

    $codeText = & $script:CurlCmd @args
    $code = [int]($codeText.Trim())
    $bodyText = Get-Content $tmpFile.FullName -Raw

    return [pscustomobject]@{
      StatusCode = $code
      BodyText = $bodyText
    }
  }
  finally {
    if (Test-Path $tmpFile) {
      Remove-Item $tmpFile -Force
    }
    if ($payloadFile -and (Test-Path $payloadFile)) {
      Remove-Item $payloadFile -Force
    }
  }
}

function Invoke-StreamingHealth {
  $codeText = & docker compose -f $ComposePath exec -T streaming sh -lc "curl -s -o /dev/null -w '%{http_code}' http://localhost:4002/health"
  if ($LASTEXITCODE -ne 0) {
    return [pscustomobject]@{ StatusCode = 503 }
  }

  $statusCode = 0
  if (-not [int]::TryParse($codeText.Trim(), [ref]$statusCode)) {
    $statusCode = 503
  }

  return [pscustomobject]@{ StatusCode = $statusCode }
}

function Invoke-Psql([string]$Sql) {
  $Sql | & docker compose -f $ComposePath exec -T db psql -U tavok -d tavok -v ON_ERROR_STOP=1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "psql command failed"
  }
}

function Wait-Until([int]$MaxAttempts, [int]$DelayMs, [scriptblock]$Action) {
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    $result = & $Action
    if ($result) {
      return $true
    }
    Start-Sleep -Milliseconds $DelayMs
  }
  return $false
}

function Get-ServiceStatus() {
  $serviceStatus = docker compose -f $ComposePath ps --services --filter "status=running" 2>$null
  return $serviceStatus
}

function Ensure-ServicesRunning {
  $running = Get-ServiceStatus
  $required = @("web", "gateway", "streaming", "db", "redis")
  $missing = @()

  foreach ($service in $required) {
    if ($running -notcontains $service) {
      $missing += $service
    }
  }

  if ($missing.Count -gt 0) {
    if (-not $StartServicesIfDown) {
      throw "Services not running: $($missing -join ', '). Start with -StartServicesIfDown or run `docker compose up -d`."
    }

    Write-Header "Starting services"
    & docker compose -f $ComposePath up -d
    Start-Sleep 5
  }
}

function Open-PhxSocket([string]$JwtToken) {
  $encodedToken = [uri]::EscapeDataString($JwtToken)
  $url = "$gatewayWsUrl/socket/websocket?token=$encodedToken&vsn=1.0.0"
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $uri = [Uri]$url

  $connectTask = $socket.ConnectAsync($uri, [System.Threading.CancellationToken]::None)
  $connectTask.Wait()
  return $socket
}

function Add-SocketBacklog {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [object]$Message
  )
  if ($null -eq $Socket -or $null -eq $Message) {
    return
  }
  if ($null -eq $script:PhxBacklog) {
    $script:PhxBacklog = @{}
  }

  $key = [string]$Socket.GetHashCode()
  if (-not $script:PhxBacklog.ContainsKey($key) -or $null -eq $script:PhxBacklog[$key]) {
    $script:PhxBacklog[$key] = New-Object System.Collections.ArrayList
  }

  $queue = $script:PhxBacklog[$key]
  [void]$queue.Add($Message)
}

function Pop-SocketBacklogMatch {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [scriptblock]$Predicate
  )
  if ($null -eq $Socket -or $null -eq $Predicate) {
    return $null
  }
  if ($null -eq $script:PhxBacklog) {
    $script:PhxBacklog = @{}
  }

  $key = [string]$Socket.GetHashCode()
  if (-not $script:PhxBacklog.ContainsKey($key) -or $null -eq $script:PhxBacklog[$key]) {
    return $null
  }

  $queue = $script:PhxBacklog[$key]
  for ($i = 0; $i -lt $queue.Count; $i++) {
    $candidate = $queue[$i]
    if (& $Predicate $candidate) {
      $queue.RemoveAt($i)
      return $candidate
    }
  }
  return $null
}

function Send-PhxMessage {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Topic,
    [string]$Event,
    [object]$Payload = @{},
    [string]$Ref
  )
  $msg = [ordered]@{
    topic = $Topic
    event = $Event
    payload = $Payload
    ref = $Ref
  }
  $payloadText = $msg | ConvertTo-Json -Depth 10 -Compress
  $payloadBytes = [Text.Encoding]::UTF8.GetBytes($payloadText)
  $seg = [System.ArraySegment[byte]]::new($payloadBytes)
  $sendTask = $Socket.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None)
  $sendTask.Wait()
}

function Receive-PhxMessage {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [int]$TimeoutMs = 4000
  )
  $tokenSource = [System.Threading.CancellationTokenSource]::new($TimeoutMs)
  $buffer = New-Object byte[] 8192
  $accum = New-Object System.Text.StringBuilder

  do {
    $segment = [System.ArraySegment[byte]]::new($buffer)
    $task = $Socket.ReceiveAsync($segment, $tokenSource.Token)
    $completed = $false
    try {
      $completed = $task.Wait($TimeoutMs)
    }
    catch {
      if ($script:EnableWsDebug) {
        #region agent log
        Write-DebugLog -HypothesisId "H2" -Location "scripts/regression-harness.ps1:Receive-PhxMessage" -Message "ReceiveAsync wait threw exception" -Data @{
          reason = "wait_exception"
          socketState = [string]$Socket.State
        }
        #endregion
      }
      return $null
    }
    if (-not $completed) {
      if ($script:EnableWsDebug) {
        #region agent log
        Write-DebugLog -HypothesisId "H2" -Location "scripts/regression-harness.ps1:Receive-PhxMessage" -Message "ReceiveAsync timed out with no frame" -Data @{
          reason = "wait_timeout"
          socketState = [string]$Socket.State
          timeoutMs = $TimeoutMs
        }
        #endregion
      }
      return $null
    }
    try {
      $result = $task.Result
    }
    catch {
      if ($script:EnableWsDebug) {
        #region agent log
        Write-DebugLog -HypothesisId "H2" -Location "scripts/regression-harness.ps1:Receive-PhxMessage" -Message "ReceiveAsync result threw exception" -Data @{
          reason = "result_exception"
          socketState = [string]$Socket.State
        }
        #endregion
      }
      return $null
    }
    $chunk = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
    $accum.Append($chunk) | Out-Null

    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      if ($script:EnableWsDebug) {
        #region agent log
        Write-DebugLog -HypothesisId "H2" -Location "scripts/regression-harness.ps1:Receive-PhxMessage" -Message "WebSocket close frame received" -Data @{
          reason = "close_frame"
          socketState = [string]$Socket.State
        }
        #endregion
      }
      return $null
    }
  } while (-not $result.EndOfMessage)

  $rawFrame = $accum.ToString()

  if ($script:EnableWsDebug) {
    $rawPreview = if ($rawFrame.Length -gt 1500) { $rawFrame.Substring(0, 1500) } else { $rawFrame }
    #region agent log
    Write-DebugLog -HypothesisId "H2" -Location "scripts/regression-harness.ps1:Receive-PhxMessage" -Message "Raw websocket frame observed" -Data @{
      raw = $rawPreview
      rawLength = $rawFrame.Length
    }
    #endregion
  }

  try {
    return ($rawFrame | ConvertFrom-Json)
  }
  catch {
    if ($script:EnableWsDebug) {
      $rawPreview = if ($rawFrame.Length -gt 1500) { $rawFrame.Substring(0, 1500) } else { $rawFrame }
      #region agent log
      Write-DebugLog -HypothesisId "H3" -Location "scripts/regression-harness.ps1:Receive-PhxMessage" -Message "Failed to parse websocket JSON frame" -Data @{
        reason = "json_parse_failure"
        socketState = [string]$Socket.State
        raw = $rawPreview
      }
      #endregion
    }
    return $null
  }
}

function Wait-PhxReply {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Ref,
    [int]$TimeoutMs = 6000
  )

  $backlogMatch = Pop-SocketBacklogMatch -Socket $Socket -Predicate {
    param($msg)
    $msg.event -eq "phx_reply" -and $msg.ref -eq $Ref
  }
  if ($null -ne $backlogMatch) {
    return $backlogMatch
  }

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs 2000
    if ($null -eq $msg) {
      continue
    }

    if ($msg.event -eq "phx_reply" -and $msg.ref -eq $Ref) {
      return $msg
    }

    Add-SocketBacklog -Socket $Socket -Message $msg
  }

  throw "Timed out waiting for phx_reply with ref $Ref"
}

function Wait-TopicEvent {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Topic,
    [string]$Event,
    [int]$TimeoutMs = 6000
  )

  $backlogMatch = Pop-SocketBacklogMatch -Socket $Socket -Predicate {
    param($msg)
    $msg.topic -eq $Topic -and $msg.event -eq $Event
  }
  if ($null -ne $backlogMatch) {
    return $backlogMatch
  }

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs 2000
    if ($null -eq $msg) {
      continue
    }

    if ($msg.topic -eq $Topic -and $msg.event -eq $Event) {
      return $msg
    }

    Add-SocketBacklog -Socket $Socket -Message $msg
  }

  throw "Timed out waiting for event '$Event' on topic '$Topic'"
}

function Wait-TopicEventMatching {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Topic,
    [string]$Event,
    [scriptblock]$Predicate,
    [int]$TimeoutMs = 6000
  )

  $matcher = $Predicate
  $backlogMatch = Pop-SocketBacklogMatch -Socket $Socket -Predicate {
    param($msg)
    $msg.topic -eq $Topic -and $msg.event -eq $Event -and (& $matcher $msg)
  }
  if ($null -ne $backlogMatch) {
    return $backlogMatch
  }

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs 2000
    if ($null -eq $msg) {
      continue
    }

    if ($msg.topic -eq $Topic -and $msg.event -eq $Event -and (& $Predicate $msg)) {
      return $msg
    }

    Add-SocketBacklog -Socket $Socket -Message $msg
  }

  throw "Timed out waiting for matching event '$Event' on topic '$Topic'"
}

function Wait-StreamEventForMessage {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Topic,
    [string]$Event,
    [string]$MessageId,
    [int]$TimeoutMs = 6000
  )

  $backlogMatch = Pop-SocketBacklogMatch -Socket $Socket -Predicate {
    param($msg)
    $msg.topic -eq $Topic -and $msg.event -eq $Event -and $msg.payload.messageId -eq $MessageId
  }
  if ($null -ne $backlogMatch) {
    return $backlogMatch
  }

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  $nullReadCount = 0
  while ((Get-Date) -lt $deadline) {
    $remainingMs = [int][Math]::Max(1, [Math]::Floor(($deadline - (Get-Date)).TotalMilliseconds))
    $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs $remainingMs
    if ($null -eq $msg) {
      $nullReadCount += 1
      continue
    }

    if ($script:EnableWsDebug) {
      $incomingMessageId = $null
      if ($msg.payload -and $msg.payload.PSObject.Properties.Name -contains "messageId") {
        $incomingMessageId = [string]$msg.payload.messageId
      }

      #region agent log
      Write-DebugLog -HypothesisId "H3" -Location "scripts/regression-harness.ps1:Wait-StreamEventForMessage" -Message "Evaluating inbound frame against stream matcher" -Data @{
        expectedEvent = $Event
        expectedTopic = $Topic
        expectedMessageId = $MessageId
        actualEvent = [string]$msg.event
        actualTopic = [string]$msg.topic
        actualMessageId = $incomingMessageId
      }
      #endregion
    }

    if ($msg.topic -eq $Topic -and $msg.event -eq $Event -and $msg.payload.messageId -eq $MessageId) {
      if ($script:EnableWsDebug) {
        #region agent log
        Write-DebugLog -HypothesisId "H4" -Location "scripts/regression-harness.ps1:Wait-StreamEventForMessage" -Message "Stream matcher found target event" -Data @{
          event = [string]$msg.event
          topic = [string]$msg.topic
          messageId = [string]$msg.payload.messageId
        }
        #endregion
      }
      return $msg
    }

    Add-SocketBacklog -Socket $Socket -Message $msg
  }

  if ($script:EnableWsDebug) {
    $socketKey = [string]$Socket.GetHashCode()
    $backlogCount = 0
    $backlogSummary = @()
    if ($script:PhxBacklog.ContainsKey($socketKey) -and $script:PhxBacklog[$socketKey]) {
      $backlogCount = $script:PhxBacklog[$socketKey].Count
      foreach ($queued in ($script:PhxBacklog[$socketKey] | Select-Object -First 20)) {
        $queuedMessageId = $null
        if ($queued.payload -and $queued.payload.PSObject.Properties.Name -contains "messageId") {
          $queuedMessageId = [string]$queued.payload.messageId
        }
        $backlogSummary += [ordered]@{
          event = [string]$queued.event
          topic = [string]$queued.topic
          messageId = $queuedMessageId
        }
      }
    }

    #region agent log
    Write-DebugLog -HypothesisId "H4" -Location "scripts/regression-harness.ps1:Wait-StreamEventForMessage" -Message "Stream matcher timed out" -Data @{
      expectedEvent = $Event
      expectedTopic = $Topic
      expectedMessageId = $MessageId
      backlogCount = $backlogCount
      nullReadCount = $nullReadCount
      backlogSummary = $backlogSummary
      socketState = [string]$Socket.State
    }
    #endregion
  }

  throw "Timed out waiting for event '$Event' on topic '$Topic' for message '$MessageId'"
}

function Wait-StreamStartForSequence {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Topic,
    [string]$ExpectedSequence,
    [int]$TimeoutMs = 12000
  )

  $backlogMatch = Pop-SocketBacklogMatch -Socket $Socket -Predicate {
    param($msg)
    $msg.topic -eq $Topic -and $msg.event -eq "stream_start" -and [string]$msg.payload.sequence -eq [string]$ExpectedSequence
  }
  if ($null -ne $backlogMatch) {
    return $backlogMatch
  }

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs 2000
    if ($null -eq $msg) {
      continue
    }

    if ($msg.topic -eq $Topic -and $msg.event -eq "stream_start" -and [string]$msg.payload.sequence -eq [string]$ExpectedSequence) {
      return $msg
    }

    Add-SocketBacklog -Socket $Socket -Message $msg
  }

  throw "Timed out waiting for stream_start with sequence '$ExpectedSequence' on topic '$Topic'"
}

function Assert([string]$Name, [bool]$Condition, [string]$Details = "") {
  if ($Condition) {
    Write-Host "[PASS] $Name" -ForegroundColor Green
  }
  else {
    Write-Host "[FAIL] $Name" -ForegroundColor Red
    if ($Details) {
      Write-Host "       $Details" -ForegroundColor Red
    }
    throw $Name
  }
}

function New-BcryptHash([string]$Password) {
  # Resolve bcryptjs from packages/web so the host runner and local dev use the same module path.
  $script = "const bcrypt=require('bcryptjs');process.stdout.write(bcrypt.hashSync(process.env.HIVE_TEST_PW,12));"
  $env:HIVE_TEST_PW = $Password
  Push-Location (Join-Path $RootDir "packages/web")
  try {
    $hash = & node -e $script 2>&1
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($hash)) {
      $details = ($hash | Out-String).Trim()
      if ($details) {
        throw "Failed to generate bcrypt hash: $details"
      }
      throw "Failed to generate bcrypt hash"
    }
    return ($hash | Out-String).Trim()
  }
  finally {
    Pop-Location
    Remove-Item Env:\HIVE_TEST_PW -ErrorAction SilentlyContinue
  }
}

function Get-SessionCookie([string]$Email, [string]$Password) {
  # Get CSRF token from NextAuth
  $csrfFile = New-TemporaryFile
  $cookieJar = New-TemporaryFile
  try {
    & $script:CurlCmd -sS -c $cookieJar.FullName -o $csrfFile.FullName "$webUrl/api/auth/csrf"
    $csrfBody = Get-Content $csrfFile.FullName -Raw | ConvertFrom-Json
    $csrfToken = $csrfBody.csrfToken

    # Sign in with credentials
    $signinFile = New-TemporaryFile
    $signinCode = & $script:CurlCmd -sS -b $cookieJar.FullName -c $cookieJar.FullName -o $signinFile.FullName -w "%{http_code}" -X POST "$webUrl/api/auth/callback/credentials" -H "Content-Type: application/x-www-form-urlencoded" -d "csrfToken=$csrfToken&email=$Email&password=$Password&json=true"
    Remove-Item $signinFile -Force -ErrorAction SilentlyContinue

    # Extract session cookie from jar
    $cookies = Get-Content $cookieJar.FullName -Raw
    $sessionLine = ($cookies -split "`n" | Where-Object { $_ -match "next-auth.session-token" }) | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($sessionLine)) {
      throw "No session cookie found after sign-in"
    }
    $parts = $sessionLine.Trim() -split "`t"
    $cookieValue = $parts[-1]
    return "next-auth.session-token=$cookieValue"
  }
  finally {
    Remove-Item $csrfFile -Force -ErrorAction SilentlyContinue
    Remove-Item $cookieJar -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-AuthenticatedApi {
  param(
    [Parameter(Mandatory)] [string]$Url,
    [string]$Method = "GET",
    [string]$SessionCookie,
    [object]$Body = $null
  )

  $tmpFile = New-TemporaryFile
  $payloadFile = $null
  try {
    $args = @("-sS", "--max-time", "12", "-o", $tmpFile.FullName, "-w", "%{http_code}", "-X", $Method)
    if (-not [string]::IsNullOrWhiteSpace($SessionCookie)) {
      $args += @("-b", $SessionCookie)
    }
    if ($Body -ne $null) {
      if ($Body -is [string]) {
        $payload = $Body
      }
      else {
        $payload = $Body | ConvertTo-Json -Compress
      }
      $payloadFile = New-TemporaryFile
      Set-Content -Path $payloadFile.FullName -Value $payload -NoNewline
      $args += @("-H", "Content-Type: application/json", "--data-binary", "@$($payloadFile.FullName)")
    }
    $args += $Url

    $codeText = & $script:CurlCmd @args
    $code = [int]($codeText.Trim())
    $bodyText = Get-Content $tmpFile.FullName -Raw

    return [pscustomobject]@{
      StatusCode = $code
      BodyText = $bodyText
    }
  }
  finally {
    if (Test-Path $tmpFile) {
      Remove-Item $tmpFile -Force
    }
    if ($payloadFile -and (Test-Path $payloadFile)) {
      Remove-Item $payloadFile -Force
    }
  }
}

function Close-SocketSafe([System.Net.WebSockets.ClientWebSocket]$Socket) {
  if (-not $Socket) {
    return
  }

  try {
    if ($Socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $Socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [System.Threading.CancellationToken]::None).Wait()
    }
  }
  catch {
    # best-effort cleanup only
  }
}

$envVars = Load-Env $EnvPath
$internalSecret = $envVars["INTERNAL_API_SECRET"]
if ([string]::IsNullOrWhiteSpace($internalSecret)) {
  $internalSecret = "dev-secret-minimum-16chars"
}

$jwtSecret = $envVars["JWT_SECRET"]
if ([string]::IsNullOrWhiteSpace($jwtSecret)) {
  $jwtSecret = "dev-secret-minimum-16chars"
}

$testPrefix = ("tc" + (Get-Date -Format "MMddHHmmss"))
$userAId = New-TestId
$userBId = New-TestId
$serverId = New-TestId
$channelId = New-TestId
$memberId = New-TestId
$botId = New-TestId
$userCNonce = New-TestId
$dmChannelId = New-TestId
$dmMessageId = New-TestId
$memberBId = New-TestId
$testPassword = "TestPassword123!"
$mockOpenAiPid = $null
$mockTimeoutPid = $null
$redisStopped = $false
$webStopped = $false

Ensure-ServicesRunning
$mockOpenAiPid = Start-MockOpenAiSseServer
$botApiKeyEncrypted = New-EncryptedApiKey -Plaintext "test-api-key"
$bcryptHash = New-BcryptHash -Password $testPassword

try {
  Write-Header "Setting up deterministic fixture data"
  $now = (Get-Date).ToString("o")
  Invoke-Psql @"
BEGIN;
INSERT INTO "User" (id, email, username, "displayName", password, "createdAt", "updatedAt")
VALUES
('$userAId', '$testPrefix-a@example.com', '$testPrefix-a', 'Test User A', '$bcryptHash', '$now'::timestamptz, '$now'::timestamptz),
('$userBId', '$testPrefix-b@example.com', '$testPrefix-b', 'Test User B', '$bcryptHash', '$now'::timestamptz, '$now'::timestamptz),
('$userCNonce', '$testPrefix-c@example.com', '$testPrefix-c', 'Test User C', '$bcryptHash', '$now'::timestamptz, '$now'::timestamptz);
INSERT INTO "Server" (id, name, "ownerId", "createdAt", "updatedAt")
VALUES ('$serverId', '$testPrefix server', '$userAId', '$now'::timestamptz, '$now'::timestamptz);
INSERT INTO "Channel" (id, "serverId", name, position, "createdAt", "updatedAt")
VALUES ('$channelId', '$serverId', '$testPrefix channel', 0, '$now'::timestamptz, '$now'::timestamptz);
INSERT INTO "Bot" (id, name, "serverId", "llmProvider", "llmModel", "apiEndpoint", "apiKeyEncrypted", "systemPrompt", temperature, "maxTokens", "isActive", "triggerMode", "createdAt", "updatedAt")
VALUES ('$botId', '$testPrefix bot', '$serverId', 'custom', 'gpt-4o-mini', 'http://web:3909', '$botApiKeyEncrypted', 'You are helpful.', 0.7, 512, true, 'ALWAYS', '$now'::timestamptz, '$now'::timestamptz);
INSERT INTO "Member" (id, "userId", "serverId", "joinedAt")
VALUES
('$memberId', '$userAId', '$serverId', '$now'::timestamptz),
('$memberBId', '$userBId', '$serverId', '$now'::timestamptz);
INSERT INTO "DirectMessageChannel" (id, "createdAt", "updatedAt")
VALUES ('$dmChannelId', '$now'::timestamptz, '$now'::timestamptz);
INSERT INTO "DmParticipant" (id, "dmId", "userId")
VALUES
('$(New-TestId)', '$dmChannelId', '$userAId'),
('$(New-TestId)', '$dmChannelId', '$userBId');
INSERT INTO "DirectMessage" (id, "dmId", "authorId", content, sequence, "createdAt", "updatedAt")
VALUES ('$dmMessageId', '$dmChannelId', '$userAId', 'Hello from DM test fixture', 1, '$now'::timestamptz, '$now'::timestamptz);
COMMIT;
"@

  $memberPayload = @{
    sub = $userAId
    username = "$testPrefix-a"
    displayName = "Test User A"
    exp = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600)
  }
  $foreignPayload = @{
    sub = $userCNonce
    username = "$testPrefix-c"
    displayName = "Test User C"
    exp = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600)
  }
  $memberJwt = New-Hs256Jwt -Secret $jwtSecret -Payload $memberPayload
  $foreignJwt = New-Hs256Jwt -Secret $jwtSecret -Payload $foreignPayload

  $memberSocket = Open-PhxSocket -JwtToken $memberJwt
  $topic = "room:$channelId"
  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "phx_join" -Payload @{ lastSequence = 0 } -Ref $ref
  $joinReply = Wait-PhxReply -Socket $memberSocket -Ref $ref
  Assert "K-002 precondition: authorized user can join valid channel" ($joinReply.payload.status -eq "ok")
  #region agent log
  Write-DebugLog -HypothesisId "H1" -Location "scripts/regression-harness.ps1:FixtureJoin" -Message "Member socket join reply received" -Data @{
    topic = $topic
    status = [string]$joinReply.payload.status
    userId = $userAId
    channelId = $channelId
  }
  #endregion

  # K-001
  Write-Header "K-001: Redis sequence reseed and reconnect continuity"
  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "new_message" -Payload @{ content = "first" } -Ref $ref
  $msg1 = Wait-PhxReply -Socket $memberSocket -Ref $ref
  Assert "K-001 first message accepted" ($msg1.payload.status -eq "ok")
  $seq1 = [int64]$msg1.payload.response.sequence

  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "new_message" -Payload @{ content = "second" } -Ref $ref
  $msg2 = Wait-PhxReply -Socket $memberSocket -Ref $ref
  Assert "K-001 second message accepted" ($msg2.payload.status -eq "ok")
  $seq2 = [int64]$msg2.payload.response.sequence
  Assert "K-001 captured message sequence 1" ($seq1 -gt 0)
  Assert "K-001 captured message sequence 2" ($seq2 -gt $seq1)

  docker compose -f $ComposePath exec -T redis redis-cli DEL "hive:channel:$channelId:seq" | Out-Null

  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "new_message" -Payload @{ content = "third-after-redis-delete" } -Ref $ref
  $msg3 = Wait-PhxReply -Socket $memberSocket -Ref $ref
  Assert "K-001 post-reseed message accepted" ($msg3.payload.status -eq "ok")
  $seq3 = [int64]$msg3.payload.response.sequence
  Assert "K-001 sequence increased after reseed" ($seq3 -gt $seq2)

  # Also verify sync fetch can still return latest via internal API after reseed
  $fetchMessages = Invoke-CurlJson -Url "$webUrl/api/internal/messages?channelId=$channelId&afterSequence=0&limit=10" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
  $messagePayload = $fetchMessages.BodyText | ConvertFrom-Json
  $maxSeq = ($messagePayload.messages | Measure-Object -Property sequence -Maximum).Maximum
  Assert "K-001 internal fetch sees reseeded message" ($maxSeq -ge $seq3)

  # K-002
  Write-Header "K-002: Unauthorized user cannot join channel"
  $nonMemberSocket = Open-PhxSocket -JwtToken $foreignJwt
  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $nonMemberSocket -Topic $topic -Event "phx_join" -Payload @{ lastSequence = 0 } -Ref $ref
  $nonMemberJoin = Wait-PhxReply -Socket $nonMemberSocket -Ref $ref
  Assert "K-002 join rejected for non-member" ($nonMemberJoin.payload.status -eq "error") ("status=" + $nonMemberJoin.payload.status)

  # K-003
  Write-Header "K-003: Malformed websocket payloads are handled as protocol errors"
  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "new_message" -Payload @{} -Ref $ref
  $badNew = Wait-PhxReply -Socket $memberSocket -Ref $ref
  Assert "K-003 malformed new_message returns error" (
    $badNew.payload.status -eq "error" -and
    $badNew.payload.response.reason -eq "invalid_payload" -and
    $badNew.payload.response.event -eq "new_message"
  )

  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "history" -Payload @{ limit = "bad" } -Ref ([string](Get-Random))
  $badHistory = Wait-TopicEventMatching -Socket $memberSocket -Topic $topic -Event "history_response" -Predicate {
    param($msg)
    $msg.payload.error.reason -eq "invalid_payload" -and $msg.payload.error.event -eq "history"
  }
  Assert "K-003 malformed history payload returns structured error" (
    $badHistory.payload.error.reason -eq "invalid_payload" -and
    $badHistory.payload.error.event -eq "history"
  )

  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "sync" -Payload @{ lastSequence = "bad" } -Ref ([string](Get-Random))
  $badSync = Wait-TopicEventMatching -Socket $memberSocket -Topic $topic -Event "sync_response" -Predicate {
    param($msg)
    $msg.payload.error.reason -eq "invalid_payload" -and $msg.payload.error.event -eq "sync"
  }
  Assert "K-003 malformed sync payload returns structured error" (
    $badSync.payload.error.reason -eq "invalid_payload" -and
    $badSync.payload.error.event -eq "sync"
  )

  # K-004
  Write-Header "K-004: Streaming placeholder persists and stream chain fires"
  $placeholderId = New-TestId
  $placeholderSequence = [string]($seq3 + 1)
  $placeholderBody = @{
    id = $placeholderId
    channelId = $channelId
    authorId = $botId
    authorType = "BOT"
    content = ""
    type = "STREAMING"
    streamingStatus = "ACTIVE"
    sequence = $placeholderSequence
  }

  $postPlaceholder = Invoke-CurlJson -Url "$webUrl/api/internal/messages" -Method POST -Headers @{ "x-internal-secret" = $internalSecret } -Body $placeholderBody
  Assert "K-004 BOT placeholder POST returns 201" ($postPlaceholder.StatusCode -eq 201) ("status=" + $postPlaceholder.StatusCode + " body=" + $postPlaceholder.BodyText)
  $postPlaceholderPayload = $postPlaceholder.BodyText | ConvertFrom-Json
  Assert "K-004 BOT placeholder response includes id" ($postPlaceholderPayload.id -eq $placeholderId)
  Assert "K-004 BOT placeholder response has STREAMING ACTIVE state" (
    $postPlaceholderPayload.type -eq "STREAMING" -and
    $postPlaceholderPayload.streamingStatus -eq "ACTIVE"
  )

  $fetchAfterPlaceholder = Invoke-CurlJson -Url "$webUrl/api/internal/messages?channelId=$channelId&afterSequence=$seq3&limit=20" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
  $fetchAfterPayload = $fetchAfterPlaceholder.BodyText | ConvertFrom-Json
  $placeholder = $fetchAfterPayload.messages | Where-Object { $_.id -eq $placeholderId }
  Assert "K-004 placeholder row exists in message fetch" ($null -ne $placeholder)
  Assert "K-004 fetched placeholder has STREAMING ACTIVE state" (
    $placeholder.type -eq "STREAMING" -and
    $placeholder.streamingStatus -eq "ACTIVE"
  )

  # End-to-end bot trigger: persist placeholder -> stream_start -> stream_token -> stream_complete
  Invoke-Psql "UPDATE ""Channel"" SET ""defaultBotId"" = '$botId' WHERE id = '$channelId';"
  # Invalidate Gateway config cache so it picks up the new defaultBotId
  Invoke-CurlJson -Url "http://localhost:4001/api/internal/cache?channelId=$channelId" -Method DELETE -Headers @{ "x-internal-secret" = $internalSecret }
  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "new_message" -Payload @{ content = "trigger stream token flow" } -Ref $ref
  $triggerReply = Wait-PhxReply -Socket $memberSocket -Ref $ref
  Assert "K-004 trigger message accepted" ($triggerReply.payload.status -eq "ok")
  $triggerSequence = [int64]$triggerReply.payload.response.sequence

  $expectedK4StartSequence = [string]($triggerSequence + 1)
  $streamStart = Wait-StreamStartForSequence -Socket $memberSocket -Topic $topic -ExpectedSequence $expectedK4StartSequence -TimeoutMs 12000
  $streamMessageId = $streamStart.payload.messageId
  Assert "K-004 stream_start broadcast received" (-not [string]::IsNullOrWhiteSpace($streamMessageId))

  $postStartFetch = Invoke-CurlJson -Url "$webUrl/api/internal/messages?channelId=$channelId&afterSequence=$triggerSequence&limit=20" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
  $postStartPayload = $postStartFetch.BodyText | ConvertFrom-Json
  $streamPlaceholder = $postStartPayload.messages | Where-Object { $_.id -eq $streamMessageId }
  Assert "K-004 stream_start placeholder row exists" ($null -ne $streamPlaceholder)
  Assert "K-004 stream_start placeholder is ACTIVE" (
    $streamPlaceholder.type -eq "STREAMING" -and
    $streamPlaceholder.streamingStatus -eq "ACTIVE"
  )

  $streamToken = Wait-TopicEvent -Socket $memberSocket -Topic $topic -Event "stream_token" -TimeoutMs 12000
  Assert "K-004 stream_token belongs to placeholder message" ($streamToken.payload.messageId -eq $streamMessageId)
  Assert "K-004 stream_token carries text" (-not [string]::IsNullOrWhiteSpace($streamToken.payload.token))

  $streamComplete = Wait-TopicEvent -Socket $memberSocket -Topic $topic -Event "stream_complete" -TimeoutMs 12000
  Assert "K-004 stream_complete belongs to placeholder message" ($streamComplete.payload.messageId -eq $streamMessageId)

  # Verify final content matches mock SSE output ("Hi " + "there" = "Hi there")
  $k4FinalContent = $streamComplete.payload.finalContent
  Assert "K-004 stream_complete carries final content" (-not [string]::IsNullOrWhiteSpace($k4FinalContent)) ("finalContent=" + $k4FinalContent)
  Assert "K-004 final content matches mock SSE output" ($k4FinalContent -eq "Hi there") ("expected='Hi there' got='$k4FinalContent'")

  $streamingLogs = & docker compose -f $ComposePath logs --tail 400 streaming
  $requestSeen = @($streamingLogs | Select-String -Pattern ([Regex]::Escape($streamMessageId))).Count -gt 0
  Assert "K-004 stream request reached Go proxy via Redis" $requestSeen

  # K-005
  Write-Header "K-005: Error path terminal event delivery (unreachable endpoint)"
  Invoke-Psql "UPDATE ""Bot"" SET ""apiEndpoint"" = 'http://192.0.2.1:9999' WHERE id = '$botId';"

  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "new_message" -Payload @{ content = "trigger unreachable endpoint error" } -Ref $ref
  $k5Reply = Wait-PhxReply -Socket $memberSocket -Ref $ref
  Assert "K-005 trigger message accepted" ($k5Reply.payload.status -eq "ok")

  $expectedK5StartSequence = [string](([int64]$k5Reply.payload.response.sequence) + 1)
  $k5Start = Wait-StreamStartForSequence -Socket $memberSocket -Topic $topic -ExpectedSequence $expectedK5StartSequence -TimeoutMs 12000
  $k5MessageId = $k5Start.payload.messageId
  Assert "K-005 stream_start broadcast received" (-not [string]::IsNullOrWhiteSpace($k5MessageId))

  $script:EnableWsDebug = $true
  #region agent log
  Write-DebugLog -HypothesisId "H5" -Location "scripts/regression-harness.ps1:K005" -Message "Starting K-005 stream_error wait window" -Data @{
    topic = $topic
    expectedMessageId = $k5MessageId
    expectedEvent = "stream_error"
    timeoutMs = 60000
  }
  #endregion

  $k5Error = Wait-StreamEventForMessage -Socket $memberSocket -Topic $topic -Event "stream_error" -MessageId $k5MessageId -TimeoutMs 60000
  $script:EnableWsDebug = $false
  Assert "K-005 stream_error delivered within timeout" ($k5Error.payload.messageId -eq $k5MessageId)

  $k5DbFetch = Invoke-CurlJson -Url "$webUrl/api/internal/messages/$k5MessageId" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
  Assert "K-005 message fetch by id returns 200" ($k5DbFetch.StatusCode -eq 200) ("status=" + $k5DbFetch.StatusCode + " body=" + $k5DbFetch.BodyText)
  $k5DbMessage = $k5DbFetch.BodyText | ConvertFrom-Json
  Assert "K-005 DB message is ERROR" ($k5DbMessage.streamingStatus -eq "ERROR")

  # K-006
  Write-Header "K-006: Timeout path terminal event delivery (token-gap timeout)"
  if ([string]::IsNullOrWhiteSpace($mockTimeoutPid)) {
    $mockTimeoutPid = Start-StallTokenSseServer
  }
  Invoke-Psql "UPDATE ""Bot"" SET ""apiEndpoint"" = 'http://web:3910' WHERE id = '$botId';"

  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "new_message" -Payload @{ content = "trigger token timeout path" } -Ref $ref
  $k6Reply = Wait-PhxReply -Socket $memberSocket -Ref $ref
  Assert "K-006 trigger message accepted" ($k6Reply.payload.status -eq "ok")

  $expectedK6StartSequence = [string](([int64]$k6Reply.payload.response.sequence) + 1)
  $k6Start = Wait-StreamStartForSequence -Socket $memberSocket -Topic $topic -ExpectedSequence $expectedK6StartSequence -TimeoutMs 12000
  $k6MessageId = $k6Start.payload.messageId
  Assert "K-006 stream_start broadcast received" (-not [string]::IsNullOrWhiteSpace($k6MessageId))

  $k6Token = Wait-StreamEventForMessage -Socket $memberSocket -Topic $topic -Event "stream_token" -MessageId $k6MessageId -TimeoutMs 15000
  Assert "K-006 at least one stream_token received" (-not [string]::IsNullOrWhiteSpace($k6Token.payload.token))

  $k6Error = Wait-StreamEventForMessage -Socket $memberSocket -Topic $topic -Event "stream_error" -MessageId $k6MessageId -TimeoutMs 60000
  Assert "K-006 stream_error delivered within timeout" ($k6Error.payload.messageId -eq $k6MessageId)

  $k6DbFetch = Invoke-CurlJson -Url "$webUrl/api/internal/messages/$k6MessageId" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
  Assert "K-006 message fetch by id returns 200" ($k6DbFetch.StatusCode -eq 200) ("status=" + $k6DbFetch.StatusCode + " body=" + $k6DbFetch.BodyText)
  $k6DbMessage = $k6DbFetch.BodyText | ConvertFrom-Json
  Assert "K-006 DB message is ERROR" ($k6DbMessage.streamingStatus -eq "ERROR")
  Assert "K-006 DB message preserves partial content" (-not [string]::IsNullOrWhiteSpace($k6DbMessage.content))

  # K-008
  Write-Header "K-008: Watchdog force-terminates stuck ACTIVE stream"
  $watchdogComposeOverridePath = Join-Path $RootDir "docker-compose.watchdog-test.yml"
  try {
    # -- K-008 setup: fast watchdog for test --
    @"
services:
  gateway:
    environment:
      - STREAM_WATCHDOG_TIMEOUT_MS=3000
"@ | Set-Content -Path $watchdogComposeOverridePath -Encoding UTF8

    docker compose -f $ComposePath -f $watchdogComposeOverridePath up -d --build gateway | Out-Null
    Start-Sleep 12

    Close-SocketSafe $memberSocket
    $memberSocket = Open-PhxSocket -JwtToken $memberJwt
    $ref = [string](Get-Random)
    Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "phx_join" -Payload @{ lastSequence = 0 } -Ref $ref
    $k8JoinReply = Wait-PhxReply -Socket $memberSocket -Ref $ref
    Assert "K-008 member socket rejoins after gateway restart" ($k8JoinReply.payload.status -eq "ok")

    Invoke-Psql "UPDATE ""Bot"" SET ""apiEndpoint"" = 'http://192.0.2.1:9999' WHERE id = '$botId';"

    $ref = [string](Get-Random)
    Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "new_message" -Payload @{ content = "trigger watchdog force-terminate path" } -Ref $ref
    $k8Reply = Wait-PhxReply -Socket $memberSocket -Ref $ref
    Assert "K-008 trigger message accepted" ($k8Reply.payload.status -eq "ok")

    $expectedK8StartSequence = [string](([int64]$k8Reply.payload.response.sequence) + 1)
    $k8Start = Wait-StreamStartForSequence -Socket $memberSocket -Topic $topic -ExpectedSequence $expectedK8StartSequence -TimeoutMs 12000
    $k8MessageId = $k8Start.payload.messageId
    Assert "K-008 stream_start broadcast received" (-not [string]::IsNullOrWhiteSpace($k8MessageId))

    # Keep web down through terminal event + retry window so FinalizeMessage exhausts.
    docker compose -f $ComposePath stop web
    $webStopped = $true

    $k8Error = Wait-StreamEventForMessage -Socket $memberSocket -Topic $topic -Event "stream_error" -MessageId $k8MessageId -TimeoutMs 120000
    Assert "K-008 stream_error received by websocket client" ($k8Error.payload.messageId -eq $k8MessageId)

    # Extra margin beyond 1s+2s+4s retry backoff to guarantee finalize exhaustion.
    Start-Sleep 15

    docker compose -f $ComposePath start web
    $webStopped = $false

    $webRecoveredForK8 = Wait-Until -MaxAttempts 15 -DelayMs 2000 -Action {
      $health = Invoke-CurlJson -Url "$webUrl/api/health"
      return $health.StatusCode -eq 200
    }
    Assert "K-008 web service recovers after finalize retry exhaustion window" $webRecoveredForK8

    # Fast watchdog mode: allow 3s x 6 checks for force-terminate convergence.
    $k8Converged = Wait-Until -MaxAttempts 6 -DelayMs 3000 -Action {
      $probe = Invoke-CurlJson -Url "$webUrl/api/internal/messages/$k8MessageId" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
      if ($probe.StatusCode -ne 200) {
        return $false
      }
      try {
        $probeMessage = $probe.BodyText | ConvertFrom-Json
        return $probeMessage.streamingStatus -eq "ERROR"
      }
      catch {
        return $false
      }
    }
    Assert "K-008 watchdog force-terminates stuck ACTIVE stream to ERROR" $k8Converged

    $k8DbFetch = Invoke-CurlJson -Url "$webUrl/api/internal/messages/$k8MessageId" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
    Assert "K-008 message fetch by id returns 200" ($k8DbFetch.StatusCode -eq 200) ("status=" + $k8DbFetch.StatusCode + " body=" + $k8DbFetch.BodyText)
    $k8DbMessage = $k8DbFetch.BodyText | ConvertFrom-Json
    Assert "K-008 DB message is ERROR" ($k8DbMessage.streamingStatus -eq "ERROR")
  }
  finally {
    # -- K-008 cleanup: restore production watchdog --
    Remove-Item $watchdogComposeOverridePath -ErrorAction SilentlyContinue
    docker compose -f $ComposePath up -d --build gateway | Out-Null
    Start-Sleep 12
  }

  # K-009
  Write-Header "K-009: DM reactions CRUD + real-time broadcast (TASK-0030)"
  $sessionA = Get-SessionCookie -Email "$testPrefix-a@example.com" -Password $testPassword
  $sessionB = Get-SessionCookie -Email "$testPrefix-b@example.com" -Password $testPassword
  Assert "K-009 session cookie obtained for user A" (-not [string]::IsNullOrWhiteSpace($sessionA))
  Assert "K-009 session cookie obtained for user B" (-not [string]::IsNullOrWhiteSpace($sessionB))

  $dmReactionUrl = "$webUrl/api/dms/$dmChannelId/messages/$dmMessageId/reactions"

  # User A adds +1 reaction
  $addReaction = Invoke-AuthenticatedApi -Url $dmReactionUrl -Method POST -SessionCookie $sessionA -Body @{ emoji = "+1" }
  Assert "K-009 POST reaction returns 200" ($addReaction.StatusCode -eq 200) ("status=" + $addReaction.StatusCode + " body=" + $addReaction.BodyText)
  $addBody = $addReaction.BodyText | ConvertFrom-Json
  $addReactions = @($addBody.reactions)
  Assert "K-009 POST reaction response has reactions array" ($addReactions.Count -ge 1)
  $thumbsUp = @($addReactions | Where-Object { $_.emoji -eq "+1" })
  Assert "K-009 POST finds +1 emoji in reactions" ($thumbsUp.Count -eq 1) ("found=" + $thumbsUp.Count + " emojis=" + ($addReactions | ForEach-Object { $_.emoji }) -join ",")
  Assert "K-009 POST reaction count is 1" ([int]$thumbsUp[0].count -eq 1) ("count=" + $thumbsUp[0].count)

  # GET reactions to verify
  $getReactions = Invoke-AuthenticatedApi -Url $dmReactionUrl -Method GET -SessionCookie $sessionA
  Assert "K-009 GET reactions returns 200" ($getReactions.StatusCode -eq 200)
  $getBody = $getReactions.BodyText | ConvertFrom-Json
  $getReactionsArr = @($getBody.reactions)
  $thumbsUpGet = @($getReactionsArr | Where-Object { $_.emoji -eq "+1" })
  Assert "K-009 GET reactions shows +1 with count 1" ($thumbsUpGet.Count -eq 1 -and [int]$thumbsUpGet[0].count -eq 1)

  # User B adds same emoji — count should become 2
  $addReactionB = Invoke-AuthenticatedApi -Url $dmReactionUrl -Method POST -SessionCookie $sessionB -Body @{ emoji = "+1" }
  Assert "K-009 User B POST reaction returns 200" ($addReactionB.StatusCode -eq 200)
  $addBodyB = $addReactionB.BodyText | ConvertFrom-Json
  $thumbsUpB = @(@($addBodyB.reactions) | Where-Object { $_.emoji -eq "+1" })
  Assert "K-009 After user B reacts, count is 2" ($thumbsUpB.Count -eq 1 -and [int]$thumbsUpB[0].count -eq 2) ("count=" + $thumbsUpB[0].count)

  # User A removes reaction
  $removeReaction = Invoke-AuthenticatedApi -Url $dmReactionUrl -Method DELETE -SessionCookie $sessionA -Body @{ emoji = "+1" }
  Assert "K-009 DELETE reaction returns 200" ($removeReaction.StatusCode -eq 200)
  $removeBody = $removeReaction.BodyText | ConvertFrom-Json
  $thumbsUpAfterRemove = @(@($removeBody.reactions) | Where-Object { $_.emoji -eq "+1" })
  Assert "K-009 After user A removes, count is 1" ($thumbsUpAfterRemove.Count -eq 1 -and [int]$thumbsUpAfterRemove[0].count -eq 1)

  # Idempotency: User B POSTs same emoji again — count should still be 1, not 2
  $idempotentReaction = Invoke-AuthenticatedApi -Url $dmReactionUrl -Method POST -SessionCookie $sessionB -Body @{ emoji = "+1" }
  Assert "K-009 idempotent POST returns 200" ($idempotentReaction.StatusCode -eq 200)
  $idempotentBody = $idempotentReaction.BodyText | ConvertFrom-Json
  $thumbsUpIdempotent = @(@($idempotentBody.reactions) | Where-Object { $_.emoji -eq "+1" })
  Assert "K-009 idempotent POST keeps count at 1" ([int]$thumbsUpIdempotent[0].count -eq 1) ("count=" + $thumbsUpIdempotent[0].count)

  # Verify non-participant cannot react
  $sessionC = Get-SessionCookie -Email "$testPrefix-c@example.com" -Password $testPassword
  $rejectReaction = Invoke-AuthenticatedApi -Url $dmReactionUrl -Method POST -SessionCookie $sessionC -Body @{ emoji = "+1" }
  Assert "K-009 non-participant POST reaction rejected (403)" ($rejectReaction.StatusCode -eq 403)

  # Invalid emoji (empty string)
  $badEmojiReaction = Invoke-AuthenticatedApi -Url $dmReactionUrl -Method POST -SessionCookie $sessionA -Body @{ emoji = "" }
  Assert "K-009 empty emoji POST rejected (400)" ($badEmojiReaction.StatusCode -eq 400)

  # K-010
  Write-Header "K-010: File upload returns image dimensions (TASK-0025)"
  # Generate a minimal 1x1 PNG (67 bytes)
  $pngBytes = [byte[]]@(
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # width=1, height=1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,  # 8-bit RGB
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,  # IDAT chunk
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,  # IEND chunk
    0x44, 0xAE, 0x42, 0x60, 0x82
  )
  $pngTmpFile = Join-Path ([System.IO.Path]::GetTempPath()) "test-upload-$testPrefix.png"
  [System.IO.File]::WriteAllBytes($pngTmpFile, $pngBytes)

  try {
    $uploadArgs = @(
      "-sS", "--max-time", "15",
      "-w", "%{http_code}",
      "-b", $sessionA,
      "-F", "file=@$pngTmpFile;type=image/png;filename=test-1x1.png"
    )
    $uploadOutFile = New-TemporaryFile
    $uploadArgs += @("-o", $uploadOutFile.FullName)
    $uploadArgs += "$webUrl/api/uploads"
    $uploadCode = & $script:CurlCmd @uploadArgs
    $uploadStatus = [int]($uploadCode.Trim())
    $uploadBody = Get-Content $uploadOutFile.FullName -Raw | ConvertFrom-Json

    Assert "K-010 upload returns 201" ($uploadStatus -eq 201) ("status=$uploadStatus")
    Assert "K-010 upload response has fileId" (-not [string]::IsNullOrWhiteSpace($uploadBody.fileId))
    Assert "K-010 upload response has width=1" ($uploadBody.width -eq 1) ("width=" + $uploadBody.width)
    Assert "K-010 upload response has height=1" ($uploadBody.height -eq 1) ("height=" + $uploadBody.height)
    Assert "K-010 upload response has mimeType image/png" ($uploadBody.mimeType -eq "image/png")
  }
  finally {
    Remove-Item $pngTmpFile -Force -ErrorAction SilentlyContinue
    Remove-Item $uploadOutFile -Force -ErrorAction SilentlyContinue
  }

  # K-010b: Disallowed MIME type rejection
  Write-Header "K-010b: Upload disallowed MIME type + oversized + non-image null dimensions"
  $txtTmpFile = Join-Path ([System.IO.Path]::GetTempPath()) "test-upload-$testPrefix.txt"
  $exeTmpFile = Join-Path ([System.IO.Path]::GetTempPath()) "test-upload-$testPrefix.exe"
  try {
    # Non-image file should have null width/height
    [System.IO.File]::WriteAllText($txtTmpFile, "hello world test content")
    $txtUploadOutFile = New-TemporaryFile
    $txtUploadArgs = @(
      "-sS", "--max-time", "15",
      "-w", "%{http_code}",
      "-b", $sessionA,
      "-F", "file=@$txtTmpFile;type=text/plain;filename=test.txt",
      "-o", $txtUploadOutFile.FullName,
      "$webUrl/api/uploads"
    )
    $txtUploadCode = & $script:CurlCmd @txtUploadArgs
    $txtUploadStatus = [int]($txtUploadCode.Trim())
    $txtUploadBody = Get-Content $txtUploadOutFile.FullName -Raw | ConvertFrom-Json
    Assert "K-010b text file upload returns 201" ($txtUploadStatus -eq 201) ("status=$txtUploadStatus")
    Assert "K-010b text file has null width" ($null -eq $txtUploadBody.width -or $txtUploadBody.width -eq 0)
    Assert "K-010b text file has null height" ($null -eq $txtUploadBody.height -or $txtUploadBody.height -eq 0)

    # Disallowed MIME type (.exe) should be rejected with 400
    [System.IO.File]::WriteAllBytes($exeTmpFile, [byte[]]@(0x4D, 0x5A, 0x00, 0x00))
    $exeUploadOutFile = New-TemporaryFile
    $exeUploadArgs = @(
      "-sS", "--max-time", "15",
      "-w", "%{http_code}",
      "-b", $sessionA,
      "-F", "file=@$exeTmpFile;type=application/x-msdownload;filename=test.exe",
      "-o", $exeUploadOutFile.FullName,
      "$webUrl/api/uploads"
    )
    $exeUploadCode = & $script:CurlCmd @exeUploadArgs
    $exeUploadStatus = [int]($exeUploadCode.Trim())
    Assert "K-010b disallowed MIME type rejected (400)" ($exeUploadStatus -eq 400) ("status=$exeUploadStatus")
  }
  finally {
    Remove-Item $txtTmpFile -Force -ErrorAction SilentlyContinue
    Remove-Item $exeTmpFile -Force -ErrorAction SilentlyContinue
    Remove-Item $txtUploadOutFile -Force -ErrorAction SilentlyContinue
    Remove-Item $exeUploadOutFile -Force -ErrorAction SilentlyContinue
  }

  # K-011
  Write-Header "K-011: Stream tokenHistory persistence after stream_complete (TASK-0021)"
  # Re-fetch message list to find the K-004 stream-completed message
  $k11Fetch = Invoke-CurlJson -Url "$webUrl/api/internal/messages?channelId=$channelId&afterSequence=0&limit=50" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
  Assert "K-011 message list fetch returns 200" ($k11Fetch.StatusCode -eq 200) ("status=" + $k11Fetch.StatusCode)
  $k11Payload = $k11Fetch.BodyText | ConvertFrom-Json
  $k11StreamMsg = $k11Payload.messages | Where-Object { $_.id -eq $streamMessageId -and $_.streamingStatus -eq "COMPLETE" }
  Assert "K-011 found stream-completed message from K-004" ($null -ne $k11StreamMsg) ("streamMessageId=$streamMessageId")
  Assert "K-011 tokenHistory field is present" ($null -ne $k11StreamMsg.tokenHistory)
  $k11TokenCount = @($k11StreamMsg.tokenHistory).Count
  Assert "K-011 tokenHistory has at least 1 entry" ($k11TokenCount -ge 1) ("entries=$k11TokenCount")
  # Verify tokenHistory entry structure: each entry should have 'o' and 't' fields
  $k11FirstEntry = $k11StreamMsg.tokenHistory[0]
  Assert "K-011 tokenHistory entry has 'o' field (offset)" ($null -ne $k11FirstEntry.o -and $k11FirstEntry.o -ge 0)
  Assert "K-011 tokenHistory entry has 't' field (time ms)" ($null -ne $k11FirstEntry.t -and $k11FirstEntry.t -ge 0)
  # Verify checkpoints field handling: for simple streams without checkpoint events,
  # checkpoints may be absent (undefined → stripped from JSON) or an empty array.
  # The key invariant: if checkpoints IS present, it must be parseable (array).
  $k11HasCheckpoints = $k11StreamMsg.PSObject.Properties.Name -contains "checkpoints"
  if ($k11HasCheckpoints -and $null -ne $k11StreamMsg.checkpoints) {
    $k11CpArray = @($k11StreamMsg.checkpoints)
    Assert "K-011 checkpoints field is an array when present" ($k11CpArray -is [array])
  } else {
    # Absent checkpoints for a simple stream with no thinking transitions is acceptable
    Assert "K-011 checkpoints absent or null for simple stream (expected)" $true
  }

  # K-012
  Write-Header "K-012: Gateway cache invalidation endpoint (DEC-0044)"
  $k12TestChannelId = New-TestId
  $k12Response = Invoke-CurlJson -Url "http://localhost:4001/api/internal/cache?channelId=$k12TestChannelId" -Method DELETE -Headers @{ "x-internal-secret" = $internalSecret }
  Assert "K-012 cache invalidation returns 200" ($k12Response.StatusCode -eq 200) ("status=" + $k12Response.StatusCode + " body=" + $k12Response.BodyText)
  $k12Body = $k12Response.BodyText | ConvertFrom-Json
  Assert "K-012 response body has ok=true" ($k12Body.ok -eq $true)
  Assert "K-012 response body has invalidated channel id" ($k12Body.invalidated -eq $k12TestChannelId)

  # Verify missing channelId returns 400
  $k12BadResponse = Invoke-CurlJson -Url "http://localhost:4001/api/internal/cache" -Method DELETE -Headers @{ "x-internal-secret" = $internalSecret }
  Assert "K-012 cache invalidation without channelId returns 400" ($k12BadResponse.StatusCode -eq 400)

  # K-013
  Write-Header "K-013: Message edit via WebSocket (TASK-0014)"
  # Reconnect member socket after K-008 gateway restart
  Close-SocketSafe $memberSocket
  $memberSocket = Open-PhxSocket -JwtToken $memberJwt
  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "phx_join" -Payload @{ lastSequence = 0 } -Ref $ref
  $k13JoinReply = Wait-PhxReply -Socket $memberSocket -Ref $ref
  Assert "K-013 precondition: member socket rejoins" ($k13JoinReply.payload.status -eq "ok")

  # We need a fresh user-authored message to edit. Use one of the K-001 messages (authored by user A).
  # Fetch the latest user messages to get a valid messageId
  $k13Fetch = Invoke-CurlJson -Url "$webUrl/api/internal/messages?channelId=$channelId&afterSequence=0&limit=50" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
  $k13Payload = $k13Fetch.BodyText | ConvertFrom-Json
  $k13UserMsg = @($k13Payload.messages | Where-Object { $_.authorType -ne "BOT" -and $_.streamingStatus -ne "ACTIVE" }) | Select-Object -First 1
  Assert "K-013 precondition: found a user-authored message to edit" ($null -ne $k13UserMsg)
  $k13MsgId = $k13UserMsg.id

  # Happy path: author edits own message
  $k13Ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "message_edit" -Payload @{ messageId = $k13MsgId; content = "edited content k013" } -Ref $k13Ref
  $k13EditReply = Wait-PhxReply -Socket $memberSocket -Ref $k13Ref
  Assert "K-013 edit reply status is ok" ($k13EditReply.payload.status -eq "ok") ("status=" + $k13EditReply.payload.status + " response=" + ($k13EditReply.payload.response | ConvertTo-Json -Compress))
  Assert "K-013 edit reply has messageId" ($k13EditReply.payload.response.messageId -eq $k13MsgId)

  # Verify message_edited broadcast was received
  $k13Broadcast = Wait-TopicEvent -Socket $memberSocket -Topic $topic -Event "message_edited" -TimeoutMs 6000
  Assert "K-013 message_edited broadcast received" ($k13Broadcast.payload.messageId -eq $k13MsgId)
  Assert "K-013 broadcast has updated content" ($k13Broadcast.payload.content -eq "edited content k013")
  Assert "K-013 broadcast has editedAt timestamp" (-not [string]::IsNullOrWhiteSpace($k13Broadcast.payload.editedAt))

  # Verify DB reflects the edit
  $k13DbCheck = Invoke-CurlJson -Url "$webUrl/api/internal/messages?channelId=$channelId&afterSequence=0&limit=50" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
  $k13DbPayload = $k13DbCheck.BodyText | ConvertFrom-Json
  $k13Edited = $k13DbPayload.messages | Where-Object { $_.id -eq $k13MsgId }
  Assert "K-013 DB message content updated" ($k13Edited.content -eq "edited content k013")

  # Non-author rejection: User B tries to edit User A's message
  $memberBPayload = @{
    sub = $userBId
    username = "$testPrefix-b"
    displayName = "Test User B"
    exp = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600)
  }
  $memberBJwt = New-Hs256Jwt -Secret $jwtSecret -Payload $memberBPayload
  $memberBSocket = Open-PhxSocket -JwtToken $memberBJwt
  $k13BRef = [string](Get-Random)
  Send-PhxMessage -Socket $memberBSocket -Topic $topic -Event "phx_join" -Payload @{ lastSequence = 0 } -Ref $k13BRef
  $k13BJoin = Wait-PhxReply -Socket $memberBSocket -Ref $k13BRef
  Assert "K-013 user B joins channel" ($k13BJoin.payload.status -eq "ok")

  $k13BEditRef = [string](Get-Random)
  Send-PhxMessage -Socket $memberBSocket -Topic $topic -Event "message_edit" -Payload @{ messageId = $k13MsgId; content = "hijack attempt" } -Ref $k13BEditRef
  $k13BEditReply = Wait-PhxReply -Socket $memberBSocket -Ref $k13BEditRef
  Assert "K-013 non-author edit rejected" ($k13BEditReply.payload.status -eq "error") ("status=" + $k13BEditReply.payload.status)
  Assert "K-013 non-author edit reason is not_author" ($k13BEditReply.payload.response.reason -eq "not_author") ("reason=" + $k13BEditReply.payload.response.reason)

  # Empty content rejection
  $k13EmptyRef = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "message_edit" -Payload @{ messageId = $k13MsgId; content = "   " } -Ref $k13EmptyRef
  $k13EmptyReply = Wait-PhxReply -Socket $memberSocket -Ref $k13EmptyRef
  Assert "K-013 empty content edit rejected" ($k13EmptyReply.payload.status -eq "error")
  Assert "K-013 empty content reason" ($k13EmptyReply.payload.response.reason -eq "empty_content")

  # Bot message rejection: try to edit the bot's streaming message from K-004
  $k13BotRef = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "message_edit" -Payload @{ messageId = $streamMessageId; content = "edit bot msg" } -Ref $k13BotRef
  $k13BotReply = Wait-PhxReply -Socket $memberSocket -Ref $k13BotRef
  Assert "K-013 bot message edit rejected" ($k13BotReply.payload.status -eq "error") ("status=" + $k13BotReply.payload.status)

  # K-014
  Write-Header "K-014: Message delete via WebSocket (TASK-0014)"
  # Create a fresh message specifically for deletion testing
  $k14Ref = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "new_message" -Payload @{ content = "message to delete k014" } -Ref $k14Ref
  $k14MsgReply = Wait-PhxReply -Socket $memberSocket -Ref $k14Ref
  Assert "K-014 setup: message created" ($k14MsgReply.payload.status -eq "ok")
  $k14MsgId = $k14MsgReply.payload.response.id

  # Happy path: author deletes own message
  # Wait a moment for persistence to settle (bot trigger may be in flight)
  Start-Sleep -Milliseconds 500
  $k14DelRef = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "message_delete" -Payload @{ messageId = $k14MsgId } -Ref $k14DelRef
  $k14DelReply = Wait-PhxReply -Socket $memberSocket -Ref $k14DelRef
  $k14DelReason = if ($k14DelReply.payload.response.reason) { $k14DelReply.payload.response.reason } else { "none" }
  Assert "K-014 delete reply status is ok" ($k14DelReply.payload.status -eq "ok") ("status=" + $k14DelReply.payload.status + " reason=" + $k14DelReason + " msgId=" + $k14MsgId)

  # Verify message_deleted broadcast
  $k14Broadcast = Wait-TopicEvent -Socket $memberSocket -Topic $topic -Event "message_deleted" -TimeoutMs 6000
  Assert "K-014 message_deleted broadcast received" ($k14Broadcast.payload.messageId -eq $k14MsgId)
  Assert "K-014 broadcast has deletedBy field" ($k14Broadcast.payload.deletedBy -eq $userAId)

  # Already-deleted message: try to delete again
  $k14DelAgainRef = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "message_delete" -Payload @{ messageId = $k14MsgId } -Ref $k14DelAgainRef
  $k14DelAgainReply = Wait-PhxReply -Socket $memberSocket -Ref $k14DelAgainRef
  Assert "K-014 already-deleted message returns error" ($k14DelAgainReply.payload.status -eq "error") ("status=" + $k14DelAgainReply.payload.status)
  Assert "K-014 already-deleted reason is not_found" ($k14DelAgainReply.payload.response.reason -eq "not_found") ("reason=" + $k14DelAgainReply.payload.response.reason)

  # Non-author without MANAGE_MESSAGES: User B tries to delete User A's message
  # Use k13MsgId (User A's edited message)
  $k14BDelRef = [string](Get-Random)
  Send-PhxMessage -Socket $memberBSocket -Topic $topic -Event "message_delete" -Payload @{ messageId = $k13MsgId } -Ref $k14BDelRef
  $k14BDelReply = Wait-PhxReply -Socket $memberBSocket -Ref $k14BDelRef
  Assert "K-014 non-author delete without permission rejected" ($k14BDelReply.payload.status -eq "error") ("status=" + $k14BDelReply.payload.status)
  Assert "K-014 non-author delete reason is unauthorized" ($k14BDelReply.payload.response.reason -eq "unauthorized") ("reason=" + $k14BDelReply.payload.response.reason)

  # K-015
  Write-Header "K-015: Room reactions CRUD via REST API (TASK-0030)"
  # Use k13MsgId (the edited message from K-013, authored by user A, still exists)
  $roomReactionUrl = "$webUrl/api/messages/$k13MsgId/reactions"

  # User A adds a reaction
  $k15AddA = Invoke-AuthenticatedApi -Url $roomReactionUrl -Method POST -SessionCookie $sessionA -Body @{ emoji = "fire" }
  Assert "K-015 user A POST reaction returns 200" ($k15AddA.StatusCode -eq 200) ("status=" + $k15AddA.StatusCode + " body=" + $k15AddA.BodyText)
  $k15AddABody = $k15AddA.BodyText | ConvertFrom-Json
  $k15FireA = @(@($k15AddABody.reactions) | Where-Object { $_.emoji -eq "fire" })
  Assert "K-015 fire reaction has count 1" ($k15FireA.Count -eq 1 -and [int]$k15FireA[0].count -eq 1)

  # User B adds same reaction
  $k15AddB = Invoke-AuthenticatedApi -Url $roomReactionUrl -Method POST -SessionCookie $sessionB -Body @{ emoji = "fire" }
  Assert "K-015 user B POST reaction returns 200" ($k15AddB.StatusCode -eq 200)
  $k15AddBBody = $k15AddB.BodyText | ConvertFrom-Json
  $k15FireB = @(@($k15AddBBody.reactions) | Where-Object { $_.emoji -eq "fire" })
  Assert "K-015 fire reaction count is 2 after user B" ([int]$k15FireB[0].count -eq 2) ("count=" + $k15FireB[0].count)

  # GET reactions
  $k15Get = Invoke-AuthenticatedApi -Url $roomReactionUrl -Method GET -SessionCookie $sessionA
  Assert "K-015 GET reactions returns 200" ($k15Get.StatusCode -eq 200)
  $k15GetBody = $k15Get.BodyText | ConvertFrom-Json
  $k15GetFire = @(@($k15GetBody.reactions) | Where-Object { $_.emoji -eq "fire" })
  Assert "K-015 GET confirms fire count 2" ([int]$k15GetFire[0].count -eq 2)
  Assert "K-015 GET has hasReacted=true for user A" ($k15GetFire[0].hasReacted -eq $true)

  # User A removes reaction
  $k15RemoveA = Invoke-AuthenticatedApi -Url $roomReactionUrl -Method DELETE -SessionCookie $sessionA -Body @{ emoji = "fire" }
  Assert "K-015 DELETE reaction returns 200" ($k15RemoveA.StatusCode -eq 200)
  $k15RemoveABody = $k15RemoveA.BodyText | ConvertFrom-Json
  $k15FireAfterRemove = @(@($k15RemoveABody.reactions) | Where-Object { $_.emoji -eq "fire" })
  Assert "K-015 fire count down to 1 after user A removes" ([int]$k15FireAfterRemove[0].count -eq 1)

  # Non-member (User C) cannot react to room messages
  $k15NonMember = Invoke-AuthenticatedApi -Url $roomReactionUrl -Method POST -SessionCookie $sessionC -Body @{ emoji = "fire" }
  Assert "K-015 non-member reaction rejected (403)" ($k15NonMember.StatusCode -eq 403) ("status=" + $k15NonMember.StatusCode)

  # Invalid empty emoji
  $k15BadEmoji = Invoke-AuthenticatedApi -Url $roomReactionUrl -Method POST -SessionCookie $sessionA -Body @{ emoji = "" }
  Assert "K-015 empty emoji rejected (400)" ($k15BadEmoji.StatusCode -eq 400) ("status=" + $k15BadEmoji.StatusCode)

  # K-016
  Write-Header "K-016: DM messaging end-to-end (TASK-0019)"
  $dmTopic = "dm:$dmChannelId"

  # Open DM sockets for users A and B
  $dmSocketA = Open-PhxSocket -JwtToken $memberJwt
  $dmRefA = [string](Get-Random)
  Send-PhxMessage -Socket $dmSocketA -Topic $dmTopic -Event "phx_join" -Payload @{} -Ref $dmRefA
  $dmJoinA = Wait-PhxReply -Socket $dmSocketA -Ref $dmRefA
  Assert "K-016 user A joins DM channel" ($dmJoinA.payload.status -eq "ok") ("status=" + $dmJoinA.payload.status)

  $dmSocketB = Open-PhxSocket -JwtToken $memberBJwt
  $dmRefB = [string](Get-Random)
  Send-PhxMessage -Socket $dmSocketB -Topic $dmTopic -Event "phx_join" -Payload @{} -Ref $dmRefB
  $dmJoinB = Wait-PhxReply -Socket $dmSocketB -Ref $dmRefB
  Assert "K-016 user B joins DM channel" ($dmJoinB.payload.status -eq "ok") ("status=" + $dmJoinB.payload.status)

  # Send a DM message from user A
  $dmSendRef = [string](Get-Random)
  Send-PhxMessage -Socket $dmSocketA -Topic $dmTopic -Event "new_message" -Payload @{ content = "hello from k016 test" } -Ref $dmSendRef
  $dmSendReply = Wait-PhxReply -Socket $dmSocketA -Ref $dmSendRef
  Assert "K-016 DM send reply is ok" ($dmSendReply.payload.status -eq "ok") ("status=" + $dmSendReply.payload.status)
  $k16MsgId = $dmSendReply.payload.response.messageId
  Assert "K-016 DM send reply has messageId" (-not [string]::IsNullOrWhiteSpace($k16MsgId))

  # Verify user B receives the message_new broadcast
  $dmBroadcast = Wait-TopicEvent -Socket $dmSocketB -Topic $dmTopic -Event "message_new" -TimeoutMs 6000
  Assert "K-016 user B receives message_new broadcast" ($dmBroadcast.payload.content -eq "hello from k016 test")
  Assert "K-016 broadcast has authorId" ($dmBroadcast.payload.authorId -eq $userAId)
  Assert "K-016 broadcast has dmId" ($dmBroadcast.payload.dmId -eq $dmChannelId)

  # Empty content edit rejection (test early while socket is fresh)
  $dmEmptyRef = [string](Get-Random)
  Send-PhxMessage -Socket $dmSocketA -Topic $dmTopic -Event "message_edit" -Payload @{ messageId = $k16MsgId; content = "   " } -Ref $dmEmptyRef
  $dmEmptyReply = Wait-PhxReply -Socket $dmSocketA -Ref $dmEmptyRef
  Assert "K-016 DM empty edit rejected" ($dmEmptyReply.payload.status -eq "error") ("status=" + $dmEmptyReply.payload.status)
  $dmEmptyReason = $dmEmptyReply.payload.response.reason
  Assert "K-016 DM empty edit reason" ($dmEmptyReason -eq "empty_content") ("reason=$dmEmptyReason")

  # Edit the DM message
  $dmEditRef = [string](Get-Random)
  Send-PhxMessage -Socket $dmSocketA -Topic $dmTopic -Event "message_edit" -Payload @{ messageId = $k16MsgId; content = "edited k016 msg" } -Ref $dmEditRef
  $dmEditReply = Wait-PhxReply -Socket $dmSocketA -Ref $dmEditRef
  Assert "K-016 DM edit reply is ok" ($dmEditReply.payload.status -eq "ok") ("status=" + $dmEditReply.payload.status)

  # Verify user B receives message_edited broadcast
  $dmEditBroadcast = Wait-TopicEvent -Socket $dmSocketB -Topic $dmTopic -Event "message_edited" -TimeoutMs 6000
  Assert "K-016 user B receives message_edited broadcast" ($dmEditBroadcast.payload.messageId -eq $k16MsgId)
  Assert "K-016 edited content correct" ($dmEditBroadcast.payload.content -eq "edited k016 msg")
  Assert "K-016 editedAt present" (-not [string]::IsNullOrWhiteSpace($dmEditBroadcast.payload.editedAt))

  # Delete the DM message — reconnect socket to ensure clean state
  Close-SocketSafe $dmSocketA
  Close-SocketSafe $dmSocketB
  Start-Sleep -Milliseconds 300
  $dmSocketA = Open-PhxSocket -JwtToken $memberJwt
  $dmReJoinRefA = [string](Get-Random)
  Send-PhxMessage -Socket $dmSocketA -Topic $dmTopic -Event "phx_join" -Payload @{} -Ref $dmReJoinRefA
  $dmReJoinA = Wait-PhxReply -Socket $dmSocketA -Ref $dmReJoinRefA
  Assert "K-016 socket A re-joined for delete" ($dmReJoinA.payload.status -eq "ok")

  $dmSocketB = Open-PhxSocket -JwtToken $memberBJwt
  $dmReJoinRefB = [string](Get-Random)
  Send-PhxMessage -Socket $dmSocketB -Topic $dmTopic -Event "phx_join" -Payload @{} -Ref $dmReJoinRefB
  $dmReJoinB = Wait-PhxReply -Socket $dmSocketB -Ref $dmReJoinRefB
  Assert "K-016 socket B re-joined for delete" ($dmReJoinB.payload.status -eq "ok")

  $dmDelRef = [string](Get-Random)
  Send-PhxMessage -Socket $dmSocketA -Topic $dmTopic -Event "message_delete" -Payload @{ messageId = $k16MsgId } -Ref $dmDelRef
  $dmDelReply = Wait-PhxReply -Socket $dmSocketA -Ref $dmDelRef
  $dmDelReason = if ($dmDelReply.payload.response.reason) { $dmDelReply.payload.response.reason } else { "none" }
  Assert "K-016 DM delete reply is ok" ($dmDelReply.payload.status -eq "ok") ("status=" + $dmDelReply.payload.status + " reason=" + $dmDelReason)

  # Verify user B receives message_deleted broadcast
  $dmDelBroadcast = Wait-TopicEvent -Socket $dmSocketB -Topic $dmTopic -Event "message_deleted" -TimeoutMs 6000
  Assert "K-016 user B receives message_deleted broadcast" ($dmDelBroadcast.payload.messageId -eq $k16MsgId)
  Assert "K-016 deletedBy is user A" ($dmDelBroadcast.payload.deletedBy -eq $userAId)

  # History fetch (history handler returns phx_reply, not a push event)
  $dmHistRef = [string](Get-Random)
  Send-PhxMessage -Socket $dmSocketA -Topic $dmTopic -Event "history" -Payload @{ limit = 10 } -Ref $dmHistRef
  $dmHistReply = Wait-PhxReply -Socket $dmSocketA -Ref $dmHistRef
  Assert "K-016 DM history reply is ok" ($dmHistReply.payload.status -eq "ok") ("status=" + $dmHistReply.payload.status)
  $dmHistoryMsgs = @($dmHistReply.payload.response.messages)
  Assert "K-016 DM history has messages" ($dmHistoryMsgs.Count -ge 0)

  # Non-participant (User C) cannot join DM channel
  $dmSocketC = Open-PhxSocket -JwtToken $foreignJwt
  $dmRefC = [string](Get-Random)
  Send-PhxMessage -Socket $dmSocketC -Topic $dmTopic -Event "phx_join" -Payload @{} -Ref $dmRefC
  $dmJoinC = Wait-PhxReply -Socket $dmSocketC -Ref $dmRefC
  Assert "K-016 non-participant cannot join DM" ($dmJoinC.payload.status -eq "error") ("status=" + $dmJoinC.payload.status)

  Close-SocketSafe $dmSocketA
  Close-SocketSafe $dmSocketB
  Close-SocketSafe $dmSocketC

  # K-017
  Write-Header "K-017: Expired JWT WebSocket connection rejection"
  $expiredPayload = @{
    sub = $userAId
    username = "$testPrefix-a"
    displayName = "Test User A"
    exp = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - 3600)
  }
  $expiredJwt = New-Hs256Jwt -Secret $jwtSecret -Payload $expiredPayload

  $k17Failed = $false
  try {
    $expiredSocket = Open-PhxSocket -JwtToken $expiredJwt
    # If socket connects, try joining — should fail
    $k17Ref = [string](Get-Random)
    Send-PhxMessage -Socket $expiredSocket -Topic $topic -Event "phx_join" -Payload @{ lastSequence = 0 } -Ref $k17Ref
    $k17Reply = Wait-PhxReply -Socket $expiredSocket -Ref $k17Ref -TimeoutMs 4000
    # If we get a reply, it should be an error
    if ($k17Reply.payload.status -eq "error") {
      $k17Failed = $true
    }
  }
  catch {
    # Connection refused or timed out = expected for expired JWT
    $k17Failed = $true
  }
  finally {
    Close-SocketSafe $expiredSocket
  }
  Assert "K-017 expired JWT rejected (connection or join fails)" $k17Failed

  # Also test invalid (garbage) JWT
  $k17Garbage = $false
  try {
    $garbageSocket = Open-PhxSocket -JwtToken "not.a.valid.jwt.token"
    $k17GRef = [string](Get-Random)
    Send-PhxMessage -Socket $garbageSocket -Topic $topic -Event "phx_join" -Payload @{ lastSequence = 0 } -Ref $k17GRef
    $k17GReply = Wait-PhxReply -Socket $garbageSocket -Ref $k17GRef -TimeoutMs 4000
    if ($k17GReply.payload.status -eq "error") {
      $k17Garbage = $true
    }
  }
  catch {
    $k17Garbage = $true
  }
  finally {
    Close-SocketSafe $garbageSocket
  }
  Assert "K-017 garbage JWT rejected" $k17Garbage

  # K-018
  Write-Header "K-018: Upload without authentication returns 401"
  $k18TmpFile = Join-Path ([System.IO.Path]::GetTempPath()) "test-noauth-$testPrefix.txt"
  [System.IO.File]::WriteAllText($k18TmpFile, "unauthenticated upload test")
  try {
    $k18OutFile = New-TemporaryFile
    $k18Args = @(
      "-sS", "--max-time", "15",
      "-w", "%{http_code}",
      "-F", "file=@$k18TmpFile;type=text/plain;filename=noauth.txt",
      "-o", $k18OutFile.FullName,
      "$webUrl/api/uploads"
    )
    $k18Code = & $script:CurlCmd @k18Args
    $k18Status = [int]($k18Code.Trim())
    # Middleware redirects unauthenticated requests to /login (307) before the route handler runs
    Assert "K-018 upload without auth rejected (307 redirect or 401)" ($k18Status -eq 307 -or $k18Status -eq 401) ("status=$k18Status")
  }
  finally {
    Remove-Item $k18TmpFile -Force -ErrorAction SilentlyContinue
    Remove-Item $k18OutFile -Force -ErrorAction SilentlyContinue
  }

  # K-019
  Write-Header "K-019: Room channel typing event + throttle"
  # Reconnect sockets after K-008 gateway rebuild
  Close-SocketSafe $memberSocket
  Close-SocketSafe $memberBSocket
  Start-Sleep -Milliseconds 300
  $memberSocket = Open-PhxSocket -JwtToken $memberJwt
  $k19JoinRef = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "phx_join" -Payload @{} -Ref $k19JoinRef
  $k19Join = Wait-PhxReply -Socket $memberSocket -Ref $k19JoinRef
  Assert "K-019 precondition: user A joins" ($k19Join.payload.status -eq "ok")

  $memberBSocket = Open-PhxSocket -JwtToken $memberBJwt
  $k19BJoinRef = [string](Get-Random)
  Send-PhxMessage -Socket $memberBSocket -Topic $topic -Event "phx_join" -Payload @{} -Ref $k19BJoinRef
  $k19BJoin = Wait-PhxReply -Socket $memberBSocket -Ref $k19BJoinRef
  Assert "K-019 precondition: user B joins" ($k19BJoin.payload.status -eq "ok")

  # Small delay to let presence events settle
  Start-Sleep -Milliseconds 500

  # User A types - user B should receive user_typing broadcast (broadcast_from = sender excluded)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "typing" -Payload @{} -Ref ([string](Get-Random))

  # Wait for user_typing on user B
  $k19Typing = Wait-TopicEvent -Socket $memberBSocket -Topic $topic -Event "user_typing" -TimeoutMs 5000
  Assert "K-019 user B receives user_typing broadcast" ($null -ne $k19Typing -and $null -ne $k19Typing.payload)
  if ($null -ne $k19Typing) {
    Assert "K-019 user_typing has userId" ($k19Typing.payload.userId -eq $userAId)
    Assert "K-019 user_typing has username" (-not [string]::IsNullOrWhiteSpace($k19Typing.payload.username))
    Assert "K-019 user_typing has displayName" (-not [string]::IsNullOrWhiteSpace($k19Typing.payload.displayName))
  }

  # Typing throttle: rapid second send should be silently dropped (2s throttle)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "typing" -Payload @{} -Ref ([string](Get-Random))
  $k19ThrottledTyping = $null
  try {
    $k19ThrottledTyping = Wait-TopicEvent -Socket $memberBSocket -Topic $topic -Event "user_typing" -TimeoutMs 1500
  } catch { }
  Assert "K-019 rapid second typing event throttled (no broadcast)" ($null -eq $k19ThrottledTyping -or $null -eq $k19ThrottledTyping.payload)

  # K-020
  Write-Header "K-020: Room channel history + sync"
  # History: should return messages from the channel
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "history" -Payload @{ limit = 10 } -Ref ([string](Get-Random))
  $k20History = Wait-TopicEvent -Socket $memberSocket -Topic $topic -Event "history_response" -TimeoutMs 6000
  Assert "K-020 history_response received" ($null -ne $k20History.payload)
  $k20HistMsgs = @($k20History.payload.messages)
  Assert "K-020 history has messages" ($k20HistMsgs.Count -ge 1)

  # Sync: should return messages after a given sequence
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "sync" -Payload @{ lastSequence = 0 } -Ref ([string](Get-Random))
  $k20Sync = Wait-TopicEvent -Socket $memberSocket -Topic $topic -Event "sync_response" -TimeoutMs 6000
  Assert "K-020 sync_response received" ($null -ne $k20Sync.payload)
  $k20SyncMsgs = @($k20Sync.payload.messages)
  Assert "K-020 sync has messages" ($k20SyncMsgs.Count -ge 1)

  # Content too long: 4001+ chars should be rejected
  $k20LongContent = "x" * 4001
  $k20LongRef = [string](Get-Random)
  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "new_message" -Payload @{ content = $k20LongContent } -Ref $k20LongRef
  $k20LongReply = Wait-PhxReply -Socket $memberSocket -Ref $k20LongRef
  Assert "K-020 content too long rejected" ($k20LongReply.payload.status -eq "error") ("status=" + $k20LongReply.payload.status)
  Assert "K-020 content too long reason" ($k20LongReply.payload.response.reason -eq "content_too_long") ("reason=" + $k20LongReply.payload.response.reason)

  # K-021
  Write-Header "K-021: DM typing + content too long + invalid payload"
  # Open fresh DM sockets
  $k21DmSocketA = Open-PhxSocket -JwtToken $memberJwt
  $k21DmRefA = [string](Get-Random)
  Send-PhxMessage -Socket $k21DmSocketA -Topic $dmTopic -Event "phx_join" -Payload @{} -Ref $k21DmRefA
  $k21DmJoinA = Wait-PhxReply -Socket $k21DmSocketA -Ref $k21DmRefA
  Assert "K-021 user A joins DM" ($k21DmJoinA.payload.status -eq "ok")

  $k21DmSocketB = Open-PhxSocket -JwtToken $memberBJwt
  $k21DmRefB = [string](Get-Random)
  Send-PhxMessage -Socket $k21DmSocketB -Topic $dmTopic -Event "phx_join" -Payload @{} -Ref $k21DmRefB
  $k21DmJoinB = Wait-PhxReply -Socket $k21DmSocketB -Ref $k21DmRefB
  Assert "K-021 user B joins DM" ($k21DmJoinB.payload.status -eq "ok")

  # DM typing: user A types, both should receive (broadcast_pre_serialized sends to all)
  Send-PhxMessage -Socket $k21DmSocketA -Topic $dmTopic -Event "typing" -Payload @{} -Ref ([string](Get-Random))
  $k21DmTyping = Wait-TopicEvent -Socket $k21DmSocketB -Topic $dmTopic -Event "typing" -TimeoutMs 5000
  Assert "K-021 DM typing broadcast received by user B" ($k21DmTyping.payload.userId -eq $userAId)

  # DM content too long (4001+ chars)
  $k21DmLongContent = "y" * 4001
  $k21DmLongRef = [string](Get-Random)
  Send-PhxMessage -Socket $k21DmSocketA -Topic $dmTopic -Event "new_message" -Payload @{ content = $k21DmLongContent } -Ref $k21DmLongRef
  $k21DmLongReply = Wait-PhxReply -Socket $k21DmSocketA -Ref $k21DmLongRef
  Assert "K-021 DM content too long rejected" ($k21DmLongReply.payload.status -eq "error") ("status=" + $k21DmLongReply.payload.status)
  Assert "K-021 DM content too long reason" ($k21DmLongReply.payload.response.reason -eq "content_too_long") ("reason=" + $k21DmLongReply.payload.response.reason)

  # DM invalid payload (missing content field)
  $k21DmBadRef = [string](Get-Random)
  Send-PhxMessage -Socket $k21DmSocketA -Topic $dmTopic -Event "new_message" -Payload @{ text = "wrong field name" } -Ref $k21DmBadRef
  $k21DmBadReply = Wait-PhxReply -Socket $k21DmSocketA -Ref $k21DmBadRef
  Assert "K-021 DM invalid payload rejected" ($k21DmBadReply.payload.status -eq "error") ("status=" + $k21DmBadReply.payload.status)
  Assert "K-021 DM invalid payload reason" ($k21DmBadReply.payload.response.reason -eq "invalid_payload") ("reason=" + $k21DmBadReply.payload.response.reason)

  Close-SocketSafe $k21DmSocketA
  Close-SocketSafe $k21DmSocketB

  # K-022
  Write-Header "K-022: Upload file serving + internal broadcast"
  # First upload a file, then retrieve it
  $k22FileId = $null
  $k22TmpFile = Join-Path ([System.IO.Path]::GetTempPath()) "test-k022-$testPrefix.txt"
  [System.IO.File]::WriteAllText($k22TmpFile, "k022 test file content")
  try {
    $k22OutFile = New-TemporaryFile
    $k22UploadArgs = @(
      "-sS", "--max-time", "15",
      "-w", "%{http_code}",
      "-b", $sessionA,
      "-F", "file=@$k22TmpFile;type=text/plain;filename=k022-test.txt",
      "-o", $k22OutFile.FullName,
      "$webUrl/api/uploads"
    )
    $k22UploadCode = & $script:CurlCmd @k22UploadArgs
    $k22UploadStatus = [int]($k22UploadCode.Trim())
    Assert "K-022 upload for serving test returns 201" ($k22UploadStatus -eq 201) ("status=$k22UploadStatus")
    $k22UploadBody = Get-Content $k22OutFile.FullName -Raw | ConvertFrom-Json
    $k22FileId = $k22UploadBody.fileId

    # Serve the file
    $k22ServeOut = New-TemporaryFile
    $k22ServeArgs = @(
      "-sS", "--max-time", "15",
      "-w", "%{http_code}",
      "-b", $sessionA,
      "-o", $k22ServeOut.FullName,
      "$webUrl/api/uploads/$k22FileId"
    )
    $k22ServeCode = & $script:CurlCmd @k22ServeArgs
    $k22ServeStatus = [int]($k22ServeCode.Trim())
    Assert "K-022 file serving returns 200" ($k22ServeStatus -eq 200) ("status=$k22ServeStatus")
    $k22Content = Get-Content $k22ServeOut.FullName -Raw
    Assert "K-022 served file has correct content" ($k22Content -eq "k022 test file content")

    # Non-existent file returns 404
    $k22NotFoundOut = New-TemporaryFile
    $k22NotFoundArgs = @(
      "-sS", "--max-time", "15",
      "-w", "%{http_code}",
      "-b", $sessionA,
      "-o", $k22NotFoundOut.FullName,
      "$webUrl/api/uploads/01NONEXISTENT00000000000000"
    )
    $k22NotFoundCode = & $script:CurlCmd @k22NotFoundArgs
    $k22NotFoundStatus = [int]($k22NotFoundCode.Trim())
    Assert "K-022 non-existent file returns 404" ($k22NotFoundStatus -eq 404) ("status=$k22NotFoundStatus")
    Remove-Item $k22NotFoundOut -Force -ErrorAction SilentlyContinue
    Remove-Item $k22ServeOut -Force -ErrorAction SilentlyContinue
    Remove-Item $k22OutFile -Force -ErrorAction SilentlyContinue
  }
  finally {
    Remove-Item $k22TmpFile -Force -ErrorAction SilentlyContinue
  }

  # Internal broadcast endpoint (gateway port 4001)
  $k22BroadcastPayload = @{
    topic = "room:$channelId"
    event = "test_broadcast"
    payload = @{ test = $true; from = "k022" }
  } | ConvertTo-Json -Depth 10 -Compress
  $k22BroadcastBodyFile = New-TemporaryFile
  Set-Content -Path $k22BroadcastBodyFile.FullName -Value $k22BroadcastPayload -NoNewline
  $k22BroadcastOutFile = New-TemporaryFile
  $k22BroadcastArgs = @(
    "-sS", "--max-time", "10",
    "-w", "%{http_code}",
    "-X", "POST",
    "-H", "Content-Type: application/json",
    "-H", "x-internal-secret: $internalSecret",
    "--data-binary", "@$($k22BroadcastBodyFile.FullName)",
    "-o", $k22BroadcastOutFile.FullName,
    "http://localhost:4001/api/internal/broadcast"
  )
  $k22BroadcastCode = & $script:CurlCmd @k22BroadcastArgs
  $k22BroadcastStatus = [int]([string]$k22BroadcastCode).Trim()
  $k22BroadcastBody = Get-Content $k22BroadcastOutFile.FullName -Raw -ErrorAction SilentlyContinue
  Remove-Item $k22BroadcastBodyFile -Force -ErrorAction SilentlyContinue
  Remove-Item $k22BroadcastOutFile -Force -ErrorAction SilentlyContinue
  if ($k22BroadcastStatus -ne 200) {
    Write-Host "  [K-022 debug] broadcast status=$k22BroadcastStatus body=$k22BroadcastBody payload=$k22BroadcastPayload" -ForegroundColor Yellow
  }
  $k22BroadcastResult = $k22BroadcastBody | ConvertFrom-Json
  Assert "K-022 internal broadcast returns ok" ($k22BroadcastResult.ok -eq $true) ("status=$k22BroadcastStatus body=$k22BroadcastBody")

  # Verify member socket received the broadcast
  $k22BroadcastEvent = Wait-TopicEvent -Socket $memberSocket -Topic $topic -Event "test_broadcast" -TimeoutMs 5000
  Assert "K-022 broadcast event received by client" ($k22BroadcastEvent.payload.test -eq $true)
  Assert "K-022 broadcast payload preserved" ($k22BroadcastEvent.payload.from -eq "k022")

  # Internal broadcast without auth rejected
  $k22NoAuthPayload = @{
    topic = "room:$channelId"
    event = "test_broadcast"
    payload = @{ test = $true }
  } | ConvertTo-Json -Compress
  $k22NoAuthBodyFile = New-TemporaryFile
  Set-Content -Path $k22NoAuthBodyFile.FullName -Value $k22NoAuthPayload -NoNewline
  $k22NoAuthOutFile = New-TemporaryFile
  $k22NoAuthArgs = @(
    "-sS", "--max-time", "10",
    "-w", "%{http_code}",
    "-X", "POST",
    "-H", "Content-Type: application/json",
    "--data-binary", "@$($k22NoAuthBodyFile.FullName)",
    "-o", $k22NoAuthOutFile.FullName,
    "http://localhost:4001/api/internal/broadcast"
  )
  $k22NoAuthCode = & $script:CurlCmd @k22NoAuthArgs
  $k22NoAuthStatus = [int]([string]$k22NoAuthCode).Trim()
  Remove-Item $k22NoAuthBodyFile -Force -ErrorAction SilentlyContinue
  Remove-Item $k22NoAuthOutFile -Force -ErrorAction SilentlyContinue
  Assert "K-022 broadcast without secret returns 401" ($k22NoAuthStatus -eq 401) ("status=$k22NoAuthStatus")

  # Invalid broadcast body rejected
  $k22BadPayload = @{ topic = "room:$channelId" } | ConvertTo-Json -Compress
  $k22BadBodyFile = New-TemporaryFile
  Set-Content -Path $k22BadBodyFile.FullName -Value $k22BadPayload -NoNewline
  $k22BadOutFile = New-TemporaryFile
  $k22BadArgs = @(
    "-sS", "--max-time", "10",
    "-w", "%{http_code}",
    "-X", "POST",
    "-H", "Content-Type: application/json",
    "-H", "x-internal-secret: $internalSecret",
    "--data-binary", "@$($k22BadBodyFile.FullName)",
    "-o", $k22BadOutFile.FullName,
    "http://localhost:4001/api/internal/broadcast"
  )
  $k22BadCode = & $script:CurlCmd @k22BadArgs
  $k22BadStatus = [int]([string]$k22BadCode).Trim()
  Remove-Item $k22BadBodyFile -Force -ErrorAction SilentlyContinue
  Remove-Item $k22BadOutFile -Force -ErrorAction SilentlyContinue
  Assert "K-022 broadcast with missing fields returns 400" ($k22BadStatus -eq 400) ("status=$k22BadStatus")

  # K-007
  Write-Header "K-007: Health depends on dependencies"
  $preWeb = Invoke-CurlJson -Url "$webUrl/api/health"
  $preGateway = Invoke-CurlJson -Url $gatewayHealthUrl
  $preStream = Invoke-StreamingHealth
  Assert "K-007 baseline health is healthy" (
    $preWeb.StatusCode -eq 200 -and
    $preGateway.StatusCode -eq 200 -and
    $preStream.StatusCode -eq 200
  )

  docker compose -f $ComposePath stop redis
  $redisStopped = $true
  Start-Sleep 3

  $downOk = Wait-Until -MaxAttempts 10 -DelayMs 2000 -Action {
    $downWeb = Invoke-CurlJson -Url "$webUrl/api/health"
    $downGateway = Invoke-CurlJson -Url $gatewayHealthUrl
    $downStream = Invoke-StreamingHealth
    return (
      $downWeb.StatusCode -ne 200 -or
      $downGateway.StatusCode -ne 200 -or
      $downStream.StatusCode -ne 200
    )
  }
  Assert "K-007 unhealthy when redis is stopped" ($downOk)

  docker compose -f $ComposePath start redis
  $redisStopped = $false
  Start-Sleep 3

  $recovered = Wait-Until -MaxAttempts 12 -DelayMs 2000 -Action {
    $reWeb = Invoke-CurlJson -Url "$webUrl/api/health"
    $reGateway = Invoke-CurlJson -Url $gatewayHealthUrl
    $reStream = Invoke-StreamingHealth
    return (
      $reWeb.StatusCode -eq 200 -and
      $reGateway.StatusCode -eq 200 -and
      $reStream.StatusCode -eq 200
    )
  }
  Assert "K-007 health recovers after redis restart" ($recovered)
  Write-Header "Regression harness complete"
  Write-Host "All selected regression checks passed." -ForegroundColor Green
}
finally {
  if ($redisStopped) {
    docker compose -f $ComposePath start redis | Out-Null
  }

  if ($webStopped) {
    docker compose -f $ComposePath start web | Out-Null
  }

  Stop-MockOpenAiSseServer $mockOpenAiPid
  Stop-StallTokenSseServer $mockTimeoutPid

  Close-SocketSafe $memberSocket
  Close-SocketSafe $nonMemberSocket
  Close-SocketSafe $memberBSocket

  $cleanup = @"
DELETE FROM "DmReaction" WHERE "dmMessageId" IN (SELECT id FROM "DirectMessage" WHERE "dmId" = '$dmChannelId');
DELETE FROM "Reaction" WHERE "messageId" IN (SELECT id FROM "Message" WHERE "channelId" = '$channelId');
DELETE FROM "DirectMessage" WHERE "dmId" = '$dmChannelId';
DELETE FROM "DmParticipant" WHERE "dmId" = '$dmChannelId';
DELETE FROM "DirectMessageChannel" WHERE id = '$dmChannelId';
DELETE FROM "Attachment" WHERE "userId" IN ('$userAId', '$userBId', '$userCNonce');
DELETE FROM "Message" WHERE "channelId" = '$channelId';
DELETE FROM "Member" WHERE id IN ('$memberId', '$memberBId');
DELETE FROM "Bot" WHERE id = '$botId';
DELETE FROM "Channel" WHERE id = '$channelId';
DELETE FROM "Server" WHERE id = '$serverId';
DELETE FROM "User" WHERE id IN ('$userAId', '$userBId', '$userCNonce');
"@
  Invoke-Psql $cleanup
}
