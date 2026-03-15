import { NextResponse } from "next/server";

/**
 * GET /api/metrics — Prometheus-format metrics for the Web service.
 *
 * Exports basic process and application metrics. Protected by
 * INTERNAL_API_SECRET to prevent public scraping.
 */

let requestCount = 0;
let errorCount = 0;

export function incrementRequestCount() {
  requestCount++;
}

export function incrementErrorCount() {
  errorCount++;
}

export async function GET(request: Request) {
  const secret = request.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_API_SECRET;
  if (expected && secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const mem = process.memoryUsage();
  const uptime = process.uptime();

  const lines = [
    "# HELP tavok_web_uptime_seconds Web service uptime",
    "# TYPE tavok_web_uptime_seconds gauge",
    `tavok_web_uptime_seconds ${uptime.toFixed(0)}`,
    "",
    "# HELP tavok_web_memory_heap_bytes Heap memory usage in bytes",
    "# TYPE tavok_web_memory_heap_bytes gauge",
    `tavok_web_memory_heap_bytes ${mem.heapUsed}`,
    "",
    "# HELP tavok_web_memory_rss_bytes RSS memory in bytes",
    "# TYPE tavok_web_memory_rss_bytes gauge",
    `tavok_web_memory_rss_bytes ${mem.rss}`,
    "",
    "# HELP tavok_web_requests_total Total API requests served",
    "# TYPE tavok_web_requests_total counter",
    `tavok_web_requests_total ${requestCount}`,
    "",
    "# HELP tavok_web_errors_total Total API errors",
    "# TYPE tavok_web_errors_total counter",
    `tavok_web_errors_total ${errorCount}`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
