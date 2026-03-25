import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ThreadChannel,
} from "discord.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { streamToDiscord } from "./streamer";
import {
  createSessionRecord,
  updateSessionAgentId,
  endSessionRecord,
} from "../db/queries";
import { truncate } from "../utils/discord";

const MAX_PAWNS = Number(process.env.QUEEN_MAX_PAWNS) || 5;

const DISCORD_SYSTEM_PROMPT = `
Your output is displayed in a Discord thread, not a terminal. Format accordingly:
- Discord does NOT render markdown tables. Use code blocks (\`\`\`) for any tabular data.
- Discord renders bold (**bold**), italic (*italic*), code (\`code\`), code blocks, blockquotes (>), and links. Headings (#) do work but are large — prefer **bold** for section labels.
- Messages are split at 2000 characters. Keep responses concise.
- Lists and bullet points render fine.
- Avoid HTML tags — Discord ignores them.
`.trim();

export interface Pawn {
  threadId: string;
  channelId: string;
  cwd: string;
  sessionId: string | null;
  startedAt: Date;
  status: "running" | "idle" | "dead";
  abortController: AbortController;
  projectName: string | null;
  messageQueue: string[];
}

/** Active pawns keyed by Discord thread ID. */
const pawns = new Map<string, Pawn>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getPawn(threadId: string): Pawn | undefined {
  return pawns.get(threadId);
}

export function listPawns(): Pawn[] {
  return Array.from(pawns.values());
}

/**
 * Spawn a new Claude Code session tied to a Discord thread.
 * The session runs in the background — this function returns immediately
 * after kicking off the streaming loop.
 */
export function spawnPawn(
  thread: ThreadChannel,
  cwd: string,
  prompt: string,
  projectName: string | null,
  resumeSessionId?: string | null,
): void {
  if (pawns.size >= MAX_PAWNS) {
    throw new Error(
      `Max concurrent pawns reached (${MAX_PAWNS}). Kill a session first.`,
    );
  }

  const abortController = new AbortController();

  const pawn: Pawn = {
    threadId: thread.id,
    channelId: thread.parentId!,
    cwd,
    sessionId: resumeSessionId ?? null,
    startedAt: new Date(),
    status: "running",
    abortController,
    projectName,
    messageQueue: [],
  };

  pawns.set(thread.id, pawn);

  // Only create a new DB record if this isn't a resume
  if (!resumeSessionId) {
    createSessionRecord(thread.id, thread.parentId!, cwd, prompt, projectName);
  }

  // Fire-and-forget the streaming loop
  runQuery(pawn, thread, prompt).catch((err) => {
    console.error(`[queen] Fatal error in pawn ${thread.id}:`, err);
  });
}

/**
 * Queue a follow-up message for a pawn. If the pawn is idle, immediately
 * resumes the session. If running, the message is queued.
 */
export function sendFollowUp(
  thread: ThreadChannel,
  content: string,
): { queued: boolean; error?: string } {
  const pawn = pawns.get(thread.id);
  if (!pawn) return { queued: false, error: "No active session in this thread." };
  if (pawn.status === "dead")
    return { queued: false, error: "Session has ended." };

  if (pawn.status === "running") {
    pawn.messageQueue.push(content);
    return { queued: true };
  }

  // Idle — resume immediately
  pawn.status = "running";
  pawn.abortController = new AbortController();

  runQuery(pawn, thread, content).catch((err) => {
    console.error(`[queen] Fatal error resuming pawn ${thread.id}:`, err);
  });

  return { queued: false };
}

/**
 * Kill a running pawn permanently (not resumable).
 */
export function killPawn(threadId: string): boolean {
  const pawn = pawns.get(threadId);
  if (!pawn) return false;

  pawn.abortController.abort();
  pawn.status = "dead";
  pawn.messageQueue.length = 0;
  pawns.delete(threadId);
  endSessionRecord(threadId, "killed");
  return true;
}

/**
 * Stop a running pawn gracefully (resumable by replying in thread).
 */
