"use client";

import {
  useState,
  useRef,
  useCallback,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  MentionAutocomplete,
  getFilteredOptions,
  type MentionOption,
} from "./mention-autocomplete";

interface MessageInputProps {
  onSend: (content: string) => void;
  onTyping: () => void;
  disabled?: boolean;
  channelName?: string;
  mentionOptions?: MentionOption[];
}

export function MessageInput({
  onSend,
  onTyping,
  disabled,
  channelName,
  mentionOptions = [],
}: MessageInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState(0);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<
    { fileId: string; filename: string; mimeType: string }[]
  >([]);

  const handleSend = useCallback(() => {
    let content = value.trim();
    const fileRefs = pendingFiles
      .map((file) => `[file:${file.fileId}:${file.filename}:${file.mimeType}]`)
      .join("\n");

    if (fileRefs) {
      content = content ? `${content}\n${fileRefs}` : fileRefs;
    }

    if (!content) return;

    onSend(content);
    setValue("");
    setPendingFiles([]);
    setMentionActive(false);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, pendingFiles, onSend]);

  const handleFileSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/uploads", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();
        if (response.ok) {
          setPendingFiles((prev) => [
            ...prev,
            {
              fileId: data.fileId,
              filename: data.filename,
              mimeType: data.mimeType,
            },
          ]);
        } else {
          alert(data.error || "Upload failed");
        }
      } catch {
        alert("Upload failed");
      } finally {
        setUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    []
  );

  const removePendingFile = useCallback((fileId: string) => {
    setPendingFiles((prev) => prev.filter((file) => file.fileId !== fileId));
  }, []);

  const checkForMention = useCallback((text: string, cursorPos: number) => {
    let i = cursorPos - 1;
    while (i >= 0) {
      const char = text[i];
      if (char === "@") {
        if (i === 0 || /\s/.test(text[i - 1])) {
          const query = text.slice(i + 1, cursorPos);
          if (!/\s/.test(query)) {
            setMentionActive(true);
            setMentionQuery(query);
            setMentionStartIndex(i);
            setMentionSelectedIndex(0);
            return;
          }
        }
        break;
      }

      if (/\s/.test(char)) break;
      i--;
    }
    setMentionActive(false);
  }, []);

  const handleMentionSelect = useCallback(
    (option: MentionOption) => {
      const before = value.slice(0, mentionStartIndex);
      const after = value.slice(mentionStartIndex + 1 + mentionQuery.length);
      const newValue = `${before}@${option.name} ${after}`;
      setValue(newValue);
      setMentionActive(false);

      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const cursorPos = before.length + 1 + option.name.length + 1;
        el.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [value, mentionStartIndex, mentionQuery]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionActive) {
        const filtered = getFilteredOptions(mentionOptions, mentionQuery);

        if (e.key === "ArrowDown") {
          if (filtered.length > 0) {
            e.preventDefault();
            setMentionSelectedIndex((prev) =>
              prev < filtered.length - 1 ? prev + 1 : 0
            );
            return;
          }
        }

        if (e.key === "ArrowUp") {
          if (filtered.length > 0) {
            e.preventDefault();
            setMentionSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : filtered.length - 1
            );
            return;
          }
        }

        if (e.key === "Enter" || e.key === "Tab") {
          if (filtered.length > 0) {
            e.preventDefault();
            handleMentionSelect(filtered[mentionSelectedIndex]);
            return;
          }
        }

        if (e.key === "Escape") {
          e.preventDefault();
          setMentionActive(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      mentionActive,
      mentionOptions,
      mentionQuery,
      mentionSelectedIndex,
      handleMentionSelect,
      handleSend,
    ]
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setValue(newValue);
      onTyping();

      const cursorPos = e.target.selectionStart || 0;
      checkForMention(newValue, cursorPos);

      // Auto-resize textarea
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    },
    [onTyping, checkForMention]
  );

  const handleSelect = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    checkForMention(value, el.selectionStart || 0);
  }, [value, checkForMention]);

  return (
    <div className="px-4 pb-6 pt-0">
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-1">
          {pendingFiles.map((file) => (
            <div
              key={file.fileId}
              className="inline-flex items-center gap-1.5 rounded bg-background-tertiary px-2 py-1 text-xs text-text-secondary"
            >
              <span className="max-w-32 truncate">{file.filename}</span>
              <button
                onClick={() => removePendingFile(file.fileId)}
                className="text-text-muted transition hover:text-status-dnd"
                aria-label={`Remove ${file.filename}`}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="relative flex items-end gap-2 rounded-lg bg-background-secondary px-4 py-2">
        <MentionAutocomplete
          query={mentionQuery}
          options={mentionOptions}
          onSelect={handleMentionSelect}
          onClose={() => setMentionActive(false)}
          visible={mentionActive}
          selectedIndex={mentionSelectedIndex}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,application/json,application/zip"
          onChange={handleFileSelect}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-text-muted transition hover:text-text-primary disabled:opacity-30"
          title="Upload file"
          aria-label="Upload file"
        >
          {uploading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          )}
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          disabled={disabled}
          placeholder={
            channelName
              ? `Message #${channelName}`
              : "Send a message..."
          }
          rows={1}
          className="max-h-[200px] flex-1 resize-none bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
        />
        <button
          onClick={handleSend}
          disabled={disabled || (!value.trim() && pendingFiles.length === 0)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-text-muted transition hover:text-text-primary disabled:opacity-30"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
