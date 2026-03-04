/**
 * k6-typing-storm.js — Typing indicator fanout stress test for Tavok
 *
 * Stress-tests the server-side typing throttle (2000ms window per user,
 * see DEC-0031 in room_channel.ex). Each VU fires typing events every 200ms,
 * which means the Gateway should silently drop ~90% of them. This validates
 * that the server stays responsive under a storm of rapid typing indicators.
 *
 * Stages: Ramp 0 -> 10 -> 50 -> 0 VUs over 30s
 *
 * After the storm completes, the test hits the health endpoint to verify
 * that the server is still responsive.
 *
 * Run:
 *   k6 run tests/load/k6-typing-storm.js
 *
 * Prerequisites:
 *   - Tavok stack running (make up)
 *   - Seed users exist: demo@tavok.ai / DemoPass123!
 */

import http from "k6/http";
import ws from "k6/ws";
import { check, sleep, fail } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const wsConnectDuration = new Trend("ws_connect_duration", true);
const typingEventsSent = new Counter("typing_events_sent");
const typingEventsReceived = new Counter("typing_events_received");
const wsConnectFailRate = new Rate("ws_connect_fail_rate");
const healthCheckPass = new Rate("health_check_pass");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const WS_URL = __ENV.WS_URL || "ws://localhost:4001";

const CREDENTIALS = {
  email: __ENV.USER_EMAIL || "demo@tavok.ai",
  password: __ENV.USER_PASSWORD || "DemoPass123!",
};

// How often each VU sends a typing event (ms)
const TYPING_INTERVAL_MS = 200;

// How long each VU sustains the typing storm (s)
const STORM_DURATION_S = 8;

export const options = {
  stages: [
    { duration: "5s", target: 10 },
    { duration: "15s", target: 50 },
    { duration: "5s", target: 50 },
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    ws_connect_fail_rate: ["rate<0.1"],
    health_check_pass: ["rate>0.9"],
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

function findFirstChannel(jar) {
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

  // 2. Find a channel to storm
  const channel = findFirstChannel(jar);
  if (!channel) {
    console.warn("No channel found — skipping typing storm");
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

    socket.on("message", function (rawMsg) {
      try {
        const msg = JSON.parse(rawMsg);
        if (!Array.isArray(msg) || msg.length < 5) return;

        const [, , , event] = msg;

        // Count typing events we receive from other VUs (or ourselves via broadcast)
        if (event === "user_typing") {
          typingEventsReceived.add(1);
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

    // 4. Fire typing events at high frequency for STORM_DURATION_S seconds.
    // The server-side throttle (2000ms) should drop most of these.
    // With 200ms interval over 8s, each VU sends ~40 events but only ~4-5
    // should be broadcast (every 2000ms).
    const stormEnd = Date.now() + STORM_DURATION_S * 1000;
    let heartbeatCounter = 0;

    while (Date.now() < stormEnd) {
      const ref = nextRef();
      socket.send(
        JSON.stringify([null, ref, channelTopic, "typing", {}])
      );
      typingEventsSent.add(1);

      // Send heartbeat every ~5 seconds to keep connection alive
      heartbeatCounter++;
      if (heartbeatCounter % 25 === 0) {
        const hbRef = nextRef();
        socket.send(
          JSON.stringify([null, hbRef, "phoenix", "heartbeat", {}])
        );
      }

      sleep(TYPING_INTERVAL_MS / 1000);
    }

    // Let events settle
    sleep(1);

    socket.close();
  });

  if (!connectSuccess) {
    wsConnectFailRate.add(1);
    console.error("WebSocket connection failed");
  }

  // 5. Post-storm health check — verify the server is still responsive
  sleep(0.5);
  const healthRes = http.get(`${BASE_URL}/api/auth/csrf`, { timeout: "5s" });
  const healthy = check(healthRes, {
    "Server responsive after storm": (r) => r.status === 200,
  });
  healthCheckPass.add(healthy ? 1 : 0);

  sleep(0.5);
}

// ---------------------------------------------------------------------------
// Teardown: Final health check after all VUs complete
// ---------------------------------------------------------------------------

export function teardown() {
  const healthRes = http.get(`${BASE_URL}/api/auth/csrf`, { timeout: "10s" });
  const ok = check(healthRes, {
    "Server responsive after full storm (teardown)": (r) => r.status === 200,
  });

  if (!ok) {
    console.error(
      "CRITICAL: Server unresponsive after typing storm — " +
        "check Gateway logs for OOM or process crashes"
    );
  }

  // Log summary of typing throttle effectiveness.
  // With 50 VUs * 40 events = 2000 sent, only ~200-250 should be broadcast
  // (each VU gets throttled to 1 event per 2000ms window).
  console.log(
    "Typing storm complete. Check 'typing_events_sent' vs 'typing_events_received' " +
      "metrics to verify server-side throttle is working. " +
      "Expected ratio: received << sent (roughly 10:1 drop rate)."
  );
}
