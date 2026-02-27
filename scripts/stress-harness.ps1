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

$script:PhxBacklog = @{}
$script:ScenarioResults = New-Object System.Collections.ArrayList
$script:Metrics = New-Object System.Collections.ArrayList
$script:Notes = New-Object System.Collections.ArrayList

function Write-Header([string]$Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
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

function Add-ScenarioResult([string]$Id, [string]$Status, [string]$Details, [int]$DurationMs) {
  $null = $script:ScenarioResults.Add([pscustomobject]@{
      id = $Id
      status = $Status
      details = $Details
      durationMs = $DurationMs
    })
}

function Add-Metric([string]$Metric, [string]$Target, [string]$Observed, [string]$Status) {
  $null = $script:Metrics.Add([pscustomobject]@{
      metric = $Metric
      target = $Target
      observed = $Observed
      status = $Status
    })
}

function Run-Scenario {
  param(
    [Parameter(Mandatory)] [string]$Id,
    [Parameter(Mandatory)] [scriptblock]$Body
  )

  Write-Header $Id
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    & $Body
    $sw.Stop()
    Add-ScenarioResult -Id $Id -Status "passed" -Details "" -DurationMs ([int]$sw.ElapsedMilliseconds)
    return $true
  }
  catch {
    $sw.Stop()
    Add-ScenarioResult -Id $Id -Status "failed" -Details $_.Exception.Message -DurationMs ([int]$sw.ElapsedMilliseconds)
    Write-Host "Scenario $Id failed: $($_.Exception.Message)" -ForegroundColor Red
    return $false
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

function Start-MockProfileServer() {
  $stubScript = @"
const http = require("http");
const server = http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  if (req.method !== "POST" || !path.endsWith("/v1/chat/completions")) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }

  const isSlow = path.startsWith("/slow/");
  const isInfraSlow = path.startsWith("/infra-slow/");
  const isStall = path.startsWith("/stall/");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  const writeToken = (token) => {
    res.write("data: " + JSON.stringify({ choices: [{ delta: { content: token } }] }) + "\n\n");
  };

  if (isStall) {
    writeToken("stall-0 ");
    setTimeout(() => writeToken("stall-1 "), 100);
    setTimeout(() => writeToken("stall-2 "), 200);
    return;
  }

  if (isInfraSlow) {
    for (let i = 0; i < 20; i += 1) {
      setTimeout(() => writeToken("infra-" + i + " "), i * 500);
    }
    setTimeout(() => {
      res.write("data: [DONE]\n\n");
      res.end();
    }, 10050);
    return;
  }

  if (isSlow) {
    setTimeout(() => {
      writeToken("slow-0 ");
      setTimeout(() => writeToken("slow-1 "), 200);
      setTimeout(() => writeToken("slow-2 "), 400);
      setTimeout(() => {
        res.write("data: [DONE]\n\n");
        res.end();
      }, 600);
    }, 2000);
    return;
  }

  writeToken("fast-0 ");
  setTimeout(() => {
    writeToken("fast-1 ");
    setTimeout(() => {
      res.write("data: [DONE]\n\n");
      res.end();
    }, 20);
  }, 20);
});

server.listen(3909, "0.0.0.0");
setInterval(() => {}, 2147483647);
"@

  $scriptB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($stubScript))
  $launchScript = "process.title='hive-mock-openai-profiles';eval(Buffer.from(process.env.HIVE_MOCK_PROFILES_B64,'base64').toString('utf8'));"
  & docker compose -f $ComposePath exec -d -e "HIVE_MOCK_PROFILES_B64=$scriptB64" web node -e $launchScript | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start profile SSE mock server"
  }
  Start-Sleep -Milliseconds 500
  return "hive-mock-openai-profiles"
}

function Stop-MockProfileServer([string]$ProcessMarker) {
  if ([string]::IsNullOrWhiteSpace($ProcessMarker)) {
    return
  }
  & docker compose -f $ComposePath exec -T web sh -lc "pkill -f $ProcessMarker 2>/dev/null || true" | Out-Null
}

function Get-MockRequests() {
  return @()
}

function Clear-MockRequests() {
  return
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
    $args = @("-sS", "--max-time", "15", "-o", $tmpFile.FullName, "-w", "%{http_code}", "-X", $Method)
    foreach ($pair in $Headers.GetEnumerator()) {
      $args += @("-H", "$($pair.Key): $($pair.Value)")
    }
    if ($Body -ne $null) {
      if ($Body -is [string]) {
        $payload = $Body
      }
      else {
        $payload = $Body | ConvertTo-Json -Compress -Depth 20
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

function Invoke-Psql([string]$Sql) {
  $Sql | & docker compose -f $ComposePath exec -T db psql -U hivechat -d hivechat -v ON_ERROR_STOP=1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "psql command failed"
  }
}

function Invoke-PsqlScalar([string]$Sql) {
  $result = $Sql | & docker compose -f $ComposePath exec -T db psql -U hivechat -d hivechat -t -A -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) {
    throw "psql scalar query failed"
  }
  return ($result | Out-String).Trim()
}

function Wait-Until([int]$MaxAttempts, [int]$DelayMs, [scriptblock]$Action) {
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    if (& $Action) {
      return $true
    }
    Start-Sleep -Milliseconds $DelayMs
  }
  return $false
}

function Get-ServiceStatus() {
  return (docker compose -f $ComposePath ps --services --filter "status=running" 2>$null)
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
      throw "Services not running: $($missing -join ', ')."
    }
    & docker compose -f $ComposePath up -d
    Start-Sleep 5
  }
}

function Open-PhxSocket([string]$JwtToken) {
  $encodedToken = [uri]::EscapeDataString($JwtToken)
  $url = "$gatewayWsUrl/socket/websocket?token=$encodedToken"
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $uri = [Uri]$url
  $socket.ConnectAsync($uri, [System.Threading.CancellationToken]::None).Wait()
  return $socket
}

function Add-SocketBacklog {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [object]$Message
  )
  if ($null -eq $Socket -or $null -eq $Message) { return }
  $key = [string]$Socket.GetHashCode()
  if (-not $script:PhxBacklog.ContainsKey($key) -or $null -eq $script:PhxBacklog[$key]) {
    $script:PhxBacklog[$key] = New-Object System.Collections.ArrayList
  }
  [void]$script:PhxBacklog[$key].Add($Message)
}

function Pop-SocketBacklogMatch {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [scriptblock]$Predicate
  )
  if ($null -eq $Socket -or $null -eq $Predicate) { return $null }
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
  $payloadText = $msg | ConvertTo-Json -Depth 20 -Compress
  $payloadBytes = [Text.Encoding]::UTF8.GetBytes($payloadText)
  $seg = [System.ArraySegment[byte]]::new($payloadBytes)
  $Socket.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()
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
    try {
      if (-not $task.Wait($TimeoutMs)) {
        return $null
      }
    }
    catch {
      return $null
    }
    try {
      $result = $task.Result
    }
    catch {
      return $null
    }

    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      return $null
    }

    $chunk = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
    $accum.Append($chunk) | Out-Null
  } while (-not $result.EndOfMessage)

  $rawFrame = $accum.ToString()
  try {
    return ($rawFrame | ConvertFrom-Json)
  }
  catch {
    return $null
  }
}

