/**
 * Split text into chunks that fit within Discord's 2000-char message limit.
 * Prefers splitting at newlines, then spaces, then hard-cuts.
 * Handles code blocks: if a split occurs inside a ``` block, closes it at the
 * end of the chunk and reopens it at the start of the next.
 */
export function chunkMessage(text: string, maxLen = 1990): string[] {
  if (text.length <= maxLen) return [text];

  const rawChunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      rawChunks.push(remaining);
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

    rawChunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n/, "");
  }

  // Fix code blocks split across chunks
  const result: string[] = [];
  let inCodeBlock = false;
  let codeFence = "```";

  for (let chunk of rawChunks) {
    // If we're continuing a code block from the previous chunk, reopen it
    if (inCodeBlock) {
      chunk = codeFence + "\n" + chunk;
    }

    // Count fence markers in this chunk to determine if we end inside a code block
    const fences = chunk.match(/^```/gm);
    const fenceCount = fences ? fences.length : 0;

    // Odd number of fences means we're inside an unclosed code block
    if (fenceCount % 2 === 1) {
      // Extract the fence language hint from the opening fence
      const openMatch = chunk.match(/```(\w*)/);
      codeFence = openMatch ? "```" + (openMatch[1] ?? "") : "```";
      chunk += "\n```";
      inCodeBlock = true;
    } else {
      inCodeBlock = false;
    }

    result.push(chunk);
  }

  return result;
}

/** Truncate a string to `max` chars, adding ellipsis if truncated. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

/** Format a model ID into a short display name. */
export function shortModel(model: string | undefined): string {
  if (!model) return "default";
  return model.replace("claude-", "").replace(/-\d.*/, "");
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
