"use client";

import React, { useMemo } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Database, Server, Box, Activity } from "lucide-react";

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
    <div className="chrome-panel col-span-3 flex items-center justify-between px-4 text-[10px] font-medium text-text-dim">
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-accent-green shadow-[0_0_6px_rgba(34,197,94,0.4)]" />
          4 services healthy
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-accent-cyan" />
          {activeStreams.size} active streams
        </div>
        <div className="flex items-center gap-1.5">
          <Box className="h-3 w-3" />
          {openCount} panels / {minimizedCount} minimized
        </div>
      </div>
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-1.5">
          <Database className="h-3 w-3" />
          PostgreSQL 16
        </div>
        <div className="flex items-center gap-1.5">
          <Server className="h-3 w-3" />
          Redis 7
        </div>
        <div className="text-[9px] tracking-[0.1em] text-text-dim">v1.0.0</div>
      </div>
    </div>
  );
}
