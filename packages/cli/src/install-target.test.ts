import { describe, expect, it } from "vitest";

import { detectInstallTarget } from "./install-target";

describe("detectInstallTarget", () => {
  it("maps darwin arm64 to the release asset names", () => {
    expect(detectInstallTarget("darwin", "arm64")).toEqual({
      platform: "darwin",
      arch: "arm64",
      binaryName: "tavok",
      archiveName: "tavok-darwin-arm64.tar.gz",
      downloadName: "tavok-darwin-arm64",
      extractedName: "tavok",
    });
  });

  it("maps linux x64 to amd64 artifacts", () => {
    expect(detectInstallTarget("linux", "x64")).toEqual({
      platform: "linux",
      arch: "amd64",
      binaryName: "tavok",
      archiveName: "tavok-linux-amd64.tar.gz",
      downloadName: "tavok-linux-amd64",
      extractedName: "tavok",
    });
  });

  it("maps windows x64 to the exe asset", () => {
    expect(detectInstallTarget("win32", "x64")).toEqual({
      platform: "windows",
      arch: "amd64",
      binaryName: "tavok.exe",
      archiveName: "tavok-windows-amd64.zip",
      downloadName: "tavok-windows-amd64.exe",
      extractedName: "tavok.exe",
    });
  });

  it("rejects unsupported targets", () => {
    expect(() => detectInstallTarget("freebsd", "arm64")).toThrow(
      "Unsupported platform/architecture: freebsd/arm64",
    );
  });
});
