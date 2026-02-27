param(
    [string]$ComposeFile = "docker-compose.yml",
    [switch]$StartServicesIfDown
)

$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ComposePath = Join-Path $RootDir $ComposeFile
$EnvPath = Join-Path $RootDir ".env"

$webUrl = "http://localhost:3000"
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

    $codeText = & curl.exe @args
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
  $Sql | & docker compose -f $ComposePath exec -T db psql -U hivechat -d hivechat -v ON_ERROR_STOP=1 | Out-Null
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
  $url = "$gatewayWsUrl/socket/websocket?token=$encodedToken"
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
$mockOpenAiPid = $null
$mockTimeoutPid = $null
$redisStopped = $false
$webStopped = $false

Ensure-ServicesRunning
$mockOpenAiPid = Start-MockOpenAiSseServer
$botApiKeyEncrypted = New-EncryptedApiKey -Plaintext "test-api-key"

try {
  Write-Header "Setting up deterministic fixture data"
  $now = (Get-Date).ToString("o")
  Invoke-Psql @"
BEGIN;
INSERT INTO "User" (id, email, username, "displayName", password, "createdAt", "updatedAt")
VALUES
('$userAId', '$testPrefix-a@example.com', '$testPrefix-a', 'Test User A', 'dummyhash', '$now'::timestamptz, '$now'::timestamptz),
('$userBId', '$testPrefix-b@example.com', '$testPrefix-b', 'Test User B', 'dummyhash', '$now'::timestamptz, '$now'::timestamptz),
('$userCNonce', '$testPrefix-c@example.com', '$testPrefix-c', 'Test User C', 'dummyhash', '$now'::timestamptz, '$now'::timestamptz);
INSERT INTO "Server" (id, name, "ownerId", "createdAt", "updatedAt")
VALUES ('$serverId', '$testPrefix server', '$userAId', '$now'::timestamptz, '$now'::timestamptz);
INSERT INTO "Channel" (id, "serverId", name, position, "createdAt", "updatedAt")
VALUES ('$channelId', '$serverId', '$testPrefix channel', 0, '$now'::timestamptz, '$now'::timestamptz);
INSERT INTO "Bot" (id, name, "serverId", "llmProvider", "llmModel", "apiEndpoint", "apiKeyEncrypted", "systemPrompt", temperature, "maxTokens", "isActive", "triggerMode", "createdAt", "updatedAt")
VALUES ('$botId', '$testPrefix bot', '$serverId', 'custom', 'gpt-4o-mini', 'http://web:3909', '$botApiKeyEncrypted', 'You are helpful.', 0.7, 512, true, 'ALWAYS', '$now'::timestamptz, '$now'::timestamptz);
INSERT INTO "Member" (id, "userId", "serverId", "joinedAt")
VALUES
('$memberId', '$userAId', '$serverId', '$now'::timestamptz);
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

  $cleanup = @"
DELETE FROM "Member" WHERE id IN ('$memberId');
DELETE FROM "Bot" WHERE id = '$botId';
DELETE FROM "Channel" WHERE id = '$channelId';
DELETE FROM "Server" WHERE id = '$serverId';
DELETE FROM "User" WHERE id IN ('$userAId', '$userBId', '$userCNonce');
"@
  Invoke-Psql $cleanup
}
