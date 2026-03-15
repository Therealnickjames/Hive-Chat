"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { passthroughImageLoader } from "@/lib/image-loader";
import { Users, Loader2 } from "lucide-react";

interface DiscoverServer {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerName: string;
  memberCount: number;
  isMember: boolean;
  createdAt: string;
}

export default function DiscoverPage() {
  const router = useRouter();
  const [servers, setServers] = useState<DiscoverServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/servers/discover");
        if (!res.ok) throw new Error("Failed to fetch servers");
        const data = await res.json();
        if (!cancelled) setServers(data.servers ?? []);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load servers",
          );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleJoin = useCallback(
    async (serverId: string) => {
      setJoiningId(serverId);
      try {
        const res = await fetch(`/api/servers/${serverId}/members`, {
          method: "POST",
        });
        if (res.ok || res.status === 200) {
          setServers((prev) =>
            prev.map((s) => (s.id === serverId ? { ...s, isMember: true } : s)),
          );
          router.push(`/servers/${serverId}`);
        } else {
          const data = await res.json();
          setError(data.error || "Failed to join server");
        }
      } catch {
        setError("Failed to join server");
      } finally {
        setJoiningId(null);
      }
    },
    [router],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-dim" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <h1 className="font-display text-lg font-semibold text-text-primary">
          Discover Servers
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Browse and join public servers
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-md bg-status-dnd/10 px-4 py-2 text-sm text-status-dnd">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 underline hover:no-underline"
            >
              dismiss
            </button>
          </div>
        )}

        {servers.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-text-dim">
            No servers found.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {servers.map((server) => (
              <div
                key={server.id}
                className="chrome-card flex flex-col rounded-lg p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background-floating text-lg font-bold text-text-secondary">
                    {server.iconUrl ? (
                      <Image
                        src={server.iconUrl}
                        alt=""
                        loader={passthroughImageLoader}
                        unoptimized
                        width={48}
                        height={48}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      server.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-text-primary">
                      {server.name}
                    </h3>
                    <p className="text-xs text-text-muted">
                      by {server.ownerName}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-text-dim">
                    <Users className="h-3.5 w-3.5" />
                    {server.memberCount}{" "}
                    {server.memberCount === 1 ? "member" : "members"}
                  </span>

                  {server.isMember ? (
                    <button
                      onClick={() => router.push(`/servers/${server.id}`)}
                      className="rounded-md bg-background-tertiary px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-background-primary"
                    >
                      Joined
                    </button>
                  ) : (
                    <button
                      onClick={() => handleJoin(server.id)}
                      disabled={joiningId === server.id}
                      className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand/90 disabled:opacity-50"
                    >
                      {joiningId === server.id ? "Joining..." : "Join"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
