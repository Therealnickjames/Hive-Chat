"use client";

import React from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";

export function TopBar() {
  const { activeStreams } = useWorkspaceContext();

  return (
    <div className="col-span-3 flex h-[38px] items-center justify-between border-b border-border bg-background-secondary px-4 text-sm">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-1 font-sans font-bold tracking-widest">
          <span className="text-brand">TAVOK</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="border-b-2 border-brand pb-[8px] pt-[10px] text-brand">
            Workspace
          </div>
          <div className="pb-[8px] pt-[10px] text-text-dim">DMs</div>
          <div className="pb-[8px] pt-[10px] text-text-dim">Costs</div>
          <div className="pb-[8px] pt-[10px] text-text-dim">Tasks</div>
          <div className="pb-[8px] pt-[10px] text-text-dim">Notes</div>
          <div className="pb-[8px] pt-[10px] text-text-dim">Activity</div>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-text-dim">
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-accent-green"></div>
          CONNECTED
        </div>
        <div>{activeStreams.size} STREAMING</div>
        <div>0 tokens/min</div>
      </div>
    </div>
  );
}
