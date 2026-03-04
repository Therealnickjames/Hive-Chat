"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CreatedAgentCredentials } from "./types";
import { getMethodLabel } from "./types";

interface CredentialsDisplayProps {
  credentials: CreatedAgentCredentials;
  onDone: () => void;
}

export function CredentialsDisplay({ credentials, onDone }: CredentialsDisplayProps) {
  const fields = buildFields(credentials);

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="rounded-lg border border-brand/30 bg-brand/5 px-4 py-3">
        <p className="text-sm font-medium text-brand">
          Copy these credentials now
        </p>
        <p className="mt-1 text-xs text-brand/80">
          The API key will not be shown again. Store it securely.
        </p>
      </div>

      {/* Agent info */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-text-primary">
          {credentials.name}
        </span>
        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-accent-cyan/20 text-accent-cyan">
          {getMethodLabel(credentials.connectionMethod)}
        </span>
      </div>

      {/* Credential fields */}
      <div className="space-y-3">
        {fields.map((field) => (
          <CredentialField
            key={field.label}
            label={field.label}
            value={field.value}
            sensitive={field.sensitive}
          />
        ))}
      </div>

      {/* Done button */}
      <div className="flex justify-end pt-2">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

function CredentialField({
  label,
  value,
  sensitive,
}: {
  label: string;
  value: string;
  sensitive?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!sensitive);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: no clipboard API
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-muted uppercase">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded bg-background-tertiary px-3 py-2 font-mono text-xs text-text-primary overflow-x-auto">
          {revealed ? value : "\u2022".repeat(Math.min(value.length, 40))}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {sensitive && (
            <button
              onClick={() => setRevealed(!revealed)}
              className="rounded px-2 py-1.5 text-xs text-text-muted hover:bg-background-primary hover:text-text-primary transition"
              title={revealed ? "Hide" : "Reveal"}
            >
              {revealed ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 00-2.79.588l.77.771A5.944 5.944 0 018 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0114.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z" />
                  <path d="M11.297 9.176a3.5 3.5 0 00-4.474-4.474l.823.823a2.5 2.5 0 012.829 2.829l.822.822zm-2.943 1.299l.822.822a3.5 3.5 0 01-4.474-4.474l.823.823a2.5 2.5 0 002.829 2.829z" />
                  <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 001.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 018 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zM13.646 14.354l-12-12 .708-.708 12 12-.708.708z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 011.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0114.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 011.172 8z" />
                  <path d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM4.5 8a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0z" />
                </svg>
              )}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="rounded px-2 py-1.5 text-xs text-text-muted hover:bg-background-primary hover:text-text-primary transition"
            title="Copy"
          >
            {copied ? (
              <span className="text-green-400 font-medium">Copied!</span>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 1.5H3a2 2 0 00-2 2V14a2 2 0 002 2h10a2 2 0 002-2V3.5a2 2 0 00-2-2h-1v1h1a1 1 0 011 1V14a1 1 0 01-1 1H3a1 1 0 01-1-1V3.5a1 1 0 011-1h1v-1z" />
                <path d="M9.5 1a.5.5 0 01.5.5v1a.5.5 0 01-.5.5h-3a.5.5 0 01-.5-.5v-1a.5.5 0 01.5-.5h3zm-3-1A1.5 1.5 0 005 1.5v1A1.5 1.5 0 006.5 4h3A1.5 1.5 0 0011 2.5v-1A1.5 1.5 0 009.5 0h-3z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildFields(creds: CreatedAgentCredentials) {
  const fields: { label: string; value: string; sensitive?: boolean }[] = [];

  if (creds.apiKey) {
    fields.push({ label: "API Key", value: creds.apiKey, sensitive: true });
  }

  if (creds.webhookSecret) {
    fields.push({ label: "Webhook Secret (HMAC-SHA256)", value: creds.webhookSecret, sensitive: true });
  }

  if (creds.webhookUrl) {
    fields.push({ label: "Webhook URL", value: creds.webhookUrl });
  }

  if (creds.webhookToken) {
    fields.push({ label: "Webhook Token", value: creds.webhookToken, sensitive: true });
  }

  if (creds.websocketUrl) {
    fields.push({ label: "WebSocket URL", value: creds.websocketUrl });
  }

  if (creds.pollUrl) {
    fields.push({ label: "Poll URL", value: creds.pollUrl });
  }

  if (creds.eventsUrl) {
    fields.push({ label: "Events URL (SSE)", value: creds.eventsUrl });
  }

  if (creds.chatCompletionsUrl) {
    fields.push({ label: "Chat Completions URL", value: creds.chatCompletionsUrl });
  }

  if (creds.modelsUrl) {
    fields.push({ label: "Models URL", value: creds.modelsUrl });
  }

  return fields;
}
