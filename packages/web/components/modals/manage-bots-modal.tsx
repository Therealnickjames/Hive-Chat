"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { useChatContext } from "@/components/providers/chat-provider";
import type {
  ModalView,
  AgentListItem,
  CreatedAgentCredentials,
} from "./agent/types";
import { AgentList } from "./agent/agent-list";
import { MethodPicker } from "./agent/method-picker";
import { BYOKForm } from "./agent/byok-form";
import { SDKSetupForm } from "./agent/sdk-setup-form";
import { InboundWebhookForm, OutboundWebhookForm } from "./agent/webhook-forms";
import {
  RestPollingForm,
  SSEForm,
  OpenAICompatForm,
} from "./agent/simple-agent-forms";
import { CredentialsDisplay } from "./agent/credentials-display";
import { AgentSettings } from "./agent/agent-settings";

interface ManageBotsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const VIEW_TITLES: Record<ModalView, string> = {
  list: "Manage Agents",
  "method-picker": "Add Agent",
  "byok-form": "BYOK Setup",
  "sdk-setup": "Python / TS SDK",
  "inbound-webhook-form": "Inbound Webhook",
  "outbound-webhook-form": "HTTP Webhook (Outbound)",
  "rest-form": "REST Polling",
  "sse-form": "Server-Sent Events",
  "openai-form": "OpenAI-Compatible",
  credentials: "Agent Created",
  settings: "Agent Settings",
};

export function ManageBotsModal({ isOpen, onClose }: ManageBotsModalProps) {
  const { currentServerId } = useChatContext();
  const [view, setView] = useState<ModalView>("list");
  const [bots, setBots] = useState<AgentListItem[]>([]);
  const [editingBot, setEditingBot] = useState<AgentListItem | null>(null);
  const [credentials, setCredentials] =
    useState<CreatedAgentCredentials | null>(null);

  const fetchBots = useCallback(async () => {
    if (!currentServerId) return;
    try {
      const res = await fetch(`/api/servers/${currentServerId}/bots`);
      if (res.ok) {
        const data = await res.json();
        const nextBots = Array.isArray(data?.bots)
          ? data.bots
          : Array.isArray(data)
            ? data
            : [];
        setBots(nextBots);
      }
    } catch {
      console.error("Failed to fetch bots");
    }
  }, [currentServerId]);

  useEffect(() => {
    if (isOpen) {
      setView("list");
      setEditingBot(null);
      setCredentials(null);
      fetchBots();
    }
  }, [isOpen, fetchBots]);

  // Dynamic title — show "Edit Agent" when editing
  const title =
    view === "byok-form" && editingBot ? "Edit Agent" : VIEW_TITLES[view];

  function handleEditBot(bot: AgentListItem) {
    setEditingBot(bot);
    setView("byok-form");
  }

  function handleAgentCreated(creds: CreatedAgentCredentials) {
    setCredentials(creds);
    setView("credentials");
    fetchBots(); // Refresh the list in background
  }

  function handleBYOKSaved() {
    setEditingBot(null);
    setView("list");
    fetchBots();
  }

  function handleBackToList() {
    setEditingBot(null);
    setView("list");
  }

  function handleBackToMethodPicker() {
    setView("method-picker");
  }

  if (!currentServerId) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="wide">
      {view === "list" && (
        <AgentList
          bots={bots}
          serverId={currentServerId}
          onAddAgent={() => setView("method-picker")}
          onEditBot={handleEditBot}
          onSettings={() => setView("settings")}
          onRefresh={fetchBots}
        />
      )}

      {view === "method-picker" && (
        <MethodPicker onSelect={setView} onBack={handleBackToList} />
      )}

      {view === "byok-form" && (
        <BYOKForm
          serverId={currentServerId}
          editingBot={editingBot}
          onSave={handleBYOKSaved}
          onCancel={editingBot ? handleBackToList : handleBackToMethodPicker}
        />
      )}

      {view === "sdk-setup" && (
        <SDKSetupForm
          serverId={currentServerId}
          onCreated={handleAgentCreated}
          onCancel={handleBackToMethodPicker}
        />
      )}

      {view === "inbound-webhook-form" && (
        <InboundWebhookForm
          serverId={currentServerId}
          onCreated={handleAgentCreated}
          onCancel={handleBackToMethodPicker}
        />
      )}

      {view === "outbound-webhook-form" && (
        <OutboundWebhookForm
          serverId={currentServerId}
          onCreated={handleAgentCreated}
          onCancel={handleBackToMethodPicker}
        />
      )}

      {view === "rest-form" && (
        <RestPollingForm
          serverId={currentServerId}
          onCreated={handleAgentCreated}
          onCancel={handleBackToMethodPicker}
        />
      )}

      {view === "sse-form" && (
        <SSEForm
          serverId={currentServerId}
          onCreated={handleAgentCreated}
          onCancel={handleBackToMethodPicker}
        />
      )}

      {view === "openai-form" && (
        <OpenAICompatForm
          serverId={currentServerId}
          onCreated={handleAgentCreated}
          onCancel={handleBackToMethodPicker}
        />
      )}

      {view === "credentials" && credentials && (
        <CredentialsDisplay
          credentials={credentials}
          onDone={handleBackToList}
        />
      )}

      {view === "settings" && (
        <AgentSettings serverId={currentServerId} onBack={handleBackToList} />
      )}
    </Modal>
  );
}
