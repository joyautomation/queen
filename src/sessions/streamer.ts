import type { ThreadChannel } from "discord.js";
import { chunkMessage } from "../utils/discord";

export interface StreamResult {
  sessionId: string | null;
  error: boolean;
}

/**
 * Iterate Agent SDK messages and stream formatted output to a Discord thread.
 * Returns the captured session ID once the stream ends.
 */
export async function streamToDiscord(
  thread: ThreadChannel,
  messages: AsyncIterable<any>,
  signal: AbortSignal,
): Promise<StreamResult> {
  let sessionId: string | null = null;

  // Keep the typing indicator alive while the session runs
  const typingInterval = setInterval(() => {
    thread.sendTyping().catch(() => {});
  }, 8_000);

  try {
    await thread.sendTyping();

    for await (const msg of messages) {
      if (signal.aborted) break;

      // --- System init: capture session ID ---
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id ?? null;
        continue;
      }

      // --- Assistant turn ---
      if (msg.type === "assistant") {
        const text = formatForDiscord(extractAssistantText(msg));
        if (text.trim()) {
          for (const chunk of chunkMessage(text.trim())) {
            await thread.send(chunk);
          }
        }
        continue;
      }

      // --- Result (success / error) ---
      if (msg.type === "result") {
        sessionId = msg.session_id ?? sessionId;
        if (msg.subtype === "success") {
          const cost =
            typeof msg.total_cost_usd === "number"
              ? `$${msg.total_cost_usd.toFixed(4)}`
              : "unknown cost";
          const turns = msg.num_turns ?? "?";
          const duration = msg.duration_ms
            ? `${Math.round(msg.duration_ms / 1000)}s`
            : "?";
          await thread.send(
            `**Session complete** \u2014 ${turns} turns, ${duration}, ${cost}`,
          );
        } else {
          const errors = Array.isArray(msg.errors)
            ? msg.errors.join(", ")
            : "Unknown error";
          await thread.send(`**Session error** (${msg.subtype}): ${errors}`);
        }
        continue;
      }
    }
  } catch (err: any) {
    if (err.name === "AbortError" || signal.aborted) {
      await thread.send("**Session killed.**").catch(() => {});
    } else {
      await thread
        .send(`**Error**: ${err.message?.slice(0, 1800) ?? "unknown"}`)
        .catch(() => {});
    }
    return { sessionId, error: true };
  } finally {
    clearInterval(typingInterval);
  }

  return { sessionId, error: false };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect markdown tables and reformat them as properly aligned
 * code blocks for Discord's monospace rendering.
 */
function formatForDiscord(text: string): string {
  return text.replace(
    /(?:^|\n)((?:\|.+\|[ \t]*\n){2,})/g,
    (_match, table: string) => {
      if (!/\|[-: ]+\|/.test(table)) return _match;
      return `\n\`\`\`\n${alignTable(table.trim())}\n\`\`\`\n`;
    },
  );
}

/**
 * Parse a markdown table, strip emoji, and re-pad columns so they
 * align correctly in a monospace code block.
 */
function alignTable(table: string): string {
  const lines = table.split("\n").filter((l) => l.trim());

  // Parse each row into cells
  const rows = lines.map((line) =>
    line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => stripEmoji(cell.trim())),
  );

  // Find the separator row and remove it — we'll regenerate it
  const sepIndex = rows.findIndex((row) =>
    row.every((cell) => /^[-: ]+$/.test(cell)),
  );

  const dataRows = rows.filter((_, i) => i !== sepIndex);
  if (dataRows.length === 0) return table;

  // Calculate max width per column
  const colCount = Math.max(...dataRows.map((r) => r.length));
  const widths: number[] = Array(colCount).fill(0);
  for (const row of dataRows) {
    for (let i = 0; i < colCount; i++) {
      widths[i] = Math.max(widths[i], (row[i] ?? "").length);
    }
  }

  // Rebuild the table with padding
  const formatRow = (row: string[]) =>
    "| " +
    widths.map((w, i) => (row[i] ?? "").padEnd(w)).join(" | ") +
    " |";

  const separator =
    "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |";

  const result: string[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    result.push(formatRow(dataRows[i]));
    // Insert separator after the header row
    if (i === 0) result.push(separator);
  }

  return result.join("\n");
}

/**
 * Strip emoji characters from a string so monospace alignment works.
 * Replaces common status emoji with text equivalents.
 */
function stripEmoji(text: string): string {
  return (
    text
      // Common status emoji → text
      .replace(/\u2705|\u{1F7E2}/gu, "[ok]")
      .replace(/\u274C|\u{1F534}/gu, "[x]")
      .replace(/\u{1F7E1}/gu, "[!]")
      .replace(/\u23f3|\u231b/gu, "[..]")
      // Strip any remaining emoji (supplementary plane + variation selectors)
      .replace(
        /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu,
        "",
      )
      .trim()
  );
}

/**
 * Extract displayable text from an SDKAssistantMessage.
 *
 * Content blocks can be:
 *  - { type: "text", text: string }
 *  - { type: "tool_use", name: string, input: object }
 */
function extractAssistantText(msg: any): string {
  const content = msg?.message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];

  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "tool_use") {
      parts.push(formatToolUse(block));
    }
  }

  return parts.join("\n");
}

function formatToolUse(block: any): string {
  const name: string = block.name ?? "unknown";
  const input = block.input ?? {};

  switch (name) {
    case "Read":
      return `> \`Read\` \u2014 ${input.file_path ?? ""}`;
    case "Write":
      return `> \`Write\` \u2014 ${input.file_path ?? ""}`;
    case "Edit":
      return `> \`Edit\` \u2014 ${input.file_path ?? ""}`;
    case "Bash": {
      const cmd = String(input.command ?? "").split("\n")[0].slice(0, 120);
      return `> \`Bash\` \u2014 \`${cmd}\``;
    }
    case "Glob":
      return `> \`Glob\` \u2014 ${input.pattern ?? ""}`;
    case "Grep":
      return `> \`Grep\` \u2014 ${input.pattern ?? ""}`;
    default:
      return `> \`${name}\``;
  }
}
