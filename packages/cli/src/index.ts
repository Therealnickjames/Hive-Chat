import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { detectInstallTarget } from "./install-target";
import { ensureBinary, runBinary } from "./runner";

function checkDocker(): void {
  let dockerOK = true;

  try {
    execSync("docker --version", { stdio: "ignore" });
  } catch {
    dockerOK = false;
    console.error("⚠ Docker not found.");
    if (process.platform === "darwin") {
      console.error("  Install: brew install --cask docker");
      console.error(
        "      or: https://docs.docker.com/desktop/install/mac-install/",
      );
    } else if (process.platform === "win32") {
      console.error(
        "  Install: https://docs.docker.com/desktop/install/windows-install/",
      );
    } else {
      console.error("  Install: https://docs.docker.com/engine/install/");
    }
    console.error("");
  }

  if (dockerOK) {
    try {
      execSync("docker compose version", { stdio: "ignore" });
    } catch {
      console.error("⚠ docker compose (v2) not found.");
      console.error(
        "  Docker Compose v2 ships with Docker Desktop and recent Docker Engine.",
      );
      console.error("  See: https://docs.docker.com/compose/install/");
      console.error("");
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Pre-flight: if running "init", check Docker first, then check checkout
  if (args[0] === "init") {
    checkDocker();

    if (!existsSync("docker-compose.yml")) {
      const domainIdx = args.indexOf("--domain");
      const domain =
        domainIdx !== -1 && args[domainIdx + 1]
          ? args[domainIdx + 1]
          : "localhost";

      console.error(
        "ERROR: docker-compose.yml not found in the current directory.\n" +
          "\n" +
          "tavok init generates .env but must be run inside a Tavok checkout.\n" +
          "Clone the repo first, then use the setup script:\n" +
          "\n" +
          "  git clone https://github.com/TavokAI/Tavok.git\n" +
          "  cd Tavok\n" +
          `  ./scripts/setup.sh --domain ${domain}\n` +
          "  docker compose up -d\n",
      );
      process.exitCode = 1;
      return;
    }
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
