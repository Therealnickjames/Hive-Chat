/**
 * k6 Soak Test — Sustained load over time to detect memory leaks and degradation.
 *
 * Usage: k6 run tests/load/k6-soak.js
 *
 * Prerequisites:
 *   - Services running (make up)
 *   - Test user registered (demo@tavok.ai / DemoPass123!)
 *
 * Duration: 10 minutes at steady 10 VUs
 * Watches for: latency degradation, error rate increase, memory growth
 */

import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";

// Custom metrics
const msgLatency = new Trend("msg_delivery_latency", true);
const wsConnectTime = new Trend("ws_connect_time", true);
const errorRate = new Rate("error_rate");
const healthCheckFails = new Counter("health_check_fails");
const messagesSent = new Counter("messages_sent");

export const options = {
  stages: [
    { duration: "30s", target: 5 },   // Ramp up
    { duration: "9m", target: 10 },    // Sustain
    { duration: "30s", target: 0 },    // Ramp down
  ],
  thresholds: {
    msg_delivery_latency: ["p(95)<2000"],    // p95 message delivery < 2s
    ws_connect_time: ["p(95)<3000"],          // p95 WS connect < 3s
    error_rate: ["rate<0.05"],                // Error rate < 5%
    health_check_fails: ["count<10"],         // Max 10 health check failures
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:5555";
const WS_URL = __ENV.WS_URL || "ws://localhost:4001";

function login() {
  // Get CSRF
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf`);
  if (csrfRes.status !== 200) return null;

  const csrfToken = JSON.parse(csrfRes.body).csrfToken;
  const cookies = csrfRes.cookies;

  // Login
  const jar = http.cookieJar();
  for (const [name, vals] of Object.entries(cookies)) {
    for (const v of vals) {
      jar.set(BASE_URL, name, v.value);
    }
  }

  const authRes = http.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    { email: "demo@tavok.ai", password: "DemoPass123!", csrfToken, json: "true" },
    { redirects: 0 }
  );

  return authRes.status === 200 || authRes.status === 302;
}

function healthCheck() {
  const checks = [
    http.get(`${BASE_URL}/api/health`),
    http.get("http://localhost:4001/api/health"),
    http.get("http://localhost:4002/health"),
  ];

  for (const res of checks) {
    if (res.status !== 200) {
      healthCheckFails.add(1);
      return false;
    }
  }
  return true;
}

export default function () {
  const iteration = __ITER;

  // Health check every 10 iterations
  if (iteration % 10 === 0) {
    healthCheck();
  }

  // Login
  const loggedIn = login();
  errorRate.add(!loggedIn);
  if (!loggedIn) {
    sleep(2);
    return;
  }

  // Discover a server and channel
  const serversRes = http.get(`${BASE_URL}/api/servers`);
  if (serversRes.status !== 200 || !serversRes.body) {
    errorRate.add(true);
    sleep(1);
    return;
  }

  let servers;
  try {
    servers = JSON.parse(serversRes.body);
  } catch {
    errorRate.add(true);
    sleep(1);
    return;
  }

  if (!servers.length) {
    sleep(1);
    return;
  }

  const server = servers[0];

  // Get channels
  const channelsRes = http.get(`${BASE_URL}/api/servers/${server.id}/channels`);
  if (channelsRes.status !== 200) {
    errorRate.add(true);
    sleep(1);
    return;
  }

  let channels;
  try {
    channels = JSON.parse(channelsRes.body);
  } catch {
    errorRate.add(true);
    sleep(1);
    return;
  }

  if (!channels.length) {
    sleep(1);
    return;
  }

  const channel = channels[0];

  // WebSocket phase — connect, send message, wait for ack
  const wsStart = Date.now();

  const wsRes = ws.connect(
    `${WS_URL}/socket/websocket?vsn=1.0.0`,
    {},
    function (socket) {
      const connectTime = Date.now() - wsStart;
      wsConnectTime.add(connectTime);

      // Join channel
      socket.send(
        JSON.stringify([null, null, `room:${channel.id}`, "phx_join", {}])
      );

      socket.on("message", function (msg) {
        // Message received — measure delivery
        try {
          const parsed = JSON.parse(msg);
          if (parsed[3] === "message_new") {
            msgLatency.add(Date.now() - wsStart);
          }
        } catch {
          // Ignore parse errors on heartbeats etc
        }
      });

      // Send a message
      sleep(0.5);
      const sendTime = Date.now();
      socket.send(
        JSON.stringify([
          null,
          null,
          `room:${channel.id}`,
          "new_message",
          { content: `soak-test-${__VU}-${iteration}` },
        ])
      );
      messagesSent.add(1);

      // Wait for delivery
      sleep(2);
      socket.close();
    }
  );

  check(wsRes, {
    "WebSocket connected": (r) => r && r.status === 101,
  });

  errorRate.add(!wsRes || wsRes.status !== 101);

  // Brief pause between iterations
  sleep(1);
}

export function handleSummary(data) {
  const p95Latency = data.metrics.msg_delivery_latency
    ? data.metrics.msg_delivery_latency.values["p(95)"]
    : "N/A";
  const errRate = data.metrics.error_rate
    ? (data.metrics.error_rate.values.rate * 100).toFixed(1)
    : "N/A";
  const totalMsgs = data.metrics.messages_sent
    ? data.metrics.messages_sent.values.count
    : 0;

  console.log("\n=== SOAK TEST SUMMARY ===");
  console.log(`Duration: 10 minutes`);
  console.log(`Messages sent: ${totalMsgs}`);
  console.log(`p95 delivery latency: ${p95Latency}ms`);
  console.log(`Error rate: ${errRate}%`);
  console.log(`Health check failures: ${data.metrics.health_check_fails ? data.metrics.health_check_fails.values.count : 0}`);
  console.log("========================\n");

  return {};
}
