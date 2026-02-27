"use client";

import { Socket } from "phoenix";

let socket: Socket | null = null;
let currentToken: string | null = null;

/**
 * Fetch a fresh JWT from the auth token endpoint.
 */
async function fetchToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/token");
    if (!res.ok) return null;
    const data = await res.json();
    return data.token || null;
  } catch {
    return null;
  }
}

/**
 * Get or create the singleton Phoenix Socket connection.
 * The socket automatically reconnects with a fresh JWT on disconnect.
 */
export async function getSocket(): Promise<Socket | null> {
  if (typeof window === "undefined") return null;

  if (socket?.isConnected()) return socket;

  const token = await fetchToken();
  if (!token) return null;
  currentToken = token;

  const configuredGatewayUrl =
    process.env.NEXT_PUBLIC_GATEWAY_URL || "ws://localhost:4001/socket";
  // Phoenix Socket appends "/websocket" internally.
  const gatewayUrl = configuredGatewayUrl.replace(/\/websocket\/?$/, "");

  socket = new Socket(gatewayUrl, {
    params: () => ({ token: currentToken }),
    reconnectAfterMs: (tries: number) =>
      [1000, 2000, 5000, 10000][Math.min(tries - 1, 3)],
  });

  // Refresh token before reconnection attempts
  socket.onOpen(() => {
    console.log("[Socket] Connected to Gateway");
  });

  socket.onError(async () => {
    // Try refreshing the token on error (may be expired)
    const newToken = await fetchToken();
    if (newToken) {
      currentToken = newToken;
    }
  });

  socket.connect();
  return socket;
}

/**
 * Disconnect the socket and clean up.
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentToken = null;
  }
}
