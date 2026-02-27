"use client";

import { useChatContext } from "@/components/providers/chat-provider";
import type { PresenceUser } from "@/lib/hooks/use-channel";

interface MemberListProps {
  presenceMap?: Map<string, PresenceUser>;
}

export function MemberList({ presenceMap }: MemberListProps) {
  const { members } = useChatContext();

  const onlineMembers = members.filter((m) => presenceMap?.has(m.userId));
  const offlineMembers = members.filter((m) => !presenceMap?.has(m.userId));

  return (
    <div className="hidden w-60 flex-col bg-background-secondary lg:flex">
      <div className="flex-1 overflow-y-auto px-2 pt-6">
        {/* Online section */}
        {onlineMembers.length > 0 && (
          <>
            <p className="mb-2 px-2 text-xs font-bold uppercase text-text-muted">
              Online — {onlineMembers.length}
            </p>
            {onlineMembers.map((member) => (
              <MemberItem
                key={member.userId}
                name={member.displayName}
                online={true}
              />
            ))}
          </>
        )}

        {/* Offline section */}
        {offlineMembers.length > 0 && (
          <>
            <p className="mb-2 mt-4 px-2 text-xs font-bold uppercase text-text-muted">
              Offline — {offlineMembers.length}
            </p>
            {offlineMembers.map((member) => (
              <MemberItem
                key={member.userId}
                name={member.displayName}
                online={false}
              />
            ))}
          </>
        )}

        {members.length === 0 && (
          <p className="px-2 py-4 text-xs text-text-muted">
            No members to display
          </p>
        )}
      </div>
    </div>
  );
}

function MemberItem({ name, online }: { name: string; online: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1.5 transition hover:bg-background-primary ${
        online ? "opacity-100" : "opacity-50"
      }`}
    >
      <div className="relative flex-shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-background-tertiary text-sm font-semibold text-text-primary">
          {name.charAt(0).toUpperCase()}
        </div>
        <div
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background-secondary ${
            online ? "bg-status-online" : "bg-status-offline"
          }`}
        />
      </div>
      <span
        className={`truncate text-sm ${
          online ? "text-text-primary" : "text-text-muted"
        }`}
      >
        {name}
      </span>
    </div>
  );
}
