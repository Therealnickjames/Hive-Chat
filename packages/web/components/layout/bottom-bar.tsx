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
    <div className="col-span-3 flex h-[40px] items-center justify-between border-t border-border bg-background-primary px-4 text-[13px] text-text-muted font-medium">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 transition-colors hover:text-text-primary cursor-pointer">
          <div className="h-2 w-2 rounded-full bg-accent-green shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div>
          4 services healthy
        </div>
        <div className="flex items-center gap-2 text-text-dim">
          <Activity className="h-3.5 w-3.5" />
          {activeStreams.size} active streams
        </div>
        <div className="flex items-center gap-2 text-text-dim">
          <Box className="h-3.5 w-3.5" />
          {openCount} panels · {minimizedCount} minimized
        </div>
      </div>
      <div className="flex items-center gap-6 text-text-dim">
        <div className="flex items-center gap-1.5 transition-colors hover:text-text-primary cursor-pointer">
          <Database className="h-3.5 w-3.5" />
          PostgreSQL 16
        </div>
        <div className="flex items-center gap-1.5 transition-colors hover:text-text-primary cursor-pointer">
          <Server className="h-3.5 w-3.5" />
          Redis 7
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs">v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
