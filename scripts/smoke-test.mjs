#!/usr/bin/env node
/**
 * Tavok Smoke Test
 *
 * Exercises every major user journey against a running instance.
 * Zero external dependencies — just Node 20+ fetch.
 *
 * Usage:
 *   node scripts/smoke-test.mjs                     # default: http://localhost:3000
 *   node scripts/smoke-test.mjs https://my.tavok.ai # custom base URL
 *
 * Exit code 0 = all passed, 1 = failures.
 */

const BASE = process.argv[2] || "http://localhost:3000";
const RUN = Date.now().toString(36); // unique suffix per run

// ─── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m\u2713\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message || String(e) });
    console.log(`  \x1b[31m\u2717\x1b[0m ${name}`);
    console.log(`    ${e.message || e}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Read response body once, return { status, ok, data (parsed JSON or text) }. */
async function readRes(res) {
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

/** Authenticated fetch — injects session cookie, follows redirects. */
function authed(cookie) {
  return (path, opts = {}) =>
    fetch(`${BASE}${path}`, {
      ...opts,
      headers: { ...opts.headers, Cookie: cookie },
    });
}

/** Get a session cookie via NextAuth credentials flow. */
async function login(email, password) {
  // 1. CSRF token
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfCookie =
    csrfRes.headers.getSetCookie?.()?.find((c) =>
      c.startsWith("next-auth.csrf-token")
    ) || "";
  const { csrfToken } = await csrfRes.json();

  // 2. Credentials callback
  const authRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: csrfCookie,
    },
    body: new URLSearchParams({ email, password, csrfToken, json: "true" }),
    redirect: "manual",
  });

  // Collect all set-cookie headers
  const cookies = authRes.headers.getSetCookie?.() || [];
  const sessionCookie = cookies.find((c) =>
    c.startsWith("next-auth.session-token")
  );
  assert(sessionCookie, `Login failed for ${email} -- no session cookie`);

  // Build cookie header from all returned cookies
  const jar = [csrfCookie.split(";")[0]];
  for (const c of cookies) jar.push(c.split(";")[0]);
  return jar.join("; ");
}

// ─── State shared across tests ─────────────────────────────────────────────

const state = {};

// ─── Test suites ────────────────────────────────────────────────────────────

async function suiteRegistration() {
  console.log("\n\x1b[1mUser Registration\x1b[0m");

  await test("register user A", async () => {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `smoke-a-${RUN}@test.tavok.ai`,
        username: `smokea${RUN}`,
        displayName: `Smoke A ${RUN}`,
        password: "SmokePass123!",
      }),
    });
    const { status, data } = await readRes(res);
    assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(data)}`);
    state.userAEmail = `smoke-a-${RUN}@test.tavok.ai`;
  });

  await test("register user B", async () => {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `smoke-b-${RUN}@test.tavok.ai`,
        username: `smokeb${RUN}`,
        displayName: `Smoke B ${RUN}`,
        password: "SmokePass123!",
      }),
    });
    const { status, data } = await readRes(res);
    assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(data)}`);
    state.userBEmail = `smoke-b-${RUN}@test.tavok.ai`;
  });

  await test("login user A", async () => {
    state.cookieA = await login(state.userAEmail, "SmokePass123!");
    assert(state.cookieA, "no cookie");
  });

  await test("login user B", async () => {
    state.cookieB = await login(state.userBEmail, "SmokePass123!");
    assert(state.cookieB, "no cookie");
  });

  await test("reject duplicate registration", async () => {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: state.userAEmail,
        username: `smokea${RUN}`,
        displayName: "Dupe",
        password: "SmokePass123!",
      }),
    });
    assert(res.status === 400 || res.status === 409, `expected 4xx, got ${res.status}`);
  });
}

async function suiteServerAndChannels() {
  console.log("\n\x1b[1mServer & Channel Management\x1b[0m");
  const fetchA = authed(state.cookieA);

  await test("create server", async () => {
    const res = await fetchA("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Smoke Server ${RUN}` }),
    });
    const { status, data } = await readRes(res);
    assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(data)}`);
    state.serverId = data.id;
    state.defaultChannelId = data.defaultChannelId;
    assert(state.serverId, "no server ID returned");
  });

  await test("list servers shows new server", async () => {
    const res = await fetchA("/api/servers");
    const { data } = await readRes(res);
    const servers = Array.isArray(data) ? data : data.servers || [];
    const found = servers.some((s) => s.id === state.serverId);
    assert(found, "created server not in list");
  });

  await test("list channels (default channel created)", async () => {
    const res = await fetchA(`/api/servers/${state.serverId}/channels`);
    const { status, data } = await readRes(res);
    assert(status === 200, `status ${status}: ${JSON.stringify(data)}`);
    const channels = Array.isArray(data) ? data : data.channels || [];
    assert(channels.length >= 1, "expected at least 1 default channel");
    state.channelId = channels[0].id;
  });

  await test("create second channel", async () => {
    const res = await fetchA(`/api/servers/${state.serverId}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `smoke-${RUN}` }),
    });
    const { status, data } = await readRes(res);
    assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(data)}`);
    state.channel2Id = data.id;
    assert(state.channel2Id, "no channel ID");
  });
}

async function suiteInvites() {
  console.log("\n\x1b[1mInvite Flow\x1b[0m");
  if (!state.serverId) { await test("skip -- no server", async () => {}); return; }
  const fetchA = authed(state.cookieA);
  const fetchB = authed(state.cookieB);

  await test("create invite", async () => {
    const res = await fetchA(`/api/servers/${state.serverId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxUses: 5 }),
    });
    const { status, data } = await readRes(res);
    assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(data)}`);
    state.inviteCode = data.invite?.code || data.code;
    assert(state.inviteCode, `no invite code in: ${JSON.stringify(data)}`);
  });

  await test("user B accepts invite", async () => {
    if (!state.inviteCode) throw new Error("no invite code from previous test");
    const res = await fetchB(`/api/invites/${state.inviteCode}/accept`, {
      method: "POST",
    });
    const { status, data } = await readRes(res);
    assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(data)}`);
  });

  await test("user B sees server after join", async () => {
    const res = await fetchB("/api/servers");
    const { data } = await readRes(res);
    const servers = Array.isArray(data) ? data : data.servers || [];
    const found = servers.some((s) => s.id === state.serverId);
    assert(found, "server not in user B's list after invite accept");
  });
}

