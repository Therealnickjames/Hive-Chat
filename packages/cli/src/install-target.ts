export type InstallTarget = {
  platform: "darwin" | "linux" | "windows";
  arch: "amd64" | "arm64";
  binaryName: string;
  archiveName: string;
  downloadName: string;
  extractedName: string;
};

export function detectInstallTarget(
  platform: NodeJS.Platform | string,
  arch: NodeJS.Architecture | string,
): InstallTarget {
  const normalizedArch = normalizeArch(platform, arch);

  switch (platform) {
    case "darwin":
      return {
        platform: "darwin",
        arch: normalizedArch,
        binaryName: "tavok",
        archiveName: `tavok-darwin-${normalizedArch}.tar.gz`,
        downloadName: `tavok-darwin-${normalizedArch}`,
        extractedName: "tavok",
      };
    case "linux":
      return {
        platform: "linux",
        arch: normalizedArch,
        binaryName: "tavok",
        archiveName: `tavok-linux-${normalizedArch}.tar.gz`,
        downloadName: `tavok-linux-${normalizedArch}`,
        extractedName: "tavok",
      };
    case "win32":
      return {
        platform: "windows",
        arch: normalizedArch,
        binaryName: "tavok.exe",
        archiveName: `tavok-windows-${normalizedArch}.zip`,
        downloadName: `tavok-windows-${normalizedArch}.exe`,
        extractedName: "tavok.exe",
      };
    default:
      throw unsupportedTarget(platform, arch);
  }
}

function normalizeArch(platform: string, arch: string): "amd64" | "arm64" {
  switch (arch) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    default:
      throw unsupportedTarget(platform, arch);
  }
}

function unsupportedTarget(platform: string, arch: string): Error {
  return new Error(`Unsupported platform/architecture: ${platform}/${arch}`);
}
