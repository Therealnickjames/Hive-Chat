"use client";

import { useMemo } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { useChatContext } from "@/components/providers/chat-provider";
import { usePathname, useRouter } from "next/navigation";

export function PanelDock() {
  const router = useRouter();
  const pathname = usePathname();
  const { panels, restorePanel } = useWorkspaceContext();
  const { servers } = useChatContext();

  const minimizedPanels = panels.filter((p) => !p.isClosed && p.isMinimized);
  const serverNameById = useMemo(
    () =>
      Object.fromEntries(
        servers.map((server) => [server.id, server.name] as const),
      ),
    [servers],
  );

  if (minimizedPanels.length === 0) return null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-xl border border-border bg-background-floating/80 px-3 py-2 backdrop-blur-md shadow-2xl z-50">
      {minimizedPanels.map((panel) => (
        <button
          key={panel.id}
          onClick={() => {
            restorePanel(panel.id);
            const target = `/servers/${panel.serverId}/channels/${panel.channelId}`;
            if (pathname !== target) {
              router.replace(target);
            }
          }}
          className="flex flex-shrink-0 max-w-40 items-center gap-2 rounded-lg bg-background-secondary px-3 py-1.5 text-xs text-text-secondary hover:bg-background-primary hover:text-text-primary transition-all border border-transparent hover:border-border"
        >
          <div className="h-2 w-2 rounded-full bg-brand shrink-0" />
          <span className="truncate font-mono">
            # {panel.channelName}
            {serverNameById[panel.serverId]
              ? ` @${serverNameById[panel.serverId]}`
              : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
