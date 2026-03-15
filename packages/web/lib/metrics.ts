/**
 * Simple in-process counters for Prometheus /api/metrics endpoint.
 *
 * Import and call incrementRequestCount() / incrementErrorCount() from
 * middleware or API routes. The /api/metrics route reads the values.
 */

let requestCount = 0;
let errorCount = 0;

export function incrementRequestCount() {
  requestCount++;
}

export function incrementErrorCount() {
  errorCount++;
}

export function getRequestCount(): number {
  return requestCount;
}

export function getErrorCount(): number {
  return errorCount;
}
