"use client";

import {
  useState,
  useRef,
  useCallback,
  type ChangeEvent,
  type KeyboardEvent,
  type DragEvent,
  type ClipboardEvent,
} from "react";
import {
  MentionAutocomplete,
  getFilteredOptions,
  type MentionOption,
} from "./mention-autocomplete";

interface PendingFile {
  fileId: string;
  filename: string;
  mimeType: string;
  width?: number;
  height?: number;
  progress: number; // 0-1, 1 = complete
}

interface MessageInputProps {
  onSend: (content: string) => void;
  onTyping: () => void;
  disabled?: boolean;
  channelName?: string;
  mentionOptions?: MentionOption[];
}

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/zip",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const uploading = pendingFiles.some((f) => f.progress < 1);

  // Upload a single file with progress tracking via XMLHttpRequest (TASK-0025)
  const uploadFile = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      alert("File too large (max 10MB)");
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      alert(`File type not allowed: ${file.type || "unknown"}`);
      return;
    }

    // Create a temporary pending file entry with 0 progress
    const tempId = `uploading-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pendingEntry: PendingFile = {
      fileId: tempId,
      filename: file.name,
      mimeType: file.type,
      progress: 0,
    };

    setPendingFiles((prev) => [...prev, pendingEntry]);

    try {
      const formData = new FormData();
      formData.append("file", file);

      // Use XMLHttpRequest for upload progress (TASK-0025)
      const result = await new Promise<{
        fileId: string;
        filename: string;
        mimeType: string;
        width?: number;
        height?: number;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/uploads");

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = e.loaded / e.total;
            setPendingFiles((prev) =>
              prev.map((f) =>
                f.fileId === tempId ? { ...f, progress: Math.min(progress, 0.99) } : f
              )
            );
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              resolve({
                fileId: data.fileId,
                filename: data.filename,
                mimeType: data.mimeType,
                width: data.width || undefined,
                height: data.height || undefined,
              });
            } catch {
              reject(new Error("Invalid response"));
            }
          } else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error || "Upload failed"));
            } catch {
              reject(new Error("Upload failed"));
            }
          }
        };

        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(formData);
      });

      // Replace temp entry with real data
      setPendingFiles((prev) =>
        prev.map((f) =>
          f.fileId === tempId
            ? {
                fileId: result.fileId,
                filename: result.filename,
                mimeType: result.mimeType,
                width: result.width,
                height: result.height,
                progress: 1,
              }
            : f
        )
      );
    } catch (error) {
      // Remove failed upload
      setPendingFiles((prev) => prev.filter((f) => f.fileId !== tempId));
      alert(error instanceof Error ? error.message : "Upload failed");
    }
  }, []);

  // Upload multiple files (TASK-0025)
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      await Promise.all(fileArray.map((f) => uploadFile(f)));
    },
    [uploadFile]
  );

  const handleSend = useCallback(() => {
    let content = value.trim();
    const completedFiles = pendingFiles.filter((f) => f.progress >= 1);
    const fileRefs = completedFiles
      .map((file) => {
        // Include dimensions in reference if available (TASK-0025)
        const dims = file.width && file.height ? `:${file.width}x${file.height}` : "";
        return `[file:${file.fileId}:${file.filename}:${file.mimeType}${dims}]`;
      })
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
      const files = e.target.files;
      if (!files || files.length === 0) return;
      await uploadFiles(files);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [uploadFiles]
  );

  const removePendingFile = useCallback((fileId: string) => {
    setPendingFiles((prev) => prev.filter((file) => file.fileId !== fileId));
  }, []);

  // Drag-and-drop handlers (TASK-0025)
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        await uploadFiles(files);
      }
    },
    [uploadFiles]
  );

  // Clipboard paste handler (TASK-0025)
  const handlePaste = useCallback(
    async (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const fileItems: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) fileItems.push(file);
        }
      }

      if (fileItems.length > 0) {
        e.preventDefault(); // Prevent default paste only when files are found
        await uploadFiles(fileItems);
      }
      // If no files, let default paste behavior handle text
    },
    [uploadFiles]
  );

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
    <div
      className="px-4 pb-6 pt-0 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag-and-drop overlay (TASK-0025) */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent rounded-lg pointer-events-none">
          <div className="flex items-center gap-2 text-accent text-sm font-mono font-bold">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Drop files here
          </div>
        </div>
      )}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-1">
          {pendingFiles.map((file) => (
            <div
              key={file.fileId}
              className="relative inline-flex items-center gap-1.5 rounded bg-background-tertiary px-2 py-1 text-xs text-text-secondary overflow-hidden"
            >
              {/* Upload progress bar (TASK-0025) */}
              {file.progress < 1 && (
                <div
                  className="absolute bottom-0 left-0 h-0.5 bg-accent transition-all duration-200"
                  style={{ width: `${Math.round(file.progress * 100)}%` }}
                />
              )}
              <span className="max-w-32 truncate">{file.filename}</span>
              {file.progress < 1 && (
                <span className="text-[9px] text-text-muted">{Math.round(file.progress * 100)}%</span>
              )}
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
      <div className="relative flex items-end gap-2 bg-background-secondary border border-border px-3 py-2 mt-1">
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
          multiple
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-text-dim transition hover:text-text-primary disabled:opacity-30"
          title="Upload file"
          aria-label="Upload file"
        >
          {uploading ? (
            <div className="h-3 w-3 animate-spin rounded-full border border-text-muted border-t-transparent" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          )}
        </button>
        <div className="flex-1 flex items-end min-h-[24px]">
          <span className="text-brand mr-2 mb-[3px] select-none text-sm leading-none opacity-80">&#9658;</span>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            onPaste={handlePaste}
            disabled={disabled}
            placeholder={
              channelName
                ? `Message #${channelName}`
                : "Type here..."
            }
            rows={1}
            className="max-h-[200px] flex-1 resize-none bg-transparent text-sm font-mono text-text-primary placeholder-text-dim outline-none leading-relaxed py-0.5"
          />
        </div>
        <button
          onClick={handleSend}
          disabled={disabled || (!value.trim() && pendingFiles.filter(f => f.progress >= 1).length === 0)}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-text-dim transition hover:text-brand disabled:opacity-30"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
