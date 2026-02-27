"use client";

import { useState } from "react";

interface FileAttachmentProps {
  fileId: string;
  filename: string;
  mimeType: string;
}

export function FileAttachment({ fileId, filename, mimeType }: FileAttachmentProps) {
  const [imageError, setImageError] = useState(false);
  const url = `/api/uploads/${fileId}`;
  const isImage = mimeType.startsWith("image/") && !imageError;

  if (isImage) {
    return (
      <div className="mt-2 max-w-md">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={filename}
            onError={() => setImageError(true)}
            className="max-h-80 rounded-lg border border-background-tertiary object-contain cursor-pointer transition hover:opacity-90"
          />
        </a>
        <p className="mt-1 text-xs text-text-muted">{filename}</p>
      </div>
    );
  }

  const icon = getFileIcon(mimeType);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={filename}
      className="mt-2 inline-flex items-center gap-2 rounded-lg bg-background-tertiary px-3 py-2 text-sm text-text-secondary transition hover:bg-background-primary hover:text-text-primary"
    >
      <span className="text-lg">{icon}</span>
      <span className="max-w-xs truncate">{filename}</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="flex-shrink-0"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "[IMG]";
  if (mimeType === "application/pdf") return "[PDF]";
  if (mimeType === "application/zip") return "[ZIP]";
  if (mimeType.startsWith("text/")) return "[TXT]";
  if (mimeType === "application/json") return "[JSON]";
  return "[FILE]";
}

export function parseFileReferences(content: string): {
  text: string;
  files: { fileId: string; filename: string; mimeType: string }[];
} {
  const fileRegex = /\[file:([^:\]]+):([^:\]]+):([^\]]+)\]/g;
  const files: { fileId: string; filename: string; mimeType: string }[] = [];

  const withoutRefs = content.replace(
    fileRegex,
    (_, fileId: string, filename: string, mimeType: string) => {
      files.push({ fileId, filename, mimeType });
      return "";
    }
  );

  return {
    text: withoutRefs.trim(),
    files,
  };
}
