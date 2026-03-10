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

interface ManageAgentsModalProps {
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
};

export function ManageAgentsModal({ isOpen, onClose }: ManageAgentsModalProps) {
  const { currentServerId } = useChatContext();
  const [view, setView] = useState<ModalView>("list");
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [editingAgent, setEditingAgent] = useState<AgentListItem | null>(null);
  const [credentials, setCredentials] =
    useState<CreatedAgentCredentials | null>(null);

  const fetchAgents = useCallback(async () => {
    if (!currentServerId) return;
    try {
      const res = await fetch(`/api/servers/${currentServerId}/agents`);
      if (res.ok) {
        const data = await res.json();
        const nextAgents = Array.isArray(data?.agents)
          ? data.agents
          : Array.isArray(data)
            ? data
            : [];
        setAgents(nextAgents);
      }
    } catch {
      console.error("Failed to fetch agents");
    }
  }, [currentServerId]);

  useEffect(() => {
    if (isOpen) {
      setView("list");
      setEditingAgent(null);
      setCredentials(null);
      fetchAgents();
    }
  }, [isOpen, fetchAgents]);

  // Dynamic title — show "Edit Agent" when editing
  const title =
    view === "byok-form" && editingAgent ? "Edit Agent" : VIEW_TITLES[view];

  function handleEditAgent(agent: AgentListItem) {
    setEditingAgent(agent);
    setView("byok-form");
  }

  function handleAgentCreated(creds: CreatedAgentCredentials) {
    setCredentials(creds);
    setView("credentials");
    fetchAgents(); // Refresh the list in background
  }

  function handleBYOKSaved() {
    setEditingAgent(null);
    setView("list");
    fetchAgents();
  }

  function handleBackToList() {
    setEditingAgent(null);
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
          agents={agents}
          serverId={currentServerId}
          onAddAgent={() => setView("method-picker")}
          onEditAgent={handleEditAgent}
          onRefresh={fetchAgents}
        />
      )}

      {view === "method-picker" && (
        <MethodPicker onSelect={setView} onBack={handleBackToList} />
      )}

      {view === "byok-form" && (
        <BYOKForm
          serverId={currentServerId}
          editingAgent={editingAgent}
          onSave={handleBYOKSaved}
          onCancel={editingAgent ? handleBackToList : handleBackToMethodPicker}
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
    </Modal>
  );
}
