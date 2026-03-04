"use client";

/**
 * "New Messages" divider inserted between the last-read and first-unread message. (TASK-0016)
 */
export function UnreadDivider() {
  return (
    <div className="relative my-2 flex items-center px-4">
      <div className="flex-1 border-t border-status-error/60" />
      <span className="mx-2 text-[10px] font-bold uppercase tracking-wider text-status-error">
        New Messages
      </span>
      <div className="flex-1 border-t border-status-error/60" />
    </div>
  );
}
