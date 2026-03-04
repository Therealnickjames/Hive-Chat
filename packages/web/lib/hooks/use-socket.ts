"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "phoenix";
import { getSocket, disconnectSocket } from "@/lib/socket";

/**
 * Hook that manages the Phoenix Socket lifecycle.
 * Returns the socket instance and connection state.
 */
export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function connect() {
      const sock = await getSocket();
      if (!mountedRef.current) return;

      if (sock) {
        socketRef.current = sock;
        setIsConnected(sock.isConnected());

        // Track connection state changes
        sock.onOpen(() => {
          if (mountedRef.current) setIsConnected(true);
        });
        sock.onClose(() => {
          if (mountedRef.current) setIsConnected(false);
        });
      }
    }

    connect();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { socket: socketRef.current, isConnected };
}
