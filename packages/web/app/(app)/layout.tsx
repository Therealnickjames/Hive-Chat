"use client";

import { ChatProvider } from "@/components/providers/chat-provider";
import { WorkspaceProvider } from "@/components/providers/workspace-provider";
import { TopBar } from "@/components/layout/top-bar";
import { LeftPanel } from "@/components/layout/left-panel";
import { RightPanel } from "@/components/layout/right-panel";
import { BottomBar } from "@/components/layout/bottom-bar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      <WorkspaceProvider>
        <div
          className="grid h-screen overflow-hidden bg-background-tertiary"
          style={{
            gridTemplateColumns: "200px 1fr 240px",
            gridTemplateRows: "38px 1fr 44px",
          }}
        >
          <TopBar />
          <LeftPanel />
          <main className="relative overflow-hidden">{children}</main>
          <RightPanel />
          <BottomBar />
        </div>
      </WorkspaceProvider>
    </ChatProvider>
  );
}
