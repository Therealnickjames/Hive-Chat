"use client";

import { ChatProvider } from "@/components/providers/chat-provider";
import { ServerSidebar } from "@/components/layout/server-sidebar";
import { ChannelSidebar } from "@/components/layout/channel-sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      <div className="flex h-screen overflow-hidden bg-background-primary">
        <ServerSidebar />
        <ChannelSidebar />
        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </ChatProvider>
  );
}
