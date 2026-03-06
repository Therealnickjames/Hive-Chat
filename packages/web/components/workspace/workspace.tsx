"use client";

import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { ChatPanel } from "./chat-panel";
import { PanelDock } from "./panel-dock";

export function Workspace() {
  const { panels, isLoaded } = useWorkspaceContext();
  const activePanels = panels.filter((panel) => !panel.isClosed);
  const visiblePanels = activePanels.filter((panel) => !panel.isMinimized);

  if (!isLoaded) return null; // Avoid hydration mismatch

  return (
    <div
      id="workspace-root"
      className="relative w-full h-full bg-background-tertiary"
    >
      {activePanels.map((panel) => (
        <ChatPanel key={panel.id} panel={panel} />
      ))}
      <PanelDock />

      {/* Empty State */}
      {visiblePanels.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/80 bg-background-primary shadow-sm">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-text-muted"
              >
                <path d="M4 19V5a2 2 0 0 1 2-2h13.4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                <path d="M4 15h18" />
                <path d="M8 15v6" />
                <path d="M12 15v6" />
                <path d="M16 15v6" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              Welcome to the Workspace
            </h2>
            <p className="mt-1.5 text-sm text-text-muted">
              Select a channel from the sidebar to begin
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
