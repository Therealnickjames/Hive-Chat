"use client";

interface MessageActionsProps {
  /** Show the edit button (author of a non-bot, non-streaming message) */
  canEdit: boolean;
  /** Show the delete button (author OR has MANAGE_MESSAGES) */
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Hover toolbar for message actions (edit/delete).
 * Positioned top-right of the message, visible on group-hover. (TASK-0014)
 */
export function MessageActions({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: MessageActionsProps) {
  if (!canEdit && !canDelete) return null;

  return (
    <div className="absolute -top-3 right-4 hidden group-hover:flex items-center gap-0.5 rounded border border-border bg-background-floating shadow-md px-1 py-0.5 z-10">
      {canEdit && (
        <button
          onClick={onEdit}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted transition hover:bg-background-primary hover:text-text-primary"
          title="Edit message"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      )}
      {canDelete && (
        <button
          onClick={onDelete}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted transition hover:bg-status-dnd/20 hover:text-status-dnd"
          title="Delete message"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
    </div>
  );
}
