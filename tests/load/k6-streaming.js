/**
 * k6-streaming.js — Streaming (bot trigger) load test for Tavok
 *
 * Tests the AI streaming path: authenticate, connect to a channel with a bot,
 * send a mention message (@claude hello), and measure time-to-first-token.
 *
 * Stages: Ramp 0 -> 5 -> 10 -> 0 VUs over 40s
 *
 * NOTE: This test requires a valid LLM API key configured in the streaming
 * proxy (Go service). Without one, the stream_token event will never arrive
 * and the "first token received" check will fail. This is expected behavior
 * in environments without LLM connectivity.
 *
 * Run:
 *   k6 run tests/load/k6-streaming.js
 *
 * Prerequisites:
 *   - Tavok stack running (make up)
 *   - Seed users exist: demo@tavok.ai / DemoPass123!
 *   - A bot configured in #general with trigger mode MENTION or ALWAYS
 */

import http from "k6/http";
import ws from "k6/ws";
import { check, sleep, fail } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const firstTokenLatency = new Trend("first_token_latency", true);
const wsConnectDuration = new Trend("ws_connect_duration", true);
const streamTriggered = new Counter("stream_triggered");
const firstTokenReceived = new Counter("first_token_received");
const wsConnectFailRate = new Rate("ws_connect_fail_rate");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const WS_URL = __ENV.WS_URL || "ws://localhost:4001";

const CREDENTIALS = {
  email: __ENV.USER_EMAIL || "demo@tavok.ai",
  password: __ENV.USER_PASSWORD || "DemoPass123!",
};

// The mention trigger — adjust if your bot has a different name
const BOT_MENTION = __ENV.BOT_MENTION || "@claude";
const FIRST_TOKEN_TIMEOUT_S = 10;

