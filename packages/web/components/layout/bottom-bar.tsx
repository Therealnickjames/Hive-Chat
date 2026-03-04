"use client";

import React, { useMemo } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";

export function BottomBar() {
  const { panels, activeStreams } = useWorkspaceContext();

  const { openCount, minimizedCount } = useMemo(() => {
    const activePanels = panels.filter((p) => !p.isClosed);
    const minimized = activePanels.filter((p) => p.isMinimized).length;
    return {
      openCount: activePanels.length,
      minimizedCount: minimized,
    };
  }, [panels]);

  return (
    <div className="col-span-3 flex h-[44px] items-center justify-between border-t border-border bg-background-secondary px-4 text-xs text-text-dim">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-accent-green"></div>4 services
          healthy
        </div>
        <div>{activeStreams.size} active streams</div>
        <div>
          {openCount} panels · {minimizedCount} minimized
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div>PostgreSQL 16</div>
        <div>Redis 7</div>
        <div>v1.0.0</div>
      </div>
    </div>
  );
}
