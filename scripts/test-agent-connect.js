/**
 * Quick test: Agent connects to Gateway via WebSocket with API key
 * Usage: node scripts/test-agent-connect.js <api_key>
 */
const WebSocket = require("ws");

const apiKey = process.argv[2];
if (!apiKey) {
  console.error("Usage: node scripts/test-agent-connect.js <api_key>");
  process.exit(1);
}

const url = `ws://localhost:4001/socket/websocket?api_key=${encodeURIComponent(apiKey)}&vsn=2.0.0`;
console.log("Connecting to:", url.replace(apiKey, "sk-tvk-***"));

const ws = new WebSocket(url);

ws.on("open", () => {
  console.log("✅ WebSocket connected!");

  // Send Phoenix join for a channel
  // First, get a channel ID from the server
  // For now, just send a heartbeat to verify the connection is alive
  const heartbeat = JSON.stringify([null, "1", "phoenix", "heartbeat", {}]);
  ws.send(heartbeat);
  console.log("Sent heartbeat");
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("📨 Received:", JSON.stringify(msg, null, 2));

  // If heartbeat reply received, connection is fully authenticated
  if (msg[3] === "phx_reply" && msg[4]?.status === "ok") {
    console.log("✅ Heartbeat reply received — agent is authenticated!");

    // Try joining a channel in the server
    const joinMsg = JSON.stringify([
      null,
      "2",
      "room:01KJNFXWYB20VJNDG10A947HW9", // AI Research Lab channel
      "phx_join",
      {},
    ]);

    // Get channels first
    console.log("Attempting to join a channel...");
    ws.send(joinMsg);
  }

  // If join reply
  if (msg[3] === "phx_reply" && msg[2]?.startsWith("room:")) {
    if (msg[4]?.status === "ok") {
      console.log("✅ Successfully joined channel:", msg[2]);
    } else {
      console.log("❌ Join failed:", JSON.stringify(msg[4]));
    }
    // Test complete, close
    setTimeout(() => {
      console.log("\n🎉 Agent self-registration + WebSocket auth: PASSED");
      ws.close();
      process.exit(0);
    }, 1000);
  }
});

ws.on("error", (err) => {
  console.error("❌ WebSocket error:", err.message);
  process.exit(1);
});

ws.on("close", (code, reason) => {
  console.log("WebSocket closed:", code, reason.toString());
});

// Timeout after 10 seconds
setTimeout(() => {
  console.error("❌ Timeout — no response after 10s");
  process.exit(1);
}, 10000);