export const options = {
  stages: [
    { duration: "10s", target: 5 },
    { duration: "15s", target: 10 },
    { duration: "5s", target: 10 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    // LLM-dependent — may fail without valid API key. That is expected.
    first_token_latency: ["p(95)<10000"],
    ws_connect_duration: ["p(95)<3000"],
    ws_connect_fail_rate: ["rate<0.1"],
  },
};

// ---------------------------------------------------------------------------
// Helpers (shared auth logic)
// ---------------------------------------------------------------------------

function authenticate() {
  const jar = http.cookieJar();

  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf`, {
    redirects: 0,
    jar,
  });

  check(csrfRes, {
    "CSRF endpoint returns 200": (r) => r.status === 200,
  });

  let csrfToken = "";
  try {
    const csrfBody = JSON.parse(csrfRes.body);
    csrfToken = csrfBody.csrfToken || "";
  } catch (_) {
    fail("Failed to parse CSRF response");
  }

  const loginRes = http.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    {
      email: CREDENTIALS.email,
      password: CREDENTIALS.password,
      csrfToken: csrfToken,
      json: "true",
    },
    {
      redirects: 0,
      jar,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  check(loginRes, {
    "Login returns 200 or 302": (r) => r.status === 200 || r.status === 302,
  });

  if (loginRes.status === 302) {
    const location =
      loginRes.headers["Location"] || loginRes.headers["location"];
    if (location) {
      const redirectUrl = location.startsWith("http")
        ? location
        : `${BASE_URL}${location}`;
      http.get(redirectUrl, { jar, redirects: 5 });
    }
  }

  return jar;
}

function getJwt(jar) {
  const tokenRes = http.get(`${BASE_URL}/api/auth/token`, { jar });

  const ok = check(tokenRes, {
    "Token endpoint returns 200": (r) => r.status === 200,
  });

  if (!ok) {
    fail(`Token fetch failed: status=${tokenRes.status}`);
  }

  return JSON.parse(tokenRes.body).token;
}

/**
 * Find the #general channel (or first available channel).
 */
function findGeneralChannel(jar) {
  const serversRes = http.get(`${BASE_URL}/api/servers`, { jar });
  if (serversRes.status !== 200) return null;

  const servers = JSON.parse(serversRes.body).servers || [];
  if (servers.length === 0) return null;

  const server = servers[0];
  const channelsRes = http.get(
    `${BASE_URL}/api/servers/${server.id}/channels`,
    { jar }
  );
  if (channelsRes.status !== 200) return null;

  const channels = JSON.parse(channelsRes.body).channels || [];

  // Prefer #general, fall back to first channel
  const general = channels.find((c) => c.name === "general");
  return general || channels[0] || null;
}

// ---------------------------------------------------------------------------
// Main VU scenario
// ---------------------------------------------------------------------------

export default function () {
  // 1. Authenticate
  const jar = authenticate();
  const jwt = getJwt(jar);

  // 2. Find #general channel
  const channel = findGeneralChannel(jar);
  if (!channel) {
    console.warn("No channel found — skipping streaming test");
    sleep(1);
    return;
  }

  const channelTopic = `room:${channel.id}`;
  const wsUrl = `${WS_URL}/socket/websocket?token=${jwt}&vsn=2.0.0`;

  let refCounter = 1;
  function nextRef() {
    return String(refCounter++);
  }

  const connectStart = Date.now();
  let connectSuccess = false;

  const res = ws.connect(wsUrl, {}, function (socket) {
    const connectElapsed = Date.now() - connectStart;
    wsConnectDuration.add(connectElapsed);
    connectSuccess = true;
    wsConnectFailRate.add(0);

    let messageSentAt = 0;
    let gotFirstToken = false;

    socket.on("message", function (rawMsg) {
      try {
        const msg = JSON.parse(rawMsg);
        if (!Array.isArray(msg) || msg.length < 5) return;

        const [, , , event] = msg;

        // Listen for stream_start (bot triggered) and stream_token (first token)
        if (event === "stream_start" && messageSentAt > 0) {
          streamTriggered.add(1);
        }

        if (event === "stream_token" && !gotFirstToken && messageSentAt > 0) {
          gotFirstToken = true;
          const latency = Date.now() - messageSentAt;
          firstTokenLatency.add(latency);
          firstTokenReceived.add(1);
        }
      } catch (_) {
        // Ignore parse errors
      }
    });

    socket.on("error", function (e) {
      console.error(`WebSocket error: ${e}`);
    });

    // 3. Join the channel
    const joinRef = nextRef();
    socket.send(
      JSON.stringify([joinRef, joinRef, channelTopic, "phx_join", {}])
    );

    // Wait for join to complete
    sleep(0.5);

    // 4. Send a message that triggers the bot
    const ref = nextRef();
    const content = `${BOT_MENTION} hello from k6 VU ${__VU} at ${new Date().toISOString()}`;

    messageSentAt = Date.now();
    socket.send(
      JSON.stringify([null, ref, channelTopic, "new_message", { content }])
    );

    // 5. Wait for first token (up to FIRST_TOKEN_TIMEOUT_S)
    // We poll in small increments to detect the token event via the message handler.
    const deadline = Date.now() + FIRST_TOKEN_TIMEOUT_S * 1000;
    while (!gotFirstToken && Date.now() < deadline) {
      // Send heartbeats to keep the connection alive
      const hbRef = nextRef();
      socket.send(
        JSON.stringify([null, hbRef, "phoenix", "heartbeat", {}])
      );
      sleep(1);
    }

    if (!gotFirstToken) {
      console.warn(
        `VU ${__VU}: No stream_token received within ${FIRST_TOKEN_TIMEOUT_S}s ` +
          "(this is expected if no LLM API key is configured)"
      );
    }

    // Let any remaining stream events arrive
    sleep(1);

    socket.close();
  });

  if (!connectSuccess) {
    wsConnectFailRate.add(1);
    console.error("WebSocket connection failed");
  }

  sleep(1);
}
