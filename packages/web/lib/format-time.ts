/**
 * Format a date string for display in chat messages.
 * Shows "Today at HH:MM" for today's messages, or "Mon DD, YYYY HH:MM" for older ones.
 *
 * Extracted from message-item.tsx and streaming-message.tsx (ISSUE-019).
 */
export function formatTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return `Today at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
