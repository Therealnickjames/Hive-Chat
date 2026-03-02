"use client";

import { METHOD_INFO, type ModalView } from "./types";

interface MethodPickerProps {
  onSelect: (view: ModalView) => void;
  onBack: () => void;
}

export function MethodPicker({ onSelect, onBack }: MethodPickerProps) {
  return (
    <div>
      <p className="mb-4 text-sm text-text-secondary">
        Choose how you want to connect your agent to this server.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {METHOD_INFO.map((method) => (
          <button
            key={method.key}
            onClick={() => onSelect(method.view)}
            className="flex flex-col items-start gap-1.5 rounded-lg border border-background-tertiary bg-background-primary p-4 text-left transition hover:border-accent-cyan hover:bg-background-primary/80"
          >
            <div className="flex items-center gap-2">
              <MethodIcon methodKey={method.key} />
              <span className="text-sm font-semibold text-text-primary">
                {method.title}
              </span>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              {method.description}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-4 flex justify-start">
        <button
          onClick={onBack}
          className="rounded px-3 py-1.5 text-sm text-text-secondary transition hover:bg-background-primary hover:text-text-primary"
        >
          &larr; Back
        </button>
      </div>
    </div>
  );
}

function MethodIcon({ methodKey }: { methodKey: string }) {
  const className = "h-4 w-4 text-text-muted";

  switch (methodKey) {
    case "BYOK":
      return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor">
          <path d="M11 1a3 3 0 00-2.83 4H1v3h1v2h2V8h1v2h2V8h1.17A3 3 0 1011 1zm0 4a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      );
    case "WEBSOCKET":
      return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor">
          <path d="M5.5 2a.5.5 0 01.5.5v3.293l1.854-1.854a.5.5 0 01.707.708L6.207 7H9.5a.5.5 0 010 1H6.207l2.354 2.354a.5.5 0 11-.707.707L6 9.207V12.5a.5.5 0 01-1 0V9.207L2.646 11.56a.5.5 0 01-.707-.707L4.293 8H1a.5.5 0 010-1h3.293L1.94 4.646a.5.5 0 11.707-.707L5 6.293V2.5a.5.5 0 01.5-.5zM10 8a1 1 0 112 0 1 1 0 01-2 0zm3-3a1 1 0 112 0 1 1 0 01-2 0zm0 6a1 1 0 112 0 1 1 0 01-2 0z" />
        </svg>
      );
    case "INBOUND_WEBHOOK":
      return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a.5.5 0 01.5.5v5.793l2.146-2.147a.5.5 0 01.708.708l-3 3a.5.5 0 01-.708 0l-3-3a.5.5 0 01.708-.708L7.5 7.293V1.5A.5.5 0 018 1zM2 11.5a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5zm0 2a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5z" />
        </svg>
      );
    case "WEBHOOK":
      return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 15a.5.5 0 01-.5-.5V8.707L5.354 10.854a.5.5 0 01-.708-.708l3-3a.5.5 0 01.708 0l3 3a.5.5 0 01-.708.708L8.5 8.707V14.5A.5.5 0 018 15zM2 4.5a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5zm0-2a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5z" />
        </svg>
      );
    case "REST_POLL":
      return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.534 7h3.932a.25.25 0 01.192.41l-1.966 2.36a.25.25 0 01-.384 0l-1.966-2.36a.25.25 0 01.192-.41zm-11 2H4.466a.25.25 0 00.192-.41L2.692 6.23a.25.25 0 00-.384 0L.342 8.59A.25.25 0 00.534 9zM8 3a5 5 0 00-4.546 2.914.5.5 0 01-.908-.418A6 6 0 0114 8a.5.5 0 01-1 0 5 5 0 00-5-5zm4.546 7.086A5 5 0 018 13a5 5 0 01-5-5 .5.5 0 00-1 0 6 6 0 0011.454 2.504.5.5 0 01-.908.418z" />
        </svg>
      );
    case "SSE":
      return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 2.5A.5.5 0 011.5 2h13a.5.5 0 010 1h-13A.5.5 0 011 2.5zm0 3A.5.5 0 011.5 5h13a.5.5 0 010 1h-13A.5.5 0 011 5.5zM1.5 8a.5.5 0 000 1h8a.5.5 0 000-1h-8zm0 3a.5.5 0 000 1h5a.5.5 0 000-1h-5zm8.354-.354a.5.5 0 010 .708l-2 2a.5.5 0 01-.708-.708L8.793 12l-1.647-1.646a.5.5 0 01.708-.708l2 2z" />
        </svg>
      );
    case "OPENAI_COMPAT":
      return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm5.354-2.354a.5.5 0 00-.708.708L7.293 9l-2.647 2.646a.5.5 0 00.708.708L8 9.707l2.646 2.647a.5.5 0 00.708-.708L8.707 9l2.647-2.646a.5.5 0 00-.708-.708L8 8.293 5.354 5.646z" />
        </svg>
      );
    default:
      return null;
  }
}