function Wait-PhxReply {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Ref,
    [int]$TimeoutMs = 8000
  )
  $backlogMatch = Pop-SocketBacklogMatch -Socket $Socket -Predicate { param($m) $m.event -eq "phx_reply" -and $m.ref -eq $Ref }
  if ($null -ne $backlogMatch) { return $backlogMatch }

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs 2000
    if ($null -eq $msg) { continue }
    if ($msg.event -eq "phx_reply" -and $msg.ref -eq $Ref) { return $msg }
    Add-SocketBacklog -Socket $Socket -Message $msg
  }
  throw "Timed out waiting for phx_reply ref $Ref"
}

function Wait-TopicEventMatching {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Topic,
    [string]$Event,
    [scriptblock]$Predicate,
    [int]$TimeoutMs = 8000
  )
  $matcher = $Predicate
  $backlogMatch = Pop-SocketBacklogMatch -Socket $Socket -Predicate { param($m) $m.topic -eq $Topic -and $m.event -eq $Event -and (& $matcher $m) }
  if ($null -ne $backlogMatch) { return $backlogMatch }

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs 2000
    if ($null -eq $msg) { continue }
    if ($msg.topic -eq $Topic -and $msg.event -eq $Event -and (& $Predicate $msg)) { return $msg }
    Add-SocketBacklog -Socket $Socket -Message $msg
  }
  throw "Timed out waiting for event '$Event' on topic '$Topic'"
}

function Wait-StreamStartForSequence {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Topic,
    [string]$ExpectedSequence,
    [int]$TimeoutMs = 15000
  )
  return (Wait-TopicEventMatching -Socket $Socket -Topic $Topic -Event "stream_start" -Predicate {
      param($m)
      [string]$m.payload.sequence -eq [string]$ExpectedSequence
    } -TimeoutMs $TimeoutMs)
}

function Wait-StreamEventForMessage {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Topic,
    [string]$Event,
    [string]$MessageId,
    [int]$TimeoutMs = 45000
  )
  return (Wait-TopicEventMatching -Socket $Socket -Topic $Topic -Event $Event -Predicate {
      param($m)
      [string]$m.payload.messageId -eq [string]$MessageId
    } -TimeoutMs $TimeoutMs)
}

function Wait-NoTopicEvent {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Topic,
    [string]$Event,
    [int]$TimeoutMs = 3000
  )
  $backlogMatch = Pop-SocketBacklogMatch -Socket $Socket -Predicate {
    param($m)
    $m.topic -eq $Topic -and $m.event -eq $Event
  }
  if ($null -ne $backlogMatch) {
    return $false
  }

  $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs $TimeoutMs
  if ($null -eq $msg) {
    return $true
  }
  if ($msg.topic -eq $Topic -and $msg.event -eq $Event) {
    return $false
  }
  Add-SocketBacklog -Socket $Socket -Message $msg
  return $true
}

function Join-Room {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$ChannelId,
    [string]$LastSequence = "0"
  )
  $topic = "room:$ChannelId"
  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $Socket -Topic $topic -Event "phx_join" -Payload @{ lastSequence = $LastSequence } -Ref $ref
  $reply = Wait-PhxReply -Socket $Socket -Ref $ref
  if ($reply.payload.status -ne "ok") {
    throw "Join failed for ${topic}: $($reply | ConvertTo-Json -Compress -Depth 8)"
  }
  return $topic
}

function Leave-Room {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$ChannelId
  )
  $topic = "room:$ChannelId"
  $ref = [string](Get-Random)
  Send-PhxMessage -Socket $Socket -Topic $topic -Event "phx_leave" -Payload @{} -Ref $ref
  $reply = Wait-PhxReply -Socket $Socket -Ref $ref -TimeoutMs 5000
  return $reply
}

function Send-UserMessage {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$ChannelId,
    [string]$Content
  )
  $topic = "room:$ChannelId"
  $ref = [string](Get-Random)
  $sendAt = [DateTimeOffset]::UtcNow
  Send-PhxMessage -Socket $Socket -Topic $topic -Event "new_message" -Payload @{ content = $Content } -Ref $ref
  $reply = Wait-PhxReply -Socket $Socket -Ref $ref -TimeoutMs 10000
  return [pscustomobject]@{
    SentAt = $sendAt
    Reply = $reply
  }
}

function Collect-MessageOrder {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$ChannelId,
    [string[]]$ExpectedIds,
    [int]$TimeoutMs = 12000
  )
  $topic = "room:$ChannelId"
  $seen = @{}
  $order = New-Object System.Collections.ArrayList
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)

  while ((Get-Date) -lt $deadline -and $seen.Count -lt $ExpectedIds.Count) {
    $matchedBacklog = Pop-SocketBacklogMatch -Socket $Socket -Predicate {
      param($m)
      $m.topic -eq $topic -and $m.event -eq "message_new" -and ($ExpectedIds -contains [string]$m.payload.id) -and (-not $seen.ContainsKey([string]$m.payload.id))
    }
    if ($null -ne $matchedBacklog) {
      $id = [string]$matchedBacklog.payload.id
      $seen[$id] = $true
      [void]$order.Add($matchedBacklog)
      continue
    }

    $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs 2000
    if ($null -eq $msg) { continue }
    $isExpected = $msg.topic -eq $topic -and $msg.event -eq "message_new" -and ($ExpectedIds -contains [string]$msg.payload.id) -and (-not $seen.ContainsKey([string]$msg.payload.id))
    if ($isExpected) {
      $id = [string]$msg.payload.id
      $seen[$id] = $true
      [void]$order.Add($msg)
    }
    else {
      Add-SocketBacklog -Socket $Socket -Message $msg
    }
  }

  if ($seen.Count -ne $ExpectedIds.Count) {
    throw "Timed out collecting all message_new events. saw=$($seen.Count) expected=$($ExpectedIds.Count)"
  }
  return @($order)
}

function Get-InternalMessageById([string]$MessageId, [string]$InternalSecret) {
  $res = Invoke-CurlJson -Url "$webUrl/api/internal/messages/$MessageId" -Method GET -Headers @{ "x-internal-secret" = $InternalSecret }
  if ($res.StatusCode -ne 200) {
    throw "message fetch failed for $MessageId status=$($res.StatusCode)"
  }
  return ($res.BodyText | ConvertFrom-Json)
}

function Close-SocketSafe([System.Net.WebSockets.ClientWebSocket]$Socket) {
  if (-not $Socket) { return }
  try {
    if ($Socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $Socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [System.Threading.CancellationToken]::None).Wait()
    }
  }
  catch {}
}

$envVars = Load-Env $EnvPath
$internalSecret = $envVars["INTERNAL_API_SECRET"]
if ([string]::IsNullOrWhiteSpace($internalSecret)) { $internalSecret = "dev-secret-minimum-16chars" }
$jwtSecret = $envVars["JWT_SECRET"]
if ([string]::IsNullOrWhiteSpace($jwtSecret)) { $jwtSecret = "dev-secret-minimum-16chars" }

$testPrefix = ("st" + (Get-Date -Format "MMddHHmmss"))
$mockPid = $null
$allSockets = New-Object System.Collections.ArrayList
$infraWatchdogOverrideApplied = $false
$watchdogComposeOverridePath = Join-Path $RootDir "docker-compose.watchdog-test.yml"

