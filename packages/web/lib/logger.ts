/**
 * Structured JSON logger for the Web service.
 *
 * Outputs JSON to stdout/stderr — compatible with Docker log drivers,
 * CloudWatch, Datadog, and `docker logs | jq`.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("message persisted", { messageId, channelId });
 *   logger.error("broadcast failed", { error: err.message, requestId });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  msg: string;
  service: string;
  ts: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    msg,
    service: "web",
    ts: new Date().toISOString(),
    ...fields,
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) =>
    emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) =>
    emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    emit("error", msg, fields),
};
