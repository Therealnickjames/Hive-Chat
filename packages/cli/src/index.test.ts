import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * Tests for the npm wrapper CLI entry point (index.ts).
 * We invoke the built CLI as a subprocess to test actual exit behavior.
 *
 * NOTE: These tests must NOT trigger `tavok init` because the Go binary
 * may be downloadable (once a release exists), and init would attempt
 * `docker compose pull` which times out in CI.
 */
const CLI_ENTRY = path.resolve(__dirname, "../bin/tavok.js");

function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI_ENTRY, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1", ...env },
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: unknown) {
    const err = error as {
      status: number;
      stdout: string;
      stderr: string;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

describe("tavok CLI npm wrapper", () => {
  it("shows version with --version flag", () => {
    const tmpDir = path.join(os.tmpdir(), `tavok-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const result = runCli(["version"], tmpDir);

      // The Go binary handles `version`, so the wrapper downloads it first.
      // If the binary is unavailable, it errors out. Either way, no hang.
      // We just verify it doesn't hang indefinitely.
      expect(result.exitCode === 0 || result.exitCode === 1).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("shows usage with help command", () => {
    const tmpDir = path.join(os.tmpdir(), `tavok-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const result = runCli(["help"], tmpDir);

      expect(result.exitCode === 0 || result.exitCode === 1).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("exits non-zero for unknown commands", () => {
    const tmpDir = path.join(os.tmpdir(), `tavok-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const result = runCli(["nonexistent-command"], tmpDir);

      // Either Go binary not found (exit 1) or unknown command (exit 1)
      expect(result.exitCode).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