async function suiteDMs() {
  console.log("\n\x1b[1mDirect Messages\x1b[0m");
  if (!state.serverId) { await test("skip -- no server", async () => {}); return; }
  const fetchA = authed(state.cookieA);

  // Get user B's ID from server members
  await test("get user B's ID from members", async () => {
    const res = await fetchA(`/api/servers/${state.serverId}/members`);
    const { status, data } = await readRes(res);
    assert(status === 200, `status ${status}: ${JSON.stringify(data)}`);
    const members = Array.isArray(data) ? data : data.members || [];
    // members may have { userId, username } or nested { user: { ... } }
    const userB = members.find(
      (m) =>
        m.username === `smokeb${RUN}` ||
        m.user?.username === `smokeb${RUN}` ||
        m.displayName === `Smoke B ${RUN}`
    );
    assert(userB, `user B not found in ${members.length} members`);
    state.userBId = userB.userId || userB.user?.id || userB.id;
    assert(state.userBId, "could not extract user B ID");
  });

  await test("create DM channel", async () => {
    if (!state.userBId) throw new Error("no user B ID");
    const res = await fetchA("/api/dms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: state.userBId }),
    });
    const { status, data } = await readRes(res);
    assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(data)}`);
    state.dmId = data.dm?.id || data.id;
    assert(state.dmId, `no DM ID in: ${JSON.stringify(data)}`);
  });

  await test("list DMs includes new channel", async () => {
    if (!state.dmId) throw new Error("no DM ID");
    const res = await fetchA("/api/dms");
    const { data } = await readRes(res);
    const dms = Array.isArray(data) ? data : data.channels || data.dms || [];
    const found = dms.some((d) => d.id === state.dmId);
    assert(found, `DM ${state.dmId} not in list of ${dms.length} DMs`);
  });
}

async function suiteAgentRegistration() {
  console.log("\n\x1b[1mAgent Registration\x1b[0m");
  if (!state.serverId) { await test("skip -- no server", async () => {}); return; }
  const fetchA = authed(state.cookieA);

  await test("enable agent registration on server", async () => {
    const res = await fetchA(`/api/servers/${state.serverId}/agent-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowAgentRegistration: true }),
    });
    const { status, data } = await readRes(res);
    assert(status === 200, `status ${status}: ${JSON.stringify(data)}`);
    assert(data.allowAgentRegistration === true, "setting not applied");
  });

  await test("register agent", async () => {
    const res = await fetch(`${BASE}/api/v1/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId: state.serverId,
        displayName: `SmokeBot ${RUN}`,
        model: "smoke-test",
        capabilities: ["chat"],
        connectionMethod: "WEBSOCKET",
      }),
    });
    const { status, data } = await readRes(res);
    assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(data)}`);
    state.agentId = data.agentId;
    state.agentApiKey = data.apiKey;
    assert(state.agentId, `no agentId in: ${JSON.stringify(data)}`);
    assert(state.agentApiKey, `no apiKey in: ${JSON.stringify(data)}`);
  });

  await test("get agent details", async () => {
    if (!state.agentId) throw new Error("no agent ID");
    const res = await fetch(`${BASE}/api/v1/agents/${state.agentId}`, {
      headers: { Authorization: `Bearer ${state.agentApiKey}` },
    });
    const { status, data } = await readRes(res);
    assert(status === 200, `status ${status}: ${JSON.stringify(data)}`);
  });
}

