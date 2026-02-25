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

function Write-Header([string]$Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
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

function Invoke-CurlJson {
  param(
    [Parameter(Mandatory)] [string]$Url,
    [string]$Method = "GET",
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

  $tmpFile = New-TemporaryFile
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
      $args += @("-H", "Content-Type: application/json", "--data", $payload)
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
    if (-not $task.Wait($TimeoutMs)) {
      throw "WebSocket receive timeout"
    }
    $result = $task.Result
    $chunk = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
    $accum.Append($chunk) | Out-Null

    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      return $null
    }
  } while (-not $result.EndOfMessage)

  return ($accum.ToString() | ConvertFrom-Json)
}

function Wait-PhxReply {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Ref,
    [int]$TimeoutMs = 6000
  )

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs 2000
    if ($null -eq $msg) {
      continue
    }

    if ($msg.event -eq "phx_reply" -and $msg.ref -eq $Ref) {
      return $msg
    }
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

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $msg = Receive-PhxMessage -Socket $Socket -TimeoutMs 2000
    if ($null -eq $msg) {
      continue
    }

    if ($msg.topic -eq $Topic -and $msg.event -eq $Event) {
      return $msg
    }
  }

  throw "Timed out waiting for event '$Event' on topic '$Topic'"
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
$userCNonce = New-TestId
$redisStopped = $false

Ensure-ServicesRunning

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
  $badHistory = Wait-TopicEvent -Socket $memberSocket -Topic $topic -Event "history_response"
  Assert "K-003 malformed history payload returns structured error" (
    $badHistory.payload.error.reason -eq "invalid_payload" -and
    $badHistory.payload.error.event -eq "history"
  )

  Send-PhxMessage -Socket $memberSocket -Topic $topic -Event "sync" -Payload @{ lastSequence = "bad" } -Ref ([string](Get-Random))
  $badSync = Wait-TopicEvent -Socket $memberSocket -Topic $topic -Event "sync_response"
  Assert "K-003 malformed sync payload returns structured error" (
    $badSync.payload.error.reason -eq "invalid_payload" -and
    $badSync.payload.error.event -eq "sync"
  )

  # K-005
  Write-Header "K-005: Health depends on dependencies"
  $preWeb = Invoke-CurlJson -Url "$webUrl/api/health"
  $preGateway = Invoke-CurlJson -Url $gatewayHealthUrl
  $preStream = Invoke-StreamingHealth
  Assert "K-005 baseline health is healthy" (
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
  Assert "K-005 unhealthy when redis is stopped" ($downOk)

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
  Assert "K-005 health recovers after redis restart" ($recovered)
  Write-Header "Regression harness complete"
  Write-Host "All selected regression checks passed." -ForegroundColor Green
}
finally {
  if ($redisStopped) {
    docker compose -f $ComposePath start redis | Out-Null
  }

  Close-SocketSafe $memberSocket
  Close-SocketSafe $nonMemberSocket

  $cleanup = @"
DELETE FROM "Member" WHERE id IN ('$memberId');
DELETE FROM "Channel" WHERE id = '$channelId';
DELETE FROM "Server" WHERE id = '$serverId';
DELETE FROM "User" WHERE id IN ('$userAId', '$userBId', '$userCNonce');
"@
  Invoke-Psql $cleanup
}
