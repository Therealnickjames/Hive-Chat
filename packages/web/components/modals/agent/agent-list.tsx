"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AgentListItem } from "./types";
import { getMethodBadgeClasses, getMethodLabel } from "./types";

interface AgentListProps {
  bots: AgentListItem[];
  serverId: string;
  onAddAgent: () => void;
  onEditBot: (bot: AgentListItem) => void;
  onSettings: () => void;
  onRefresh: () => void;
}

export function AgentList({
  bots,
  serverId,
  onAddAgent,
  onEditBot,
  onSettings,
  onRefresh,
}: AgentListProps) {
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const pendingBots = bots.filter((b) => b.approvalStatus === "PENDING");
  const activeBots = bots.filter(
    (b) => b.isActive && b.approvalStatus !== "PENDING"
  );
  const inactiveBots = bots.filter(
    (b) =>
      !b.isActive &&
      b.approvalStatus !== "PENDING" &&
      b.approvalStatus !== "REJECTED"
  );
  const rejectedBots = bots.filter((b) => b.approvalStatus === "REJECTED");

  async function handleDelete(botId: string) {
    if (deletingBotId !== botId) {
      setDeletingBotId(botId);
      return;
    }

    try {
      const res = await fetch(`/api/servers/${serverId}/bots/${botId}`, {
        method: "DELETE",
      });
      if (res.ok) onRefresh();
    } catch {
      console.error("Failed to delete bot");
    } finally {
      setDeletingBotId(null);
    }
  }

  async function handleApprove(botId: string) {
    setApprovingId(botId);
    try {
      const res = await fetch(
        `/api/servers/${serverId}/bots/${botId}/approve`,
        { method: "POST" }
      );
      if (res.ok) onRefresh();
    } catch {
      console.error("Failed to approve agent");
    } finally {
      setApprovingId(null);
    }
  }

  async function handleReject(botId: string) {
    setRejectingId(botId);
    try {
      const res = await fetch(
        `/api/servers/${serverId}/bots/${botId}/reject`,
        { method: "POST" }
      );
      if (res.ok) onRefresh();
    } catch {
      console.error("Failed to reject agent");
    } finally {
      setRejectingId(null);
    }
  }

  return (
    <div>
      {/* Pending Approval */}
      {pendingBots.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-xs font-bold uppercase text-brand">
              Pending Approval
            </p>
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand/20 px-1.5 text-[10px] font-bold text-brand">
              {pendingBots.length}
            </span>
          </div>
          <div className="space-y-2">
            {pendingBots.map((bot) => (
              <div
                key={bot.id}
                className="flex items-center justify-between rounded border border-brand/20 bg-brand/5 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">
                      {bot.name}
                    </span>
                    <MethodBadge method={bot.connectionMethod} />
                  </div>
                  <p className="text-xs text-text-muted">
                    Self-registered &middot; awaiting approval
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleApprove(bot.id)}
                    disabled={approvingId === bot.id}
                    className="rounded px-2 py-1 text-xs bg-green-600/20 text-green-400 hover:bg-green-600/30 disabled:opacity-50"
                  >
                    {approvingId === bot.id ? "..." : "Approve"}
                  </button>
                  <button
                    onClick={() => handleReject(bot.id)}
                    disabled={rejectingId === bot.id}
                    className="rounded px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 disabled:opacity-50"
                  >
                    {rejectingId === bot.id ? "..." : "Reject"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Agents */}
      {activeBots.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-bold uppercase text-text-muted">
            Active Agents — {activeBots.length}
          </p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {activeBots.map((bot) => (
              <BotRow
                key={bot.id}
                bot={bot}
                deletingBotId={deletingBotId}
                onEdit={() => onEditBot(bot)}
                onDelete={() => handleDelete(bot.id)}
                onBlurDelete={() => setDeletingBotId(null)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Inactive Agents */}
      {inactiveBots.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-bold uppercase text-text-muted">
            Inactive — {inactiveBots.length}
          </p>
          <div className="space-y-2 max-h-40 overflow-y-auto opacity-60">
            {inactiveBots.map((bot) => (
              <BotRow
                key={bot.id}
                bot={bot}
                deletingBotId={deletingBotId}
                onEdit={() => onEditBot(bot)}
                onDelete={() => handleDelete(bot.id)}
                onBlurDelete={() => setDeletingBotId(null)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Rejected Agents */}
      {rejectedBots.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-bold uppercase text-text-muted">
            Rejected — {rejectedBots.length}
          </p>
          <div className="space-y-2 max-h-40 overflow-y-auto opacity-40">
            {rejectedBots.map((bot) => (
              <BotRow
                key={bot.id}
                bot={bot}
                deletingBotId={deletingBotId}
                onEdit={() => onEditBot(bot)}
                onDelete={() => handleDelete(bot.id)}
                onBlurDelete={() => setDeletingBotId(null)}
              />
            ))}
          </div>
        </div>
      )}

      {bots.length === 0 && (
        <p className="text-sm text-text-muted py-4">
          No agents yet. Add one to bring AI to your server.
        </p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={onSettings}
          className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-text-muted transition hover:bg-background-primary hover:text-text-primary"
          title="Agent Settings"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
              clipRule="evenodd"
            />
          </svg>
          Settings
        </button>
        <Button onClick={onAddAgent}>Add Agent</Button>
      </div>
    </div>
  );
}

function BotRow({
  bot,
  deletingBotId,
  onEdit,
  onDelete,
  onBlurDelete,
}: {
  bot: AgentListItem;
  deletingBotId: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onBlurDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded bg-background-primary p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">
            {bot.name}
          </span>
          <MethodBadge method={bot.connectionMethod} />
          {bot.connectionMethod === null && (
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400">
              {bot.llmProvider}
            </span>
          )}
        </div>
        <p className="text-xs text-text-muted truncate">
          {bot.connectionMethod === null
            ? `${bot.llmModel} \u00b7 ${bot.triggerMode.toLowerCase()}`
            : `${getMethodLabel(bot.connectionMethod)} agent \u00b7 ${bot.triggerMode.toLowerCase()}`}
        </p>
      </div>
      <div className="flex gap-1">
        {bot.connectionMethod === null && (
          <button
            onClick={onEdit}
            className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-background-secondary hover:text-text-primary"
          >
            Edit
          </button>
        )}
        <button
          onClick={onDelete}
          onBlur={onBlurDelete}
          className={`rounded px-2 py-1 text-xs ${
            deletingBotId === bot.id
              ? "bg-status-danger text-white font-semibold"
              : "text-status-danger hover:bg-status-danger/10"
          }`}
        >
          {deletingBotId === bot.id ? "Confirm?" : "Delete"}
        </button>
      </div>
    </div>
  );
}

function MethodBadge({ method }: { method: AgentListItem["connectionMethod"] }) {
  if (method === null) return null; // BYOK shows provider badge instead
  return (
    <span
      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${getMethodBadgeClasses(method)}`}
    >
      {getMethodLabel(method)}
    </span>
  );
}
