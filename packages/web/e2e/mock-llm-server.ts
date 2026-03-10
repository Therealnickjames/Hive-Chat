/**
 * Mock OpenAI-compatible SSE server for E2E streaming tests.
 *
 * Speaks the OpenAI Chat Completions protocol:
 *   POST /v1/chat/completions → SSE stream of tokens
 *   GET  /health              → { status: "ok" }
 *
 * Behavior:
 *   - Echoes the last user message word-by-word (100ms delay per token)
 *   - "ERROR_TEST" trigger → HTTP 500
 *   - "SLOW_TEST" trigger  → 500ms delay between tokens
 *
 * Zero dependencies — uses only Node.js built-in `http` module.
 */

import * as http from "http";

let server: http.Server | null = null;

export function startMockLLM(port = 9999): Promise<void> {
  if (server) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const s = http.createServer(async (req, res) => {
      // CORS headers for safety
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      // Chat completions
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const payload = JSON.parse(body);
            const messages: Array<{ role: string; content: string }> =
              payload.messages || [];

            // Find last user message
            const lastUserMsg = [...messages]
              .reverse()
              .find((m) => m.role === "user");
            const userContent = lastUserMsg?.content || "Hello";

            // Error trigger
            if (userContent.includes("ERROR_TEST")) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: {
                    message: "Mock error for testing",
                    type: "server_error",
                  },
                }),
              );
              return;
            }

            const delayMs = userContent.includes("SLOW_TEST") ? 500 : 100;

            // Stream response as SSE
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });

            const echoPrefix = "[echo] ";
            const words = userContent.split(/\s+/);
            const tokens = [
              echoPrefix,
              ...words.map((w, i) => (i > 0 ? " " + w : w)),
            ];

            for (const token of tokens) {
              const chunk = {
                id: `chatcmpl-mock-${Date.now()}`,
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: 0,
                    delta: { content: token },
                    finish_reason: null,
                  },
                ],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              await sleep(delayMs);
            }

            // Send finish_reason: stop
            const stopChunk = {
              id: `chatcmpl-mock-${Date.now()}`,
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            };
            res.write(`data: ${JSON.stringify(stopChunk)}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Bad request" } }));
          }
        });
        return;
      }

      // 404 fallback
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    s.listen(port, "0.0.0.0", () => {
      server = s;
      console.log(`[mock-llm] Listening on http://0.0.0.0:${port}`);
      resolve();
    });

    s.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        // Port already in use — another test probably started it
        console.log(
          `[mock-llm] Port ${port} already in use, assuming another instance is running`,
        );
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

export function stopMockLLM(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      server = null;
      resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Allow running standalone: npx ts-node packages/web/e2e/mock-llm-server.ts
if (require.main === module) {
  startMockLLM().then(() => console.log("[mock-llm] Ready"));
}
