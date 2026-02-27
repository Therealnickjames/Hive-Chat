"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useChatContext } from "@/components/providers/chat-provider";

/**
 * Server landing page — redirects to the first channel.
 * If no channels exist yet, shows a placeholder message.
 */
export default function ServerPage() {
  const params = useParams<{ serverId: string }>();
  const router = useRouter();
  const { channels } = useChatContext();

  useEffect(() => {
    if (channels.length > 0) {
      router.replace(
        `/servers/${params.serverId}/channels/${channels[0].id}`
      );
    }
  }, [channels, params.serverId, router]);

  // Show while waiting for channels to load or if server has no channels
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        {channels.length === 0 ? (
          <>
            <p className="text-lg font-semibold text-text-primary">
              No channels yet
            </p>
            <p className="mt-1 text-sm text-text-muted">
              Create a channel to get started!
            </p>
          </>
        ) : (
          <p className="text-sm text-text-muted">Redirecting...</p>
        )}
      </div>
    </div>
  );
}
