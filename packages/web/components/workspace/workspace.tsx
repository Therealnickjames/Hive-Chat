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
          <div className="text-center font-mono text-text-dim">
            <div className="mb-4 text-brand/20">
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                className="mx-auto"
              >
                <path d="M4 19V5a2 2 0 0 1 2-2h13.4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                <path d="M4 15h18" />
                <path d="M8 15v6" />
                <path d="M12 15v6" />
                <path d="M16 15v6" />
              </svg>
            </div>
            <p>TAVOK // COMMAND CENTER</p>
            <p className="text-xs mt-2 opacity-50">
              OPEN A CHANNEL FROM THE SIDEBAR TO BEGIN
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
