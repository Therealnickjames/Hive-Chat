"use client";

import React from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import {
  Activity,
  LayoutDashboard,
  MessageSquare,
  CreditCard,
  CheckSquare,
  FileText,
} from "lucide-react";

export function TopBar() {
  const { activeStreams } = useWorkspaceContext();

  return (
    <div className="col-span-3 flex h-[48px] items-center justify-between border-b border-border bg-background-primary px-4 text-sm shadow-sm">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2 font-sans font-bold tracking-wide">
          <div className="h-5 w-5 rounded bg-brand flex items-center justify-center">
            <LayoutDashboard className="h-3 w-3 text-white" />
          </div>
          <span className="text-brand">TAVOK</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="flex items-center gap-2 rounded-md bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand transition-colors">
            <LayoutDashboard className="h-4 w-4" />
            Workspace
          </button>
          <button className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-text-dim transition-colors hover:bg-background-secondary hover:text-text-primary">
            <MessageSquare className="h-4 w-4" />
            DMs
          </button>
          <button className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-text-dim transition-colors hover:bg-background-secondary hover:text-text-primary">
            <CreditCard className="h-4 w-4" />
            Costs
          </button>
          <button className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-text-dim transition-colors hover:bg-background-secondary hover:text-text-primary">
            <CheckSquare className="h-4 w-4" />
            Tasks
          </button>
          <button className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-text-dim transition-colors hover:bg-background-secondary hover:text-text-primary">
            <FileText className="h-4 w-4" />
            Notes
          </button>
          <button className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-text-dim transition-colors hover:bg-background-secondary hover:text-text-primary">
            <Activity className="h-4 w-4" />
            Activity
          </button>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs font-medium text-text-muted">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-background-secondary px-3 py-1">
          <div className="h-2 w-2 rounded-full bg-accent-green shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div>
          CONNECTED
        </div>
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-brand" />
          {activeStreams.size} STREAMING
        </div>
        <div className="text-text-dim">0 tokens/min</div>
      </div>
    </div>
  );
}
