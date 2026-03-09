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
  onRefresh: () => void;
}

export function AgentList({
  bots,
  serverId,
  onAddAgent,
  onEditBot,
  onRefresh,
}: AgentListProps) {
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);

  const activeBots = bots.filter((b) => b.isActive);
  const inactiveBots = bots.filter((b) => !b.isActive);

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

  return (
    <div>
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

      {bots.length === 0 && (
        <p className="text-sm text-text-muted py-4">
          No agents yet. Add one to bring AI to your server.
        </p>
      )}

      <div className="mt-4 flex items-center justify-end">
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

function MethodBadge({
  method,
}: {
  method: AgentListItem["connectionMethod"];
}) {
  if (method === null) return null; // BYOK shows provider badge instead
  return (
    <span
      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${getMethodBadgeClasses(method)}`}
    >
      {getMethodLabel(method)}
    </span>
  );
}