$userLetters = @("a", "b", "c", "d", "e", "f", "g", "h")
$users = @{}
foreach ($letter in $userLetters) {
  $users[$letter] = New-TestId
}

$serverId = New-TestId
$channelMainId = New-TestId
$channelXId = New-TestId
$channelYId = New-TestId
$channelZId = New-TestId
$channelLoadId = New-TestId
$botAlphaId = New-TestId
$botBetaId = New-TestId
$botGammaId = New-TestId
$memberIds = @{}
foreach ($letter in $userLetters) {
  $memberIds[$letter] = New-TestId
}

try {
  Ensure-ServicesRunning
  $mockPid = Start-MockProfileServer
  Clear-MockRequests

  $apiKeyEncrypted = New-EncryptedApiKey -Plaintext "stress-test-key"
  $now = (Get-Date).ToString("o")

  $userRows = @()
  foreach ($letter in $userLetters) {
    $id = $users[$letter]
    $userRows += "('$id', '$testPrefix-$letter@example.com', '$testPrefix-$letter', 'User $($letter.ToUpper())', 'dummyhash', '$now'::timestamptz, '$now'::timestamptz)"
  }
  $usersSql = $userRows -join ",`n"

  $memberRows = @()
  foreach ($letter in $userLetters) {
    $memberRows += "('$($memberIds[$letter])', '$($users[$letter])', '$serverId', '$now'::timestamptz)"
  }
  $membersSql = $memberRows -join ",`n"

  Invoke-Psql @"
BEGIN;
INSERT INTO "User" (id, email, username, "displayName", password, "createdAt", "updatedAt")
VALUES
$usersSql;

INSERT INTO "Server" (id, name, "ownerId", "createdAt", "updatedAt")
VALUES
('$serverId', '$testPrefix server', '$($users["a"])', '$now'::timestamptz, '$now'::timestamptz);

INSERT INTO "Channel" (id, "serverId", name, position, "createdAt", "updatedAt")
VALUES
('$channelMainId', '$serverId', '$testPrefix-main', 0, '$now'::timestamptz, '$now'::timestamptz),
('$channelXId', '$serverId', '$testPrefix-x', 1, '$now'::timestamptz, '$now'::timestamptz),
('$channelYId', '$serverId', '$testPrefix-y', 2, '$now'::timestamptz, '$now'::timestamptz),
('$channelZId', '$serverId', '$testPrefix-z', 3, '$now'::timestamptz, '$now'::timestamptz),
('$channelLoadId', '$serverId', '$testPrefix-load', 4, '$now'::timestamptz, '$now'::timestamptz);

INSERT INTO "Bot" (id, name, "serverId", "llmProvider", "llmModel", "apiEndpoint", "apiKeyEncrypted", "systemPrompt", temperature, "maxTokens", "isActive", "triggerMode", "createdAt", "updatedAt")
VALUES
('$botAlphaId', '$testPrefix-alpha', '$serverId', 'custom', 'gpt-4o-mini', 'http://web:3909/fast', '$apiKeyEncrypted', 'alpha', 0.2, 1024, true, 'ALWAYS', '$now'::timestamptz, '$now'::timestamptz),
('$botBetaId', '$testPrefix-beta', '$serverId', 'custom', 'gpt-4o-mini', 'http://web:3909/slow', '$apiKeyEncrypted', 'beta', 0.2, 1024, true, 'ALWAYS', '$now'::timestamptz, '$now'::timestamptz),
('$botGammaId', '$testPrefix-gamma', '$serverId', 'custom', 'gpt-4o-mini', 'http://web:3909/fast', '$apiKeyEncrypted', 'gamma', 0.2, 1024, true, 'ALWAYS', '$now'::timestamptz, '$now'::timestamptz);

INSERT INTO "Member" (id, "userId", "serverId", "joinedAt")
VALUES
$membersSql;

UPDATE "Channel" SET "defaultBotId" = '$botAlphaId' WHERE id = '$channelXId';
UPDATE "Channel" SET "defaultBotId" = '$botBetaId' WHERE id = '$channelYId';
UPDATE "Channel" SET "defaultBotId" = '$botGammaId' WHERE id = '$channelZId';
COMMIT;
"@

  $jwts = @{}
  foreach ($letter in $userLetters) {
    $jwts[$letter] = New-Hs256Jwt -Secret $jwtSecret -Payload @{
      sub = $users[$letter]
      username = "$testPrefix-$letter"
      displayName = "User $($letter.ToUpper())"
      exp = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600)
    }
  }

