/**
 * k6-messaging.js — Messaging flow load test for Tavok
 *
 * Tests the full user journey: authenticate, discover servers/channels,
 * connect to the Phoenix WebSocket, join a channel, and send messages.
 *
 * Stages: Ramp 0 -> 5 -> 20 -> 0 VUs over 50s (suitable for local testing)
 *
 * Run:
 *   k6 run tests/load/k6-messaging.js
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

const httpReqDuration = new Trend("http_req_duration_custom", true);
const wsConnectDuration = new Trend("ws_connect_duration", true);
const msgDeliveryDuration = new Trend("msg_delivery_duration", true);
const messagesSent = new Counter("messages_sent");
const messagesAcked = new Counter("messages_acked");
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

const MESSAGES_PER_VU = 5;
const MESSAGE_INTERVAL_MS = 500;

export const options = {
  stages: [
    { duration: "10s", target: 5 },
    { duration: "20s", target: 20 },
    { duration: "10s", target: 20 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration_custom: ["p(95)<2000"],
    ws_connect_duration: ["p(95)<3000"],
    msg_delivery_duration: ["p(95)<1000"],
    ws_connect_fail_rate: ["rate<0.1"],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Authenticate via NextAuth credentials callback.
 * Returns the cookie jar with a valid session cookie.
 */
function authenticate() {
  const jar = http.cookieJar();

  // Step 1: GET the CSRF token from the NextAuth signin page.
  // NextAuth sets a __Host-next-auth.csrf-token (or next-auth.csrf-token) cookie.
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf`, {
    redirects: 0,
    jar,
  });

  const csrfCheck = check(csrfRes, {
    "CSRF endpoint returns 200": (r) => r.status === 200,
  });

  if (!csrfCheck) {
    fail(`CSRF fetch failed: status=${csrfRes.status} body=${csrfRes.body}`);
  }

  let csrfToken = "";
  try {
    const csrfBody = JSON.parse(csrfRes.body);
    csrfToken = csrfBody.csrfToken || "";
  } catch (_) {
    fail("Failed to parse CSRF response");
  }

  // Step 2: POST credentials to the NextAuth callback endpoint.
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

  // NextAuth redirects on success (302) or returns 200 with error on failure.
  const loginOk = check(loginRes, {
    "Login returns 200 or 302": (r) => r.status === 200 || r.status === 302,
  });

  if (!loginOk) {
    fail(`Login failed: status=${loginRes.status} body=${loginRes.body}`);
  }

  // If we got a redirect, follow it to establish the session cookie.
  if (loginRes.status === 302) {
    const location = loginRes.headers["Location"] || loginRes.headers["location"];
    if (location) {
      const redirectUrl = location.startsWith("http")
        ? location
        : `${BASE_URL}${location}`;
      http.get(redirectUrl, { jar, redirects: 5 });
    }
  }

  return jar;
}

/**
 * Fetch a Gateway-compatible JWT using the session cookie.
 */
function getJwt(jar) {
  const start = Date.now();
  const tokenRes = http.get(`${BASE_URL}/api/auth/token`, { jar });
  httpReqDuration.add(Date.now() - start);

  const tokenCheck = check(tokenRes, {
    "Token endpoint returns 200": (r) => r.status === 200,
    "Token response has token field": (r) => {
      try {
        return !!JSON.parse(r.body).token;
      } catch (_) {
        return false;
      }
    },
  });

  if (!tokenCheck) {
    fail(`Token fetch failed: status=${tokenRes.status} body=${tokenRes.body}`);
  }

  return JSON.parse(tokenRes.body).token;
}

/**
 * List servers the authenticated user belongs to.
 */
function listServers(jar) {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/api/servers`, { jar });
  httpReqDuration.add(Date.now() - start);

  check(res, {
    "Servers list returns 200": (r) => r.status === 200,
  });

  try {
    const body = JSON.parse(res.body);
    return body.servers || [];
  } catch (_) {
    return [];
  }
}

/**
 * List channels for a given server.
 */
function listChannels(jar, serverId) {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/api/servers/${serverId}/channels`, { jar });
  httpReqDuration.add(Date.now() - start);

  check(res, {
    "Channels list returns 200": (r) => r.status === 200,
  });

  try {
    const body = JSON.parse(res.body);
    return body.channels || [];
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main VU scenario
// ---------------------------------------------------------------------------

export default function () {
  // 1. Authenticate and get JWT
  const jar = authenticate();
  const jwt = getJwt(jar);

  // 2. Discover servers and channels via REST API
  const servers = listServers(jar);
  if (servers.length === 0) {
    console.warn("No servers found for user — skipping WS test");
    sleep(1);
    return;
  }

  const server = servers[0];
  const channels = listChannels(jar, server.id);
  if (channels.length === 0) {
    console.warn(`No channels in server ${server.name} — skipping WS test`);
    sleep(1);
    return;
  }

  // Pick the first channel (usually #general)
  const channel = channels[0];
  const channelTopic = `room:${channel.id}`;

  // 3. Connect WebSocket to the Phoenix Gateway
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

    // Track pending message acks: ref -> send timestamp
    const pendingAcks = {};

    socket.on("message", function (rawMsg) {
      try {
        const msg = JSON.parse(rawMsg);
        // Phoenix vsn 2.0.0 format: [join_ref, ref, topic, event, payload]
        if (!Array.isArray(msg) || msg.length < 5) return;

        const [, msgRef, , event, payload] = msg;

        if (event === "phx_reply") {
          // Check if this is an ack for one of our sent messages
          if (pendingAcks[msgRef]) {
            const latency = Date.now() - pendingAcks[msgRef];
            msgDeliveryDuration.add(latency);
            messagesAcked.add(1);
            delete pendingAcks[msgRef];

            check(payload, {
              "Message ack status is ok": (p) =>
                p && p.status === "ok",
            });
          }
        }
      } catch (_) {
        // Non-JSON message or parse error — ignore
      }
    });

    socket.on("error", function (e) {
      console.error(`WebSocket error: ${e}`);
    });

    // 4. Join the channel
    const joinRef = nextRef();
    const joinPayload = JSON.stringify([
      joinRef,
      joinRef,
      channelTopic,
      "phx_join",
      {},
    ]);
    socket.send(joinPayload);

    // Wait briefly for the join to complete
    sleep(0.5);

    // 5. Send messages with spacing
    for (let i = 0; i < MESSAGES_PER_VU; i++) {
      const ref = nextRef();
      const content = `k6 load test message ${i + 1} from VU ${__VU} at ${new Date().toISOString()}`;
      const msgPayload = JSON.stringify([
        null,
        ref,
        channelTopic,
        "new_message",
        { content: content },
      ]);

      pendingAcks[ref] = Date.now();
      socket.send(msgPayload);
      messagesSent.add(1);

      sleep(MESSAGE_INTERVAL_MS / 1000);
    }

    // 6. Send a heartbeat to keep connection alive during ack wait
    const hbRef = nextRef();
    socket.send(
      JSON.stringify([null, hbRef, "phoenix", "heartbeat", {}])
    );

    // Wait for remaining acks
    sleep(2);

    socket.close();
  });

  // If ws.connect itself failed (res is the http upgrade response)
  if (!connectSuccess) {
    wsConnectFailRate.add(1);
    console.error("WebSocket connection failed");
  }

  // Small cooldown between iterations
  sleep(1);
}
