import { NextResponse } from "next/server";
import { Socket } from "net";
import { prisma } from "@/lib/db";
import { getRedisHealthStatus } from "@/lib/api-safety";

export async function GET() {
  const checks: Record<string, { status: "ok" | "unhealthy" }> = {
    database: { status: "ok" },
    redis: { status: "ok" },
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error("Health check failed: database", error);
    checks.database.status = "unhealthy";
  }

  checks.redis.status = await getRedisHealthStatus(
    process.env.REDIS_URL,
    checkRedisHealth,
  );

  const isHealthy = Object.values(checks).every(
    (check) => check.status === "ok",
  );

  const response = {
    status: isHealthy ? "ok" : "degraded",
    service: "web",
    timestamp: new Date().toISOString(),
    checks,
  } as const;

  return NextResponse.json(response, {
    status: isHealthy ? 200 : 503,
  });
}

function checkRedisHealth(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const socket = new Socket();

    socket.setTimeout(1000);
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };

    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));

    socket.connect(Number(parsed.port || 6379), parsed.hostname || "localhost");
  });
}
