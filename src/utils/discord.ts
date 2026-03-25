/**
 * Split text into chunks that fit within Discord's 2000-char message limit.
 * Prefers splitting at newlines, then spaces, then hard-cuts.
 */
export function chunkMessage(text: string, maxLen = 1990): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline within the limit
    let splitIndex = remaining.lastIndexOf("\n", maxLen);
    if (splitIndex <= 0) {
      // Try a space
      splitIndex = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIndex <= 0) {
      // Hard split
      splitIndex = maxLen;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n/, "");
  }

  return chunks;
}

/** Truncate a string to `max` chars, adding ellipsis if truncated. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

/** Format seconds into a human-readable duration. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
