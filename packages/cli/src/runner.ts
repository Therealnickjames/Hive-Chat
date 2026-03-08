import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, rename, unlink } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

import type { InstallTarget } from "./install-target";

const DEFAULT_RELEASE_BASE =
  "https://github.com/TavokAI/Tavok/releases/download";

type EnvLike = NodeJS.ProcessEnv & {
  TAVOK_CLI_CACHE_DIR?: string;
  TAVOK_RELEASE_BASE_URL?: string;
};

export function getReleaseBaseUrl(
  version: string,
  env: EnvLike = process.env,
): string {
  if (env.TAVOK_RELEASE_BASE_URL) {
    return env.TAVOK_RELEASE_BASE_URL;
  }

  return `${DEFAULT_RELEASE_BASE}/v${trimVersionPrefix(version)}`;
}

export function getBinaryDownloadUrl(
  version: string,
  target: InstallTarget,
  env: EnvLike = process.env,
): string {
  return `${getReleaseBaseUrl(version, env)}/${target.downloadName}`;
}

export function getCacheBinaryPath(
  cacheRoot: string,
  version: string,
  target: InstallTarget,
): string {
  return path.join(cacheRoot, trimVersionPrefix(version), target.binaryName);
}

export async function ensureBinary(
  version: string,
  target: InstallTarget,
  env: EnvLike = process.env,
): Promise<string> {
  const cacheRoot = getCacheRoot(env);
  const binaryPath = getCacheBinaryPath(cacheRoot, version, target);

  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  await mkdir(path.dirname(binaryPath), { recursive: true });

  const tempPath = `${binaryPath}.download`;
  try {
    await downloadFile(getBinaryDownloadUrl(version, target, env), tempPath);
    if (target.platform !== "windows") {
      await chmod(tempPath, 0o755);
    }
    await rename(tempPath, binaryPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }

  return binaryPath;
}

export async function runBinary(
  binaryPath: string,
  args: string[],
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function getCacheRoot(env: EnvLike): string {
  if (env.TAVOK_CLI_CACHE_DIR) {
    return env.TAVOK_CLI_CACHE_DIR;
  }

  if (process.platform === "win32") {
    return path.join(
      env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "Tavok",
      "cli",
    );
  }

  return path.join(
    env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
    "tavok",
  );
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await request(url);

  if (response.statusCode && response.statusCode >= 400) {
    response.resume();
    throw new Error(
      `Failed to download Tavok CLI: ${response.statusCode} ${response.statusMessage ?? ""}`.trim(),
    );
  }

  await pipeline(response, createWriteStream(destination));
}

function request(
  url: string,
  redirects = 3,
): Promise<import("node:http").IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, (response) => {
        const statusCode = response.statusCode ?? 0;
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location &&
          redirects > 0
        ) {
          response.resume();
          resolve(request(response.headers.location, redirects - 1));
          return;
        }

        resolve(response);
      })
      .on("error", reject);

    req.setTimeout(30_000, () => {
      req.destroy(new Error("Request timed out after 30 seconds"));
    });
  });
}

function trimVersionPrefix(version: string): string {
  return version.replace(/^v/, "");
}