$script:socketA = Open-PhxSocket -JwtToken $jwts["a"]; [void]$allSockets.Add($script:socketA)
$script:socketD = Open-PhxSocket -JwtToken $jwts["d"]; [void]$allSockets.Add($script:socketD)
$script:socketE = Open-PhxSocket -JwtToken $jwts["e"]; [void]$allSockets.Add($script:socketE)
  Join-Room -Socket $script:socketA -ChannelId $channelMainId | Out-Null
  Join-Room -Socket $script:socketD -ChannelId $channelMainId | Out-Null
  Join-Room -Socket $script:socketE -ChannelId $channelMainId | Out-Null

  $tier1Healthy = Run-Scenario -Id "M-01" -Body {
    $send = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content "m01-$testPrefix"
    Assert "M-01 A send accepted" ($send.Reply.payload.status -eq "ok")
    $messageId = [string]$send.Reply.payload.response.id
    $sequence = [string]$send.Reply.payload.response.sequence

    $topic = "room:$channelMainId"
    $recvA = Wait-TopicEventMatching -Socket $script:socketA -Topic $topic -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $messageId }
    $tA = [DateTimeOffset]::UtcNow
    $recvD = Wait-TopicEventMatching -Socket $script:socketD -Topic $topic -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $messageId }
    $tD = [DateTimeOffset]::UtcNow
    $recvE = Wait-TopicEventMatching -Socket $script:socketE -Topic $topic -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $messageId }
    $tE = [DateTimeOffset]::UtcNow

    Assert "M-01 all sockets got same message id" ($recvA.payload.id -eq $recvD.payload.id -and $recvD.payload.id -eq $recvE.payload.id)
    Assert "M-01 sequence singular across clients" ([string]$recvA.payload.sequence -eq [string]$recvD.payload.sequence -and [string]$recvD.payload.sequence -eq [string]$recvE.payload.sequence -and [string]$recvE.payload.sequence -eq $sequence)

    $dbCount = Invoke-PsqlScalar "SELECT COUNT(*) FROM ""Message"" WHERE id = '$messageId';"
    Assert "M-01 persisted exactly once" ($dbCount -eq "1") ("count=$dbCount")

    $latA = [int]($tA - $send.SentAt).TotalMilliseconds
    $latD = [int]($tD - $send.SentAt).TotalMilliseconds
    $latE = [int]($tE - $send.SentAt).TotalMilliseconds
    $maxLat = [Math]::Max($latA, [Math]::Max($latD, $latE))
    Add-Metric -Metric "Message broadcast latency (M-01 max)" -Target "<20ms" -Observed ("{0}ms" -f $maxLat) -Status ($(if ($maxLat -lt 20) { "pass" } else { "fail" }))
  }

  if (-not $tier1Healthy) {
    Add-ScenarioResult -Id "M-02" -Status "skipped" -Details "Skipped due to M-01 gating failure" -DurationMs 0
    Add-ScenarioResult -Id "M-03" -Status "skipped" -Details "Skipped due to M-01 gating failure" -DurationMs 0
    Add-ScenarioResult -Id "M-04" -Status "skipped" -Details "Skipped due to M-01 gating failure" -DurationMs 0
    Add-ScenarioResult -Id "M-05" -Status "skipped" -Details "Skipped due to M-01 gating failure" -DurationMs 0
  }
  else {
    Run-Scenario -Id "M-02" -Body {
      $sendA = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content "m02-a-$testPrefix"
      $sendD = Send-UserMessage -Socket $script:socketD -ChannelId $channelMainId -Content "m02-d-$testPrefix"
      $sendE = Send-UserMessage -Socket $script:socketE -ChannelId $channelMainId -Content "m02-e-$testPrefix"
      Assert "M-02 all sends accepted" (
        $sendA.Reply.payload.status -eq "ok" -and
        $sendD.Reply.payload.status -eq "ok" -and
        $sendE.Reply.payload.status -eq "ok"
      )

      $ids = @(
        [string]$sendA.Reply.payload.response.id,
        [string]$sendD.Reply.payload.response.id,
        [string]$sendE.Reply.payload.response.id
      )
      $seqs = @(
        [int64]$sendA.Reply.payload.response.sequence,
        [int64]$sendD.Reply.payload.response.sequence,
        [int64]$sendE.Reply.payload.response.sequence
      )
      $uniqSeq = $seqs | Sort-Object -Unique
      Assert "M-02 unique sequence numbers" ($uniqSeq.Count -eq 3)

      $orderA = Collect-MessageOrder -Socket $script:socketA -ChannelId $channelMainId -ExpectedIds $ids
      $orderD = Collect-MessageOrder -Socket $script:socketD -ChannelId $channelMainId -ExpectedIds $ids
      $orderE = Collect-MessageOrder -Socket $script:socketE -ChannelId $channelMainId -ExpectedIds $ids

      $orderSeqA = ($orderA | ForEach-Object { [string]$_.payload.sequence }) -join ","
      $orderSeqD = ($orderD | ForEach-Object { [string]$_.payload.sequence }) -join ","
      $orderSeqE = ($orderE | ForEach-Object { [string]$_.payload.sequence }) -join ","
      Assert "M-02 all clients observed same message order" ($orderSeqA -eq $orderSeqD -and $orderSeqD -eq $orderSeqE) ("A=$orderSeqA D=$orderSeqD E=$orderSeqE")
    } | Out-Null

    Run-Scenario -Id "M-03" -Body {
      $batch = @()
      for ($i = 0; $i -lt 10; $i++) {
        $batch += Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content ("m03-" + $i + "-" + $testPrefix)
      }
      $ok = @($batch | Where-Object { $_.Reply.payload.status -eq "ok" }).Count -eq 10
      Assert "M-03 all 10 sends accepted" $ok

      $ids = @($batch | ForEach-Object { [string]$_.Reply.payload.response.id })
      $seqs = @($batch | ForEach-Object { [int64]$_.Reply.payload.response.sequence })
      $sorted = $seqs | Sort-Object
      $contiguous = $true
      for ($i = 1; $i -lt $sorted.Count; $i++) {
        if ($sorted[$i] -ne ($sorted[$i - 1] + 1)) {
          $contiguous = $false
          break
        }
      }
      Assert "M-03 sequences contiguous for burst" $contiguous

      $null = Collect-MessageOrder -Socket $script:socketA -ChannelId $channelMainId -ExpectedIds $ids
      $null = Collect-MessageOrder -Socket $script:socketD -ChannelId $channelMainId -ExpectedIds $ids
      $null = Collect-MessageOrder -Socket $script:socketE -ChannelId $channelMainId -ExpectedIds $ids

      $inList = "'" + ($ids -join "','") + "'"
      $dbCount = Invoke-PsqlScalar "SELECT COUNT(*) FROM ""Message"" WHERE id IN ($inList);"
      Assert "M-03 all burst messages persisted" ($dbCount -eq "10") ("count=$dbCount")
    } | Out-Null

    Run-Scenario -Id "M-04" -Body {
      Close-SocketSafe $script:socketE
      $topic = "room:$channelMainId"
      $presenceDiff = Wait-TopicEventMatching -Socket $script:socketA -Topic $topic -Event "presence_diff" -Predicate {
        param($m)
        $leafKeys = @($m.payload.leaves.PSObject.Properties.Name)
        $leafKeys -contains $users["e"]
      } -TimeoutMs 10000
      Assert "M-04 presence diff shows E leave" ($null -ne $presenceDiff)

      $send = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content "m04-after-e-leave-$testPrefix"
      $messageId = [string]$send.Reply.payload.response.id
      $null = Wait-TopicEventMatching -Socket $script:socketA -Topic $topic -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $messageId }
      $null = Wait-TopicEventMatching -Socket $script:socketD -Topic $topic -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $messageId }
      Assert "M-04 message delivered to remaining users" $true

      $script:socketE = Open-PhxSocket -JwtToken $jwts["e"]
      [void]$allSockets.Add($script:socketE)
      Join-Room -Socket $script:socketE -ChannelId $channelMainId | Out-Null
    } | Out-Null

    Run-Scenario -Id "M-05" -Body {
      $before = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content "m05-before-join-$testPrefix"
      $beforeId = [string]$before.Reply.payload.response.id
      Assert "M-05 pre-join message accepted" ($before.Reply.payload.status -eq "ok")

      $after = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content "m05-after-join-$testPrefix"
      $afterId = [string]$after.Reply.payload.response.id
      $topic = "room:$channelMainId"
      $null = Wait-TopicEventMatching -Socket $script:socketE -Topic $topic -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $afterId }

      $historyRef = [string](Get-Random)
      Send-PhxMessage -Socket $script:socketE -Topic $topic -Event "history" -Payload @{ limit = 20 } -Ref $historyRef
      $history = Wait-TopicEventMatching -Socket $script:socketE -Topic $topic -Event "history_response" -Predicate {
        param($m)
        $ids = @($m.payload.messages | ForEach-Object { [string]$_.id })
        $ids -contains $beforeId
      } -TimeoutMs 12000
      Assert "M-05 joiner can fetch pre-join history" ($null -ne $history)
    } | Out-Null
  }

  $topicX = Join-Room -Socket $script:socketA -ChannelId $channelXId
  $topicY = Join-Room -Socket $script:socketA -ChannelId $channelYId
  $topicZ = Join-Room -Socket $script:socketA -ChannelId $channelZId
  $topicLoad = Join-Room -Socket $script:socketA -ChannelId $channelLoadId

  $tier2Healthy = Run-Scenario -Id "A-01" -Body {
    Clear-MockRequests
    $sendX = Send-UserMessage -Socket $script:socketA -ChannelId $channelXId -Content "a01-x-$testPrefix"
    $sendY = Send-UserMessage -Socket $script:socketA -ChannelId $channelYId -Content "a01-y-$testPrefix"
    Assert "A-01 trigger sends accepted" ($sendX.Reply.payload.status -eq "ok" -and $sendY.Reply.payload.status -eq "ok")

    $startX = Wait-StreamStartForSequence -Socket $script:socketA -Topic $topicX -ExpectedSequence ([string](([int64]$sendX.Reply.payload.response.sequence) + 1))
    $startY = Wait-StreamStartForSequence -Socket $script:socketA -Topic $topicY -ExpectedSequence ([string](([int64]$sendY.Reply.payload.response.sequence) + 1))
    $msgX = [string]$startX.payload.messageId
    $msgY = [string]$startY.payload.messageId
    Assert "A-01 distinct placeholder IDs" ($msgX -ne $msgY)

    $tokX = Wait-StreamEventForMessage -Socket $script:socketA -Topic $topicX -Event "stream_token" -MessageId $msgX
    $tokY = Wait-StreamEventForMessage -Socket $script:socketA -Topic $topicY -Event "stream_token" -MessageId $msgY
    Assert "A-01 no token cross contamination" ($tokX.payload.messageId -eq $msgX -and $tokY.payload.messageId -eq $msgY)

    $doneX = Wait-StreamEventForMessage -Socket $script:socketA -Topic $topicX -Event "stream_complete" -MessageId $msgX
    $doneY = Wait-StreamEventForMessage -Socket $script:socketA -Topic $topicY -Event "stream_complete" -MessageId $msgY
    Assert "A-01 both streams completed" ($doneX.payload.messageId -eq $msgX -and $doneY.payload.messageId -eq $msgY)
  }

  if (-not $tier2Healthy) {
    Add-ScenarioResult -Id "A-02" -Status "skipped" -Details "Skipped due to A-01 gating failure" -DurationMs 0
    Add-ScenarioResult -Id "A-03" -Status "skipped" -Details "Skipped due to A-01 gating failure" -DurationMs 0
    Add-ScenarioResult -Id "A-04" -Status "skipped" -Details "Not implemented in this pass" -DurationMs 0
    Add-ScenarioResult -Id "A-05" -Status "skipped" -Details "Skipped due to A-01 gating failure" -DurationMs 0
    Add-ScenarioResult -Id "A-06" -Status "skipped" -Details "Skipped due to A-01 gating failure" -DurationMs 0
  }
  else {
    Add-ScenarioResult -Id "A-02" -Status "not_tested" -Details "Redis request-body context inspection disabled in simplified timed harness" -DurationMs 0

    Run-Scenario -Id "A-03" -Body {
      Invoke-Psql "UPDATE ""Bot"" SET ""apiEndpoint"" = 'http://web:3909/slow' WHERE id = '$botAlphaId';"

      $sendResults = @()
      for ($i = 0; $i -lt 3; $i++) {
        $sendResults += Send-UserMessage -Socket $script:socketA -ChannelId $channelXId -Content ("a03-" + $i + "-$testPrefix")
      }
      $starts = @()
      foreach ($send in $sendResults) {
        $starts += Wait-StreamStartForSequence -Socket $script:socketA -Topic $topicX -ExpectedSequence ([string](([int64]$send.Reply.payload.response.sequence) + 1))
      }
      $streamIds = @($starts | ForEach-Object { [string]$_.payload.messageId })
      foreach ($sid in $streamIds) {
        $null = Wait-StreamEventForMessage -Socket $script:socketA -Topic $topicX -Event "stream_complete" -MessageId $sid -TimeoutMs 60000
      }
      Assert "A-03 all back-to-back streams complete" $true

      $userSeqs = @($sendResults | ForEach-Object { [int64]$_.Reply.payload.response.sequence } | Sort-Object)
      $botSeqs = @($starts | ForEach-Object { [int64]$_.payload.sequence } | Sort-Object)
      $interleaved = ($botSeqs[0] -eq ($userSeqs[0] + 1)) -and ($botSeqs[1] -eq ($userSeqs[1] + 1)) -and ($botSeqs[2] -eq ($userSeqs[2] + 1))
      Assert "A-03 sequence interleaving user->bot preserved" $interleaved ("user=$($userSeqs -join ',') bot=$($botSeqs -join ',')")

      Invoke-Psql "UPDATE ""Bot"" SET ""apiEndpoint"" = 'http://web:3909/fast' WHERE id = '$botAlphaId';"
    } | Out-Null

    Add-ScenarioResult -Id "A-04" -Status "skipped" -Details "Concurrency-limit saturation (35+) not executed in this timed run" -DurationMs 0

    Run-Scenario -Id "A-05" -Body {
      Invoke-Psql "UPDATE ""Bot"" SET ""triggerMode"" = 'MENTION' WHERE id = '$botGammaId';"
      $plain = Send-UserMessage -Socket $script:socketA -ChannelId $channelZId -Content "a05 no mention"
      Assert "A-05 plain send accepted" ($plain.Reply.payload.status -eq "ok")
      $plainSeq = [int64]$plain.Reply.payload.response.sequence
      Start-Sleep -Milliseconds 1200
      $plainFetch = Invoke-CurlJson -Url "$webUrl/api/internal/messages?channelId=$channelZId&afterSequence=$plainSeq&limit=5" -Method GET -Headers @{ "x-internal-secret" = $internalSecret }
      $plainPayload = $plainFetch.BodyText | ConvertFrom-Json
      $plainTriggered = @($plainPayload.messages | Where-Object { $_.type -eq "STREAMING" -and [int64]$_.sequence -eq ($plainSeq + 1) }).Count -gt 0
      Assert "A-05 plain message does not trigger stream" (-not $plainTriggered)

      $mentionText = "@$testPrefix-gamma please reply"
      $mention = Send-UserMessage -Socket $script:socketA -ChannelId $channelZId -Content $mentionText
      Assert "A-05 mention send accepted" ($mention.Reply.payload.status -eq "ok")
      $start = Wait-StreamStartForSequence -Socket $script:socketA -Topic $topicZ -ExpectedSequence ([string](([int64]$mention.Reply.payload.response.sequence) + 1))
      $msgId = [string]$start.payload.messageId
      $done = Wait-StreamEventForMessage -Socket $script:socketA -Topic $topicZ -Event "stream_complete" -MessageId $msgId
      Assert "A-05 mention triggers stream" ($done.payload.messageId -eq $msgId)

      Invoke-Psql "UPDATE ""Bot"" SET ""triggerMode"" = 'ALWAYS' WHERE id = '$botGammaId';"
    } | Out-Null

    Add-ScenarioResult -Id "A-06" -Status "not_tested" -Details "Per-endpoint routing proof disabled in simplified timed harness" -DurationMs 0
  }

  Run-Scenario -Id "S-11" -Body {
    $baseline = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content "s11-baseline-$testPrefix"
    Assert "S-11 baseline send accepted" ($baseline.Reply.payload.status -eq "ok")
    $lastSeq = [string]$baseline.Reply.payload.response.sequence
    $topicMain = "room:$channelMainId"
    $baselineId = [string]$baseline.Reply.payload.response.id
    $null = Wait-TopicEventMatching -Socket $script:socketD -Topic $topicMain -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $baselineId }

    Close-SocketSafe $script:socketD
    $script:socketD = Open-PhxSocket -JwtToken $jwts["d"]
    [void]$allSockets.Add($script:socketD)

    $missed = @()
    for ($i = 0; $i -lt 5; $i++) {
      $sent = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content ("s11-missed-" + $i + "-$testPrefix")
      $missed += [string]$sent.Reply.payload.response.id
    }

    Join-Room -Socket $script:socketD -ChannelId $channelMainId -LastSequence $lastSeq | Out-Null
    $sync = Wait-TopicEventMatching -Socket $script:socketD -Topic $topicMain -Event "sync_response" -Predicate {
      param($m)
      $ids = @($m.payload.messages | ForEach-Object { [string]$_.id })
      (@($missed | Where-Object { $ids -contains $_ }).Count -eq 5)
    } -TimeoutMs 12000
    Assert "S-11 reconnect receives all 5 missed messages" ($null -ne $sync)
  } | Out-Null

  Run-Scenario -Id "S-12" -Body {
    $socketA1 = Open-PhxSocket -JwtToken $jwts["a"]; [void]$allSockets.Add($socketA1)
    $socketA2 = Open-PhxSocket -JwtToken $jwts["a"]; [void]$allSockets.Add($socketA2)
    $socketD2 = Open-PhxSocket -JwtToken $jwts["d"]; [void]$allSockets.Add($socketD2)
    $topicMain = Join-Room -Socket $socketA1 -ChannelId $channelMainId
    Join-Room -Socket $socketA2 -ChannelId $channelMainId | Out-Null
    Join-Room -Socket $socketD2 -ChannelId $channelMainId | Out-Null

    $presenceState = Wait-TopicEventMatching -Socket $socketA2 -Topic $topicMain -Event "presence_state" -Predicate { param($m) $null -ne $m.payload } -TimeoutMs 6000
    $metaCount = 0
    if ($presenceState.payload.PSObject.Properties.Name -contains $users["a"]) {
      $metaCount = @($presenceState.payload.($users["a"]).metas).Count
    }
    $null = $script:Notes.Add("S-12 presence metas for user A: $metaCount")

    $msg = Send-UserMessage -Socket $socketD2 -ChannelId $channelMainId -Content "s12-from-d-$testPrefix"
    $id = [string]$msg.Reply.payload.response.id
    $null = Wait-TopicEventMatching -Socket $socketA1 -Topic $topicMain -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $id }
    $null = Wait-TopicEventMatching -Socket $socketA2 -Topic $topicMain -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $id }
    Assert "S-12 both sockets for same user receive broadcast" $true
  } | Out-Null

  Run-Scenario -Id "L-01" -Body {
    $payload = ("x" * 10000)
    $sent = Send-UserMessage -Socket $script:socketA -ChannelId $channelLoadId -Content $payload
    Assert "L-01 10KB send accepted" ($sent.Reply.payload.status -eq "ok")
    $message = Get-InternalMessageById -MessageId ([string]$sent.Reply.payload.response.id) -InternalSecret $internalSecret
    Assert "L-01 10KB persisted without truncation" ($message.content.Length -eq 10000) ("len=$($message.content.Length)")
  } | Out-Null

  Run-Scenario -Id "L-02" -Body {
    $payload = ("y" * 100000)
    $sent = Send-UserMessage -Socket $script:socketA -ChannelId $channelLoadId -Content $payload
    Assert "L-02 100KB send accepted" ($sent.Reply.payload.status -eq "ok")
    $message = Get-InternalMessageById -MessageId ([string]$sent.Reply.payload.response.id) -InternalSecret $internalSecret
    Assert "L-02 100KB persisted without truncation" ($message.content.Length -eq 100000) ("len=$($message.content.Length)")
  } | Out-Null

  Run-Scenario -Id "L-06" -Body {
    $batch = @()
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    for ($i = 0; $i -lt 100; $i++) {
      $batch += Send-UserMessage -Socket $script:socketA -ChannelId $channelLoadId -Content ("l06-" + $i + "-" + $testPrefix)
    }
    $timer.Stop()
    $accepted = @($batch | Where-Object { $_.Reply.payload.status -eq "ok" }).Count
    Assert "L-06 all 100 sends accepted" ($accepted -eq 100)

    $seqs = @($batch | ForEach-Object { [int64]$_.Reply.payload.response.sequence } | Sort-Object)
    $ok = $true
    for ($i = 1; $i -lt $seqs.Count; $i++) {
      if ($seqs[$i] -ne ($seqs[$i - 1] + 1)) { $ok = $false; break }
    }
    Assert "L-06 sequence monotonic contiguous" $ok

    $ids = @($batch | ForEach-Object { [string]$_.Reply.payload.response.id })
    $inList = "'" + ($ids -join "','") + "'"
    $count = Invoke-PsqlScalar "SELECT COUNT(*) FROM ""Message"" WHERE id IN ($inList);"
    Assert "L-06 all 100 persisted" ($count -eq "100") ("count=$count")

    $elapsedMs = [int]$timer.ElapsedMilliseconds
    $rate = [math]::Round((100000.0 / [double]$elapsedMs), 2)
    Add-Metric -Metric "Rapid throughput (L-06)" -Target "100 msgs / 10s" -Observed ("100 msgs / {0}ms ({1} msg/s)" -f $elapsedMs, $rate) -Status ($(if ($elapsedMs -le 10000) { "pass" } else { "fail" }))
  } | Out-Null

  Run-Scenario -Id "F-01" -Body {
    $topicMain = "room:$channelMainId"
    $before = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content "f01-before-redis-restart-$testPrefix"
    Assert "F-01 pre-restart send accepted" ($before.Reply.payload.status -eq "ok")
    $beforeSeq = [int64]$before.Reply.payload.response.sequence
    $beforeId = [string]$before.Reply.payload.response.id
    $null = Wait-TopicEventMatching -Socket $script:socketD -Topic $topicMain -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $beforeId }

    & docker compose -f $ComposePath restart redis | Out-Null
    $healthy = Wait-Until -MaxAttempts 20 -DelayMs 1500 -Action {
      $code = Invoke-CurlJson -Url $gatewayHealthUrl
      return $code.StatusCode -eq 200
    }
    Assert "F-01 gateway healthy after redis restart" $healthy

    $after = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content "f01-after-redis-restart-$testPrefix"
    Assert "F-01 post-restart send accepted" ($after.Reply.payload.status -eq "ok")
    $afterSeq = [int64]$after.Reply.payload.response.sequence
    Assert "F-01 sequence increases after reseed" ($afterSeq -gt $beforeSeq) ("before=$beforeSeq after=$afterSeq")
    $afterId = [string]$after.Reply.payload.response.id
    $null = Wait-TopicEventMatching -Socket $script:socketD -Topic $topicMain -Event "message_new" -Predicate { param($m) [string]$m.payload.id -eq $afterId }
  } | Out-Null

  Add-ScenarioResult -Id "S-09" -Status "not_tested" -Details "Not executed in this timed pass" -DurationMs 0
  Add-ScenarioResult -Id "S-10" -Status "not_tested" -Details "Not executed in this timed pass" -DurationMs 0
  Add-ScenarioResult -Id "L-03" -Status "not_tested" -Details "Verbose 10k-token stream not executed in this timed pass" -DurationMs 0
  Add-ScenarioResult -Id "L-04" -Status "not_tested" -Details "Large 20x10KB context not executed in this timed pass" -DurationMs 0
  Add-ScenarioResult -Id "L-05" -Status "not_tested" -Details "1,000-history pagination not executed in this timed pass" -DurationMs 0

  @"
