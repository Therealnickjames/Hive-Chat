import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { detectInstallTarget } from "./install-target";
import { ensureBinary, runBinary } from "./runner";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Pre-flight: if running "init" without a Tavok checkout, fail fast
  // before downloading the binary
  if (args[0] === "init" && !existsSync("docker-compose.yml")) {
    const domainIdx = args.indexOf("--domain");
    const domain =
      domainIdx !== -1 && args[domainIdx + 1] ? args[domainIdx + 1] : "localhost";

    console.error(
      "ERROR: docker-compose.yml not found in the current directory.\n" +
        "\n" +
        "tavok init generates .env but must be run inside a Tavok checkout.\n" +
        "Clone the repo first:\n" +
        "\n" +
        "  git clone https://github.com/TavokAI/Tavok.git\n" +
        "  cd Tavok\n" +
        `  tavok init --domain ${domain}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const packageVersion = readPackageVersion();
  const target = detectInstallTarget(process.platform, process.arch);
  const binaryPath = await ensureBinary(packageVersion, target);
  const exitCode = await runBinary(binaryPath, args);
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
