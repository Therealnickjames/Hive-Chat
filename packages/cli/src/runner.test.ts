import path from "node:path";

import { describe, expect, it } from "vitest";

import { detectInstallTarget } from "./install-target";
import {
  getBinaryDownloadUrl,
  getCacheBinaryPath,
  getReleaseBaseUrl,
} from "./runner";

describe("runner helpers", () => {
  it("builds the default GitHub release URL from the package version", () => {
    expect(getReleaseBaseUrl("0.1.0")).toBe(
      "https://github.com/TavokAI/Tavok/releases/download/v0.1.0",
    );
  });

  it("allows overriding the release base URL", () => {
    expect(
      getReleaseBaseUrl("0.1.0", {
        TAVOK_RELEASE_BASE_URL: "https://downloads.example.com/tavok",
      }),
    ).toBe("https://downloads.example.com/tavok");
  });

  it("builds the binary download URL for the current target", () => {
    const target = detectInstallTarget("darwin", "arm64");

    expect(getBinaryDownloadUrl("0.1.0", target)).toBe(
      "https://github.com/TavokAI/Tavok/releases/download/v0.1.0/tavok-darwin-arm64",
    );
  });

  it("uses a versioned cache path", () => {
    const target = detectInstallTarget("win32", "x64");

    expect(getCacheBinaryPath("C:\\cache", "0.1.0", target)).toBe(
      path.join("C:\\cache", "0.1.0", "tavok.exe"),
    );
  });
});
