import { test, expect } from "@playwright/test";
import { execSync } from "child_process";

test.describe("Section 1: Infrastructure & Startup", () => {
  test("all Docker containers are running", () => {
    const output = execSync("docker compose ps --format json", {
      cwd:
        process.env.CLAUDE_PROJECT_DIR ||
        process.cwd().replace(/packages[/\\]web$/, ""),
      encoding: "utf-8",
      timeout: 10_000,
    });

    // docker compose ps --format json outputs one JSON object per line
    const containers = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    expect(containers.length).toBeGreaterThanOrEqual(4); // db, redis, web, gateway

    for (const c of containers) {
      expect(c.State, `Container ${c.Name} should be running`).toBe("running");
    }
  });

  test("web service responds at localhost:5555", async ({ request }) => {
    const res = await request.get("http://localhost:5555/api/health");
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.checks.database.status).toBe("ok");
    expect(data.checks.redis.status).toBe("ok");
  });

  test("gateway responds at localhost:4001", async ({ request }) => {
    const res = await request.get("http://localhost:4001/api/health");
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.checks.redis.status).toBe("ok");
  });

  test("no crash loops in recent logs", () => {
    const projectDir =
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd().replace(/packages[/\\]web$/, "");

    const logs = execSync("docker compose logs --tail=50 --no-color 2>&1", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 15_000,
    });

    // Check for crash-loop indicators (not general log levels like DB FATAL auth errors)
    const crashPatterns = [
      /restarting.*container/i,
      /OOMKilled/i,
      /exited with code [^0]/i,
      /panic:/, // Go panics (case-sensitive)
    ];

    for (const pattern of crashPatterns) {
      const match = logs.match(pattern);
      expect(match, `Found crash indicator in logs: ${match?.[0]}`).toBeNull();
    }
  });

  test.skip("stop and restart works cleanly", () => {
    // SKIPPED: Destructive — would kill the services Playwright is testing against.
    // Infrastructure stop/restart is validated by the regression harness.
  });
});
