"use client";

import { createContext, useContext, ReactNode } from "react";
import { usePanelState, PanelState } from "@/lib/hooks/use-panel-state";

interface WorkspaceContextValue extends ReturnType<typeof usePanelState> {}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspaceContext() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspaceContext must be used within a WorkspaceProvider");
  }
  return ctx;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const panelState = usePanelState();

  return (
    <WorkspaceContext.Provider value={panelState}>
      {children}
    </WorkspaceContext.Provider>
  );
}
