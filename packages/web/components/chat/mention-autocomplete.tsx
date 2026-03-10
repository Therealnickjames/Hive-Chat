"use client";

import { useEffect, useRef } from "react";

export interface MentionOption {
  id: string;
  name: string;
  type: "user" | "agent";
  secondary?: string;
}

interface MentionAutocompleteProps {
  query: string;
  options: MentionOption[];
  onSelect: (option: MentionOption) => void;
  onClose: () => void;
  visible: boolean;
  selectedIndex: number;
}

export function getFilteredOptions(
  options: MentionOption[],
  query: string,
): MentionOption[] {
  const normalized = query.toLowerCase();
  return options.filter(
    (opt) =>
      opt.name.toLowerCase().includes(normalized) ||
      (opt.secondary && opt.secondary.toLowerCase().includes(normalized)),
  );
}

export function MentionAutocomplete({
  query,
  options,
  onSelect,
  onClose,
  visible,
  selectedIndex,
}: MentionAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = getFilteredOptions(options, query);

  useEffect(() => {
    if (!visible) return;

    const onMouseDown = (event: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [visible, onClose]);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.children[selectedIndex] as
      | HTMLElement
      | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, filtered.length]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-lg border border-background-tertiary bg-background-floating shadow-xl z-50"
    >
      {filtered.map((option, index) => (
        <button
          key={`${option.type}-${option.id}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(option);
          }}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left transition ${
            index === selectedIndex
              ? "bg-brand/20 text-text-primary"
              : "text-text-secondary hover:bg-background-primary"
          }`}
        >
          <div
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              option.type === "agent"
                ? "bg-emerald-600 text-white"
                : "bg-brand text-background-floating"
            }`}
          >
            {option.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium">{option.name}</span>
            {option.secondary && (
              <span className="ml-1.5 text-xs text-text-muted">
                {option.secondary}
              </span>
            )}
          </div>
          {option.type === "agent" && (
            <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase bg-emerald-600/20 text-emerald-400">
              AGENT
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
