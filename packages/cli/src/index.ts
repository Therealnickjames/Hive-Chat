import { readFileSync } from "node:fs";
import path from "node:path";

import { detectInstallTarget } from "./install-target";
import { ensureBinary, runBinary } from "./runner";

async function main(): Promise<void> {
  const packageVersion = readPackageVersion();
  const target = detectInstallTarget(process.platform, process.arch);
  const binaryPath = await ensureBinary(packageVersion, target);
  const exitCode = await runBinary(binaryPath, process.argv.slice(2));
  process.exitCode = exitCode;
}

function readPackageVersion(): string {
  const packagePath = path.resolve(__dirname, "../package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
    version: string;
  };
  return packageJson.version;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`tavok: ${message}`);
  process.exitCode = 1;
});
