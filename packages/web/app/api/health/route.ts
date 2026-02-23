import { NextResponse } from "next/server";
import type { HealthResponse } from "@hivechat/shared";

export async function GET() {
  const response: HealthResponse = {
    status: "ok",
    service: "web",
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
