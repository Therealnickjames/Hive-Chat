"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useChatContext } from "@/components/providers/chat-provider";
import { useDmList } from "@/lib/hooks/use-dm-list";
import type { PresenceUser } from "@/lib/hooks/use-channel";

interface MemberListProps {
  presenceMap?: Map<string, PresenceUser>;
  /** Number of currently active streaming sessions in the channel */
  activeStreamCount?: number;
}

export function MemberList({ presenceMap, activeStreamCount = 0 }: MemberListProps) {
  const { members, bots } = useChatContext();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const onlineMembers = members.filter((m) => presenceMap?.has(m.userId));
  const offlineMembers = members.filter((m) => !presenceMap?.has(m.userId));

  // Agents: bots that are active in this server
  const activeBots = bots.filter((b) => b.isActive);
  const inactiveBots = bots.filter((b) => !b.isActive);

  return (
    <div className="hidden w-60 flex-col bg-background-secondary lg:flex">
      <div className="flex-1 overflow-y-auto px-2 pt-6">
        {/* Agents section */}
        {activeBots.length > 0 && (
          <>
            <p className="mb-2 px-2 text-xs font-bold uppercase text-text-muted">
              Agents — {activeBots.length}
            </p>
            {activeBots.map((bot) => (
              <AgentItem
                key={bot.id}
                name={bot.name}
                model={bot.llmModel}
                isStreaming={activeStreamCount > 0}
              />
            ))}
          </>
        )}

        {/* Online members */}
        {onlineMembers.length > 0 && (
          <>
            <p className={`mb-2 px-2 text-xs font-bold uppercase text-text-muted ${activeBots.length > 0 ? "mt-4" : ""}`}>
              Online — {onlineMembers.length}
            </p>
            {onlineMembers.map((member) => (
              <MemberItem
                key={member.userId}
                userId={member.userId}
                name={member.displayName}
                avatarUrl={member.avatarUrl}
                online={true}
                isCurrentUser={member.userId === currentUserId}
              />
            ))}
          </>
        )}

        {/* Offline members */}
        {offlineMembers.length > 0 && (
          <>
            <p className="mb-2 mt-4 px-2 text-xs font-bold uppercase text-text-muted">
              Offline — {offlineMembers.length}
            </p>
            {offlineMembers.map((member) => (
              <MemberItem
                key={member.userId}
                userId={member.userId}
                name={member.displayName}
                avatarUrl={member.avatarUrl}
                online={false}
                isCurrentUser={member.userId === currentUserId}
              />
            ))}
          </>
        )}

        {/* Inactive agents */}
        {inactiveBots.length > 0 && (
          <>
            <p className="mb-2 mt-4 px-2 text-xs font-bold uppercase text-text-muted">
              Inactive Agents — {inactiveBots.length}
            </p>
            {inactiveBots.map((bot) => (
              <AgentItem
                key={bot.id}
                name={bot.name}
                model={bot.llmModel}
                isStreaming={false}
                isInactive
              />
            ))}
          </>
        )}

        {members.length === 0 && bots.length === 0 && (
          <p className="px-2 py-4 text-xs text-text-muted">
            No members to display
          </p>
        )}
      </div>
    </div>
  );
}

function MemberItem({
  userId,
  name,
  avatarUrl,
  online,
  isCurrentUser,
}: {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  online: boolean;
  isCurrentUser?: boolean;
}) {
  const router = useRouter();
  const { startDm } = useDmList();
  const [isStartingDm, setIsStartingDm] = useState(false);

  // TASK-0019: Start a DM with this member
  const handleStartDm = useCallback(async () => {
    if (isCurrentUser || isStartingDm) return;
    setIsStartingDm(true);
    try {
      const dmId = await startDm(userId);
      if (dmId) {
        router.push(`/dms/${dmId}`);
      }
    } finally {
      setIsStartingDm(false);
    }
  }, [userId, isCurrentUser, isStartingDm, startDm, router]);

  return (
    <div
      className={`group flex items-center gap-2 rounded px-2 py-1.5 transition hover:bg-background-primary ${
        online ? "opacity-100" : "opacity-50"
      }`}
    >
      <div className="relative flex-shrink-0">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-background-tertiary text-sm font-semibold text-text-primary">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
        <div
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background-secondary ${
            online ? "bg-status-online" : "bg-status-offline"
          }`}
        />
      </div>
      <span
        className={`truncate text-sm flex-1 ${
          online ? "text-text-primary" : "text-text-muted"
        }`}
      >
        {name}
      </span>
      {/* TASK-0019: Message button (hidden until hover, not shown for self) */}
      {!isCurrentUser && (
        <button
          onClick={handleStartDm}
          disabled={isStartingDm}
          className="hidden group-hover:flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-dim hover:text-text-primary hover:bg-background-secondary transition"
          title={`Message ${name}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}
    </div>
  );
}

function AgentItem({
  name,
  model,
  isStreaming,
  isInactive,
}: {
  name: string;
  model?: string;
  isStreaming?: boolean;
  isInactive?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1.5 transition hover:bg-background-primary ${
        isInactive ? "opacity-40" : "opacity-100"
      }`}
    >
      <div className="relative flex-shrink-0">
        {/* Agent avatar: distinct hexagonal-feel with accent color */}
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-cyan/15 text-sm font-bold text-accent-cyan">
          {name.charAt(0).toUpperCase()}
        </div>
        {/* Status indicator */}
        {isStreaming && !isInactive ? (
          <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background-secondary">
            <span className="absolute inset-0 rounded-full bg-accent-cyan animate-pulse" />
          </div>
        ) : (
          <div
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background-secondary ${
              isInactive ? "bg-status-offline" : "bg-status-online"
            }`}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-sm font-medium ${
              isInactive ? "text-text-muted" : "text-text-primary"
            }`}
          >
            {name}
          </span>
          {/* Agent badge */}
          <span className="flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wider bg-accent-cyan/10 text-accent-cyan/70">
            Agent
          </span>
        </div>
        {model && !isInactive && (
          <p className="truncate text-[10px] text-text-dim">{model}</p>
        )}
      </div>
    </div>
  );
}
