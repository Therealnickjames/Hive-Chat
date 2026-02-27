/**
 * Type declarations for the Phoenix JavaScript client library.
 * The phoenix npm package doesn't ship with TypeScript types.
 */
declare module "phoenix" {
  export type ConnectionState =
    | "connecting"
    | "open"
    | "closing"
    | "closed";

  export class Socket {
    constructor(
      endPoint: string,
      opts?: {
        params?: Record<string, unknown> | (() => Record<string, unknown>);
        transport?: unknown;
        timeout?: number;
        heartbeatIntervalMs?: number;
        longpollerTimeout?: number;
        reconnectAfterMs?: (tries: number) => number;
        logger?: (kind: string, msg: string, data: unknown) => void;
        encode?: (payload: unknown, callback: (result: string) => void) => void;
        decode?: (payload: string, callback: (result: unknown) => void) => void;
        vsn?: string;
      }
    );

    connect(): void;
    disconnect(callback?: () => void, code?: number, reason?: string): void;
    channel(topic: string, chanParams?: Record<string, unknown>): Channel;
    isConnected(): boolean;
    connectionState(): ConnectionState;
    onOpen(callback: () => void): number;
    onClose(callback: (event: unknown) => void): number;
    onError(callback: (error: unknown) => void): number;
    onMessage(callback: (message: unknown) => void): number;
  }

  export class Channel {
    constructor(topic: string, params?: Record<string, unknown>, socket?: Socket);

    join(timeout?: number): Push;
    leave(timeout?: number): Push;
    push(event: string, payload: Record<string, unknown>, timeout?: number): Push;
    on(event: string, callback: (payload: unknown) => void): number;
    off(event: string, ref?: number): void;
    onClose(callback: (payload: unknown, ref: unknown, joinRef: unknown) => void): void;
    onError(callback: (reason?: unknown) => void): void;

    topic: string;
    state: string;
    socket: Socket;
  }

  export class Push {
    receive(status: string, callback: (response: unknown) => void): Push;
  }

  export class Presence {
    constructor(channel: Channel, opts?: { events?: { state: string; diff: string } });

    onJoin(callback: (key: string, currentPresence: unknown | undefined, newPresence: unknown) => void): void;
    onLeave(callback: (key: string, currentPresence: unknown, leftPresence: unknown) => void): void;
    onSync(callback: () => void): void;
    list<T = unknown>(chooser?: (key: string, presence: unknown) => T): T[];
    inPendingSyncState(): boolean;

    static syncState(
      currentState: Record<string, unknown>,
      newState: Record<string, unknown>,
      onJoin?: (key: string, currentPresence: unknown | undefined, newPresence: unknown) => void,
      onLeave?: (key: string, currentPresence: unknown, leftPresence: unknown) => void
    ): Record<string, unknown>;

    static syncDiff(
      currentState: Record<string, unknown>,
      diff: { joins: Record<string, unknown>; leaves: Record<string, unknown> },
      onJoin?: (key: string, currentPresence: unknown | undefined, newPresence: unknown) => void,
      onLeave?: (key: string, currentPresence: unknown, leftPresence: unknown) => void
    ): Record<string, unknown>;

    static list<T = unknown>(
      presences: Record<string, unknown>,
      chooser?: (key: string, presence: unknown) => T
    ): T[];
  }
}
