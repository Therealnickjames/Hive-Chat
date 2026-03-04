"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface EditMessageInputProps {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}

/**
 * Inline edit textarea that replaces message content during editing.
 * Enter saves, Escape cancels. (TASK-0014)
 */
export function EditMessageInput({
  initialContent,
  onSave,
  onCancel,
}: EditMessageInputProps) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus and select on mount
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
  }, [content]);

  const handleSave = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || trimmed === initialContent.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    onSave(trimmed);
  }, [content, initialContent, onSave, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      }
    },
    [onCancel, handleSave]
  );

  return (
    <div className="mt-1">
      <div className="text-[10px] text-text-muted font-mono mb-1">
        Editing message — <span className="text-text-secondary">Enter</span> to save, <span className="text-text-secondary">Escape</span> to cancel
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={saving}
        maxLength={4000}
        rows={1}
        className="w-full resize-none rounded bg-background-tertiary px-3 py-2 text-sm font-mono text-text-primary outline-none ring-1 ring-brand/50 transition focus:ring-brand disabled:opacity-50"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="text-xs font-mono text-text-muted hover:text-text-primary transition"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !content.trim() || content.trim() === initialContent.trim()}
          className="text-xs font-mono text-brand hover:text-brand/80 transition disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
