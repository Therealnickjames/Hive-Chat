"use client";

import { useState } from "react";
import Image from "next/image";
import { passthroughImageLoader } from "@/lib/image-loader";

interface FileAttachmentProps {
  fileId: string;
  filename: string;
  mimeType: string;
  width?: number; // TASK-0025: actual image width
  height?: number; // TASK-0025: actual image height
}

export function FileAttachment({
  fileId,
  filename,
  mimeType,
  width,
  height,
}: FileAttachmentProps) {
  const [imageError, setImageError] = useState(false);
  const url = `/api/uploads/${fileId}`;
  const isImage = mimeType.startsWith("image/") && !imageError;

  if (isImage) {
    // Use actual dimensions if available, fallback to 640x480 for backward compat
    const imgWidth = width || 640;
    const imgHeight = height || 480;

    return (
      <div className="mt-2 max-w-md">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <Image
            src={url}
            alt={filename}
            loader={passthroughImageLoader}
            unoptimized
            width={imgWidth}
            height={imgHeight}
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

/**
 * Parse file references from message content.
 * Format: [file:{fileId}:{filename}:{mimeType}] (v1)
 * Extended: [file:{fileId}:{filename}:{mimeType}:{WxH}] (v2, TASK-0025)
 *
 * WxH is optional for backward compatibility.
 */
export function parseFileReferences(content: string): {
  text: string;
  files: {
    fileId: string;
    filename: string;
    mimeType: string;
    width?: number;
    height?: number;
  }[];
} {
  // Extended regex: optional 5th field for dimensions (WxH)
  const fileRegex = /\[file:([^:\]]+):([^:\]]+):([^:\]]+)(?::(\d+x\d+))?\]/g;
  const files: {
    fileId: string;
    filename: string;
    mimeType: string;
    width?: number;
    height?: number;
  }[] = [];

  const withoutRefs = content.replace(
    fileRegex,
    (
      _,
      fileId: string,
      filename: string,
      mimeType: string,
      dimensions?: string,
    ) => {
      const file: {
        fileId: string;
        filename: string;
        mimeType: string;
        width?: number;
        height?: number;
      } = {
        fileId,
        filename,
        mimeType,
      };
      if (dimensions) {
        const [w, h] = dimensions.split("x").map(Number);
        if (w > 0 && h > 0) {
          file.width = w;
          file.height = h;
        }
      }
      files.push(file);
      return "";
    },
  );

  return {
    text: withoutRefs.trim(),
    files,
  };
}
