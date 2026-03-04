"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

interface DeleteMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
  messagePreview: string;
  authorName: string;
}

/**
 * Confirmation modal for deleting a message.
 * Shows a preview of the message content and author. (TASK-0014)
 */
export function DeleteMessageModal({
  isOpen,
  onClose,
  onConfirm,
  messagePreview,
  authorName,
}: DeleteMessageModalProps) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    const success = await onConfirm();
    setLoading(false);
    if (success) {
      onClose();
    }
  }

  // Truncate long previews
  const truncated =
    messagePreview.length > 200
      ? messagePreview.slice(0, 200) + "..."
      : messagePreview;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Delete Message">
      <p className="text-sm text-text-secondary mb-3">
        Are you sure you want to delete this message? This action cannot be
        undone.
      </p>

      {/* Message preview */}
      <div className="rounded border border-border bg-background-secondary p-3 mb-4">
        <div className="text-xs font-bold font-mono text-text-muted mb-1">
          {authorName}
        </div>
        <div className="text-sm font-mono text-text-primary break-words">
          {truncated}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={loading}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleDelete}
          loading={loading}
          className="bg-status-dnd hover:bg-status-dnd/80 text-white"
        >
          Delete
        </Button>
      </div>
    </Modal>
  );
}
