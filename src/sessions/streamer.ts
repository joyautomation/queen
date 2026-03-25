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
 * Detect markdown tables and wrap them in code blocks so Discord
 * renders them with aligned monospace text instead of raw pipes.
 */
function formatForDiscord(text: string): string {
  // Match consecutive lines that look like markdown table rows (start with |)
  // including the separator line (|---|---|)
  return text.replace(
    /(?:^|\n)((?:\|.+\|[ \t]*\n){2,})/g,
    (_match, table: string) => {
      // Only wrap if it contains a separator row (|---|)
      if (!/\|[-: ]+\|/.test(table)) return _match;
      return `\n\`\`\`\n${table.trim()}\n\`\`\`\n`;
    },
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