async function suiteFileUpload() {
  console.log("\n\x1b[1mFile Upload\x1b[0m");

  await test("upload text file", async () => {
    const boundary = "----SmokeTest" + RUN;
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="smoke-test.txt"',
      "Content-Type: text/plain",
      "",
      `Smoke test content ${RUN}`,
      `--${boundary}--`,
    ].join("\r\n");

    const res = await fetch(`${BASE}/api/uploads`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Cookie: state.cookieA,
      },
      body,
    });
    const { status, data } = await readRes(res);
    assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(data)}`);
    state.fileId = data.fileId || data.id;
  });

  if (state.fileId) {
    await test("serve uploaded file", async () => {
      const res = await fetch(`${BASE}/api/uploads/${state.fileId}`);
      assert(res.ok, `status ${res.status}`);
    });
  }
}

async function suiteBreakTests() {
  console.log("\n\x1b[1mBreak Tests (edge cases & error handling)\x1b[0m");
  const fetchA = authed(state.cookieA);

  await test("reject empty server name", async () => {
    const res = await fetchA("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    assert(res.status >= 400, `expected 4xx, got ${res.status}`);
  });

  await test("reject invalid invite code", async () => {
    const res = await fetchA("/api/invites/DOESNOTEXIST/accept", { method: "POST" });
    assert(res.status >= 400, `expected 4xx, got ${res.status}`);
  });

  await test("reject unauthenticated server create", async () => {
    const res = await fetch(`${BASE}/api/servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
      redirect: "manual",
    });
    // Middleware redirects to /login (302/307) or API returns 401
    assert(
      res.status === 401 || res.status === 302 || res.status === 307 || res.status === 405,
      `expected auth rejection, got ${res.status}`
    );
  });

  await test("reject register with weak password", async () => {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `weak-${RUN}@test.tavok.ai`,
        username: `weak${RUN}`,
        displayName: "Weak",
        password: "123",
      }),
    });
    assert(res.status >= 400, `expected 4xx, got ${res.status}`);
  });

  await test("reject register with missing fields", async () => {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `partial-${RUN}@test.tavok.ai` }),
    });
    assert(res.status >= 400, `expected 4xx, got ${res.status}`);
  });

  await test("reject DM with nonexistent user", async () => {
    const res = await fetchA("/api/dms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "01NONEXISTENT00000000000000" }),
    });
    assert(res.status >= 400, `expected 4xx, got ${res.status}`);
  });

  await test("reject agent register with missing serverId", async () => {
    const res = await fetch(`${BASE}/api/v1/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Bad Agent", model: "test" }),
    });
    assert(res.status >= 400, `expected 4xx, got ${res.status}`);
  });

  await test("health endpoint returns 200", async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert(res.ok, `status ${res.status}`);
  });
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n\x1b[1;36mTavok Smoke Test\x1b[0m`);
  console.log(`Base: ${BASE}`);
  console.log(`Run:  ${RUN}`);

  // Verify service is up
  try {
    const health = await fetch(`${BASE}/api/health`);
    assert(health.ok, `health returned ${health.status}`);
  } catch (e) {
    console.error(
      `\n\x1b[31mCannot reach ${BASE}/api/health -- is the server running?\x1b[0m`
    );
    process.exit(1);
  }

  await suiteRegistration();
  await suiteServerAndChannels();
  await suiteInvites();
  await suiteDMs();
  await suiteAgentRegistration();
  await suiteFileUpload();
  await suiteBreakTests();

  // Summary
  console.log(`\n${"~".repeat(50)}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`\x1b[32m${passed}/${total} passed\x1b[0m`);
  } else {
    console.log(`\x1b[31m${failed} failed\x1b[0m, ${passed} passed (${total} total)`);
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