services:
  gateway:
    environment:
      - STREAM_WATCHDOG_TIMEOUT_MS=5000
"@ | Set-Content -Path $watchdogComposeOverridePath -Encoding UTF8

  & docker compose -f $ComposePath -f $watchdogComposeOverridePath up -d --build gateway | Out-Null
  Start-Sleep -Seconds 12
  $infraWatchdogOverrideApplied = $true

  Run-Scenario -Id "F-02" -Body {
    Invoke-Psql "UPDATE ""Bot"" SET ""apiEndpoint"" = 'http://web:3909/infra-slow' WHERE id = '$botBetaId';"
    Close-SocketSafe $script:socketA
    $script:socketA = Open-PhxSocket -JwtToken $jwts["a"]
    [void]$allSockets.Add($script:socketA)
    Join-Room -Socket $script:socketA -ChannelId $channelYId | Out-Null

    $trigger = Send-UserMessage -Socket $script:socketA -ChannelId $channelYId -Content "f02-redis-kill-$testPrefix"
    Assert "F-02 trigger send accepted" ($trigger.Reply.payload.status -eq "ok")
    $start = Wait-StreamStartForSequence -Socket $script:socketA -Topic $topicY -ExpectedSequence ([string](([int64]$trigger.Reply.payload.response.sequence) + 1)) -TimeoutMs 20000
    $messageId = [string]$start.payload.messageId
    Start-Sleep -Seconds 2

    & docker compose -f $ComposePath stop redis | Out-Null
    Start-Sleep -Seconds 12
    & docker compose -f $ComposePath start redis | Out-Null

    $redisRecovered = Wait-Until -MaxAttempts 40 -DelayMs 1500 -Action {
      $running = Get-ServiceStatus
      return ($running -contains "redis")
    }
    Assert "F-02 redis service recovered" $redisRecovered

    $terminalEvent = "none"
    try {
      $null = Wait-StreamEventForMessage -Socket $script:socketA -Topic $topicY -Event "stream_complete" -MessageId $messageId -TimeoutMs 70000
      $terminalEvent = "stream_complete"
    }
    catch {
      try {
        $null = Wait-StreamEventForMessage -Socket $script:socketA -Topic $topicY -Event "stream_error" -MessageId $messageId -TimeoutMs 15000
        $terminalEvent = "stream_error"
      }
      catch {}
    }

    $f02Converged = Wait-Until -MaxAttempts 8 -DelayMs 5000 -Action {
      try {
        $probe = Get-InternalMessageById -MessageId $messageId -InternalSecret $internalSecret
        return [string]$probe.streamingStatus -ne "ACTIVE"
      }
      catch {
        return $false
      }
    }

    $message = Get-InternalMessageById -MessageId $messageId -InternalSecret $internalSecret
    $status = [string]$message.streamingStatus
    $null = $script:Notes.Add("F-02 messageId=$messageId terminalEvent=$terminalEvent streamingStatus=$status")
    Assert "F-02 message not stuck ACTIVE" $f02Converged ("status=$status")
  } | Out-Null

  Run-Scenario -Id "F-03" -Body {
    Invoke-Psql "UPDATE ""Bot"" SET ""apiEndpoint"" = 'http://web:3909/infra-slow' WHERE id = '$botBetaId';"
    Close-SocketSafe $script:socketA
    $script:socketA = Open-PhxSocket -JwtToken $jwts["a"]
    [void]$allSockets.Add($script:socketA)
    Join-Room -Socket $script:socketA -ChannelId $channelYId | Out-Null

    $trigger = Send-UserMessage -Socket $script:socketA -ChannelId $channelYId -Content "f03-streaming-kill-$testPrefix"
    Assert "F-03 trigger send accepted" ($trigger.Reply.payload.status -eq "ok")
    $start = Wait-StreamStartForSequence -Socket $script:socketA -Topic $topicY -ExpectedSequence ([string](([int64]$trigger.Reply.payload.response.sequence) + 1)) -TimeoutMs 20000
    $messageId = [string]$start.payload.messageId
    Start-Sleep -Seconds 2

    & docker compose -f $ComposePath stop streaming | Out-Null
    Start-Sleep -Seconds 60

    $message = Get-InternalMessageById -MessageId $messageId -InternalSecret $internalSecret
    $status = [string]$message.streamingStatus
    $null = $script:Notes.Add("F-03 messageId=$messageId streamingStatusAfter60s=$status")

    & docker compose -f $ComposePath start streaming | Out-Null
    $streamingRecovered = Wait-Until -MaxAttempts 40 -DelayMs 1500 -Action {
      $running = Get-ServiceStatus
      return ($running -contains "streaming")
    }
    Assert "F-03 streaming service recovered" $streamingRecovered
  } | Out-Null

  Run-Scenario -Id "F-04" -Body {
    Close-SocketSafe $script:socketA
    $script:socketA = Open-PhxSocket -JwtToken $jwts["a"]
    [void]$allSockets.Add($script:socketA)
    Join-Room -Socket $script:socketA -ChannelId $channelMainId | Out-Null

    $beforeContent = "f04-before-web-stop-$testPrefix"
    $duringContent = "f04-during-web-stop-$testPrefix"
    $afterContent = "f04-after-web-restart-$testPrefix"

    $before = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content $beforeContent
    Assert "F-04 pre-stop send accepted" ($before.Reply.payload.status -eq "ok")

    & docker compose -f $ComposePath stop web | Out-Null

    $duringReply = $null
    $duringError = $null
    try {
      $during = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content $duringContent
      $duringReply = $during.Reply
    }
    catch {
      $duringError = $_.Exception.Message
    }

    & docker compose -f $ComposePath start web | Out-Null
    $webRecovered = Wait-Until -MaxAttempts 60 -DelayMs 1500 -Action {
      $health = Invoke-CurlJson -Url "$webUrl/api/health"
      return $health.StatusCode -eq 200
    }
    Assert "F-04 web recovered after restart" $webRecovered
    Stop-MockProfileServer $mockPid
    $mockPid = Start-MockProfileServer

    Close-SocketSafe $script:socketA
    $script:socketA = Open-PhxSocket -JwtToken $jwts["a"]
    [void]$allSockets.Add($script:socketA)
    Join-Room -Socket $script:socketA -ChannelId $channelMainId | Out-Null

    $after = Send-UserMessage -Socket $script:socketA -ChannelId $channelMainId -Content $afterContent
    Assert "F-04 post-restart send accepted" ($after.Reply.payload.status -eq "ok")

    $duringStatus = "exception"
    if ($null -ne $duringReply) {
      $duringStatus = [string]$duringReply.payload.status
    }
    if ($null -ne $duringError) {
      $duringStatus = "exception:$duringError"
    }

    $duringPersisted = Invoke-PsqlScalar "SELECT COUNT(*) FROM ""Message"" WHERE ""channelId"" = '$channelMainId' AND content = '$duringContent';"
    $null = $script:Notes.Add("F-04 duringSendStatus=$duringStatus duringPersisted=$duringPersisted")

    Assert "F-04 no phantom during-downtime message persisted" ($duringPersisted -eq "0") ("persisted=$duringPersisted status=$duringStatus")
  } | Out-Null

  Run-Scenario -Id "F-05" -Body {
    Stop-MockProfileServer $mockPid
    $mockPid = Start-MockProfileServer

    Invoke-Psql "UPDATE ""Bot"" SET ""apiEndpoint"" = 'http://web:3909/infra-slow' WHERE id = '$botBetaId';"
    Close-SocketSafe $script:socketA
    $script:socketA = Open-PhxSocket -JwtToken $jwts["a"]
    [void]$allSockets.Add($script:socketA)
    Join-Room -Socket $script:socketA -ChannelId $channelYId | Out-Null

    $trigger = Send-UserMessage -Socket $script:socketA -ChannelId $channelYId -Content "f05-web-kill-near-complete-$testPrefix"
    Assert "F-05 trigger send accepted" ($trigger.Reply.payload.status -eq "ok")
    $start = Wait-StreamStartForSequence -Socket $script:socketA -Topic $topicY -ExpectedSequence ([string](([int64]$trigger.Reply.payload.response.sequence) + 1)) -TimeoutMs 20000
    $messageId = [string]$start.payload.messageId

    Start-Sleep -Seconds 5
    & docker compose -f $ComposePath stop web | Out-Null

    $terminalEvent = "none"
    try {
      $null = Wait-StreamEventForMessage -Socket $script:socketA -Topic $topicY -Event "stream_complete" -MessageId $messageId -TimeoutMs 70000
      $terminalEvent = "stream_complete"
    }
    catch {
      try {
        $null = Wait-StreamEventForMessage -Socket $script:socketA -Topic $topicY -Event "stream_error" -MessageId $messageId -TimeoutMs 15000
        $terminalEvent = "stream_error"
      }
      catch {}
    }

    $dbRow = Invoke-PsqlScalar "SELECT COALESCE(""streamingStatus""::text, '') || '|' || COALESCE(LEFT(content, 80), '') FROM ""Message"" WHERE id = '$messageId';"
    $parts = $dbRow -split "\|", 2
    $dbStatus = if ($parts.Length -gt 0) { $parts[0] } else { "" }
    $preview = if ($parts.Length -gt 1) { $parts[1] } else { "" }
    $null = $script:Notes.Add("F-05 messageId=$messageId terminalEvent=$terminalEvent dbStatus=$dbStatus contentPreview=$preview")

    & docker compose -f $ComposePath start web | Out-Null
    $webRecovered = Wait-Until -MaxAttempts 60 -DelayMs 1500 -Action {
      $health = Invoke-CurlJson -Url "$webUrl/api/health"
      return $health.StatusCode -eq 200
    }
    Assert "F-05 web recovered" $webRecovered
  } | Out-Null

  Run-Scenario -Id "F-06" -Body {
    & docker compose -f $ComposePath start web | Out-Null
    Stop-MockProfileServer $mockPid
    $mockPid = Start-MockProfileServer

    Invoke-Psql "UPDATE ""Bot"" SET ""apiEndpoint"" = 'http://web:3909/infra-slow' WHERE id = '$botBetaId';"
    Close-SocketSafe $script:socketA
    Close-SocketSafe $script:socketD
    $script:socketA = Open-PhxSocket -JwtToken $jwts["a"]
    $script:socketD = Open-PhxSocket -JwtToken $jwts["d"]
    [void]$allSockets.Add($script:socketA)
    [void]$allSockets.Add($script:socketD)
    Join-Room -Socket $script:socketA -ChannelId $channelYId | Out-Null
    Join-Room -Socket $script:socketD -ChannelId $channelYId | Out-Null

    $trigger = Send-UserMessage -Socket $script:socketA -ChannelId $channelYId -Content "f06-gateway-restart-$testPrefix"
    Assert "F-06 trigger send accepted" ($trigger.Reply.payload.status -eq "ok")
    $userSequence = [string]$trigger.Reply.payload.response.sequence
    $start = Wait-StreamStartForSequence -Socket $script:socketA -Topic $topicY -ExpectedSequence ([string](([int64]$trigger.Reply.payload.response.sequence) + 1)) -TimeoutMs 20000
    $messageId = [string]$start.payload.messageId

    & docker compose -f $ComposePath restart gateway | Out-Null

    $gatewayRecovered = Wait-Until -MaxAttempts 60 -DelayMs 1500 -Action {
      $health = Invoke-CurlJson -Url $gatewayHealthUrl
      return $health.StatusCode -eq 200
    }
    Assert "F-06 gateway recovered after restart" $gatewayRecovered

    Close-SocketSafe $script:socketA
    $script:socketA = Open-PhxSocket -JwtToken $jwts["a"]
    [void]$allSockets.Add($script:socketA)
    Join-Room -Socket $script:socketA -ChannelId $channelYId -LastSequence $userSequence | Out-Null

    $message = Get-InternalMessageById -MessageId $messageId -InternalSecret $internalSecret
    $status = [string]$message.streamingStatus
    $null = $script:Notes.Add("F-06 messageId=$messageId streamingStatusAfterGatewayRestart=$status")
  } | Out-Null

  Remove-Item $watchdogComposeOverridePath -ErrorAction SilentlyContinue
  & docker compose -f $ComposePath up -d --build gateway | Out-Null
  Start-Sleep -Seconds 12
  $infraWatchdogOverrideApplied = $false

  $streamLimit = & docker compose -f $ComposePath exec -T streaming printenv STREAMING_MAX_CONCURRENT_STREAMS
  $streamLimitClean = ($streamLimit | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($streamLimitClean)) {
    $streamLimitClean = "unset"
  }
  $null = $script:Notes.Add("STREAMING_MAX_CONCURRENT_STREAMS=$streamLimitClean")

  $artifactsDir = Join-Path $RootDir "artifacts"
  if (-not (Test-Path $artifactsDir)) {
    New-Item -ItemType Directory -Path $artifactsDir | Out-Null
  }

  $resultPath = Join-Path $artifactsDir "stress-results.json"
  [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    testPrefix = $testPrefix
    scenarios = $script:ScenarioResults
    metrics = $script:Metrics
    notes = $script:Notes
  } | ConvertTo-Json -Depth 20 | Set-Content -Path $resultPath -Encoding UTF8

  Write-Header "Stress harness complete"
  Write-Host "Result file: $resultPath" -ForegroundColor Green
}
finally {
  if ($infraWatchdogOverrideApplied) {
    Remove-Item $watchdogComposeOverridePath -ErrorAction SilentlyContinue
    & docker compose -f $ComposePath up -d --build gateway | Out-Null
    Start-Sleep -Seconds 12
  }

  foreach ($socket in $allSockets) {
    Close-SocketSafe $socket
  }

  Stop-MockProfileServer $mockPid

  $cleanupSql = @"
DELETE FROM "Message" WHERE "channelId" IN ('$channelMainId', '$channelXId', '$channelYId', '$channelZId', '$channelLoadId');
DELETE FROM "Member" WHERE "serverId" = '$serverId';
DELETE FROM "Channel" WHERE id IN ('$channelMainId', '$channelXId', '$channelYId', '$channelZId', '$channelLoadId');
DELETE FROM "Bot" WHERE id IN ('$botAlphaId', '$botBetaId', '$botGammaId');
DELETE FROM "Server" WHERE id = '$serverId';
DELETE FROM "User" WHERE id IN ('$($users["a"])', '$($users["b"])', '$($users["c"])', '$($users["d"])', '$($users["e"])', '$($users["f"])', '$($users["g"])', '$($users["h"])');
"@
  try {
    Invoke-Psql $cleanupSql
  }
  catch {
    Write-Host "Cleanup warning: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}