export function stopPawn(threadId: string): boolean {
  const pawn = pawns.get(threadId);
  if (!pawn) return false;

  pawn.abortController.abort();
  pawn.status = "dead";
  pawn.messageQueue.length = 0;
  pawns.delete(threadId);
  endSessionRecord(threadId, "stopped");
  return true;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function runQuery(
  pawn: Pawn,
  thread: ThreadChannel,
  prompt: string,
): Promise<void> {
  const options: Record<string, any> = {
    cwd: pawn.cwd,
    permissionMode: "auto",
    abortController: pawn.abortController,
    settingSources: ["user", "project", "local"],
    canUseTool: createPermissionHandler(thread, pawn.abortController.signal),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: DISCORD_SYSTEM_PROMPT,
    },
  };

  if (pawn.sessionId) {
    options.resume = pawn.sessionId;
  }

  let session: AsyncIterable<any>;
  try {
    session = query({ prompt, options });
  } catch (err: any) {
    pawn.status = "dead";
    pawns.delete(pawn.threadId);
    endSessionRecord(pawn.threadId, "error");
    await thread
      .send(`**Failed to start session**: ${err.message?.slice(0, 1800)}`)
      .catch(() => {});
    return;
  }

  const result = await streamToDiscord(
    thread,
    session,
    pawn.abortController.signal,
  );

  // Capture session ID for future resume
  if (result.sessionId && !pawn.sessionId) {
    pawn.sessionId = result.sessionId;
    updateSessionAgentId(pawn.threadId, result.sessionId);
  }

  if (result.error || pawn.abortController.signal.aborted) {
    pawn.status = "dead";
    pawns.delete(pawn.threadId);
    endSessionRecord(pawn.threadId, "error");
    return;
  }

  // Check for queued messages
  if (pawn.messageQueue.length > 0) {
    const queued = pawn.messageQueue.splice(0).join("\n\n");
    pawn.abortController = new AbortController();
    await runQuery(pawn, thread, queued);
    return;
  }

  pawn.status = "idle";
}

// ---------------------------------------------------------------------------
// Discord permission buttons
// ---------------------------------------------------------------------------

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function createPermissionHandler(
  thread: ThreadChannel,
  signal: AbortSignal,
) {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: {
      signal: AbortSignal;
      title?: string;
      displayName?: string;
      description?: string;
      decisionReason?: string;
      toolUseID: string;
    },
  ): Promise<{ behavior: "allow" | "deny"; message?: string; toolUseID?: string }> => {
    // Build a human-readable description
    const title = options.title || `\`${toolName}\` wants to run`;
    const detail = formatPermissionDetail(toolName, input);
    const reason = options.decisionReason
      ? `\n*Reason: ${options.decisionReason}*`
      : "";

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("perm_approve")
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("perm_deny")
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger),
    );

    const msg = await thread.send({
      content: `**Permission Required**\n${title}\n${detail}${reason}`,
      components: [row],
    });

    try {
      const click = await msg.awaitMessageComponent({
        filter: (i) =>
          i.customId === "perm_approve" || i.customId === "perm_deny",
        time: PERMISSION_TIMEOUT_MS,
      });

      const approved = click.customId === "perm_approve";

      await click.update({
        content: `${approved ? "Approved" : "Denied"} by ${click.user.displayName}: ${title}`,
        components: [],
      });

      if (approved) {
        return { behavior: "allow", toolUseID: options.toolUseID };
      }
      return {
        behavior: "deny",
        message: "Denied by user via Discord",
        toolUseID: options.toolUseID,
      };
    } catch {
      // Timeout — remove buttons and deny
      await msg
        .edit({ content: `**Timed out**: ${title}`, components: [] })
        .catch(() => {});
      return {
        behavior: "deny",
        message: "Permission request timed out (5 min)",
        toolUseID: options.toolUseID,
      };
    }
  };
}

function formatPermissionDetail(
  toolName: string,
  input: Record<string, unknown>,
): string {
  switch (toolName) {
    case "Bash": {
      const cmd = truncate(String(input.command ?? ""), 500);
      return `\`\`\`\n${cmd}\n\`\`\``;
    }
    case "Read":
    case "Write":
    case "Edit":
      return `File: \`${input.file_path ?? "unknown"}\``;
    default: {
      const summary = truncate(JSON.stringify(input), 500);
      return `\`\`\`json\n${summary}\n\`\`\``;
    }
  }
}
