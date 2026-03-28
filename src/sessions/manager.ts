import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type ThreadChannel,
} from "discord.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { streamToDiscord } from "./streamer";
import {
  createSessionRecord,
  updateSessionAgentId,
  endSessionRecord,
  addSessionCost,
  getConfig,
  getProject,
  updateSessionModelEffort,
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

When you need user input or want to present choices, use the AskUserQuestion tool. It renders as interactive buttons in Discord. Use it for plan confirmation, approach selection, or any multiple-choice decisions.
`.trim();

export interface SpawnOptions {
  model?: string;
  effort?: string;
}

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
  model: string | undefined;
  effort: string | undefined;
}

/** Active pawns keyed by Discord thread ID. */
const pawns = new Map<string, Pawn>();

export function canSpawn(): { ok: boolean; reason?: string } {
  if (pawns.size >= MAX_PAWNS) {
    return { ok: false, reason: `Max concurrent pawns reached (${MAX_PAWNS}). Kill a session first.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getPawn(threadId: string): Pawn | undefined {
  return pawns.get(threadId);
}

export function listPawns(): Pawn[] {
  return Array.from(pawns.values());
}

export function setPawnModel(threadId: string, model: string): boolean {
  const pawn = pawns.get(threadId);
  if (!pawn) return false;
  pawn.model = model;
  updateSessionModelEffort(threadId, model, pawn.effort ?? null);
  return true;
}

export function setPawnEffort(threadId: string, effort: string): boolean {
  const pawn = pawns.get(threadId);
  if (!pawn) return false;
  pawn.effort = effort;
  updateSessionModelEffort(threadId, pawn.model ?? null, effort);
  return true;
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
  opts?: SpawnOptions,
): { model: string | undefined; effort: string | undefined } {
  if (pawns.size >= MAX_PAWNS) {
    throw new Error(
      `Max concurrent pawns reached (${MAX_PAWNS}). Kill a session first.`,
    );
  }

  const abortController = new AbortController();
  // Priority: spawn option > project default > global default
  const project = projectName ? getProject(projectName) : undefined;
  const model =
    opts?.model || project?.default_model || getConfig("default_model") || undefined;
  const effort =
    opts?.effort || project?.default_effort || getConfig("default_effort") || undefined;

  const pawn: Pawn = {
    threadId: thread.id,
    channelId: thread.parentId!,
    cwd,
    sessionId: resumeSessionId ?? null,
    startedAt: new Date(),
    status: "running",
    abortController,
    model,
    effort,
    projectName,
    messageQueue: [],
  };

  pawns.set(thread.id, pawn);

  // Only create a new DB record if this isn't a resume
  if (!resumeSessionId) {
    createSessionRecord(thread.id, thread.parentId!, cwd, prompt, projectName, model, effort);
  }

  // Fire-and-forget the streaming loop
  runQuery(pawn, thread, prompt).catch((err) => {
    console.error(`[queen] Fatal error in pawn ${thread.id}:`, err);
  });

  return { model, effort };
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
    ...(pawn.model && { model: pawn.model }),
    ...(pawn.effort && { effort: pawn.effort }),
    abortController: pawn.abortController,
    settingSources: ["user", "project", "local"],
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Agent",
      "Bash",
    ],
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
    console.error(`[queen] Starting query for thread ${pawn.threadId} in ${pawn.cwd} (resume=${pawn.sessionId ?? "none"})`);
    session = query({ prompt, options });
    console.error(`[queen] Query created, starting stream`);
  } catch (err: any) {
    console.error(`[queen] query() threw:`, err);
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

  // Track cost
  if (result.costUsd > 0) {
    addSessionCost(pawn.threadId, result.costUsd);
  }

  if (result.error || pawn.abortController.signal.aborted) {
    pawn.status = "dead";
    pawns.delete(pawn.threadId);
    endSessionRecord(pawn.threadId, "error");
    return;
  }

  // Check for queued messages (sent while the session was working)
  if (pawn.messageQueue.length > 0) {
    const messages = pawn.messageQueue.splice(0);
    const queued =
      messages.length === 1
        ? `BTW (sent while you were working): ${messages[0]}`
        : `BTW (sent while you were working):\n${messages.map((m) => `- ${m}`).join("\n")}`;
    pawn.abortController = new AbortController();
    await runQuery(pawn, thread, queued);
    return;
  }

  pawn.status = "idle";
}

// ---------------------------------------------------------------------------
// Discord permission buttons
// ---------------------------------------------------------------------------

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for permission prompts
const QUESTION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours for user questions

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
  ): Promise<{
    behavior: "allow" | "deny";
    message?: string;
    toolUseID?: string;
    updatedInput?: Record<string, unknown>;
  }> => {
    console.error(`[queen] canUseTool called: ${toolName}`);

    // --- Handle AskUserQuestion as interactive Discord UI ---
    if (toolName === "AskUserQuestion") {
      return handleAskUserQuestion(thread, input, options.toolUseID);
    }

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

async function handleAskUserQuestion(
  thread: ThreadChannel,
  input: Record<string, unknown>,
  toolUseID: string,
): Promise<{
  behavior: "allow" | "deny";
  message?: string;
  toolUseID?: string;
  updatedInput?: Record<string, unknown>;
}> {
  const questions = (input.questions as any[]) ?? [];
  const answers: Record<string, string> = {};

  for (const q of questions) {
    const questionText: string = q.question ?? "Choose an option:";
    const opts: { label: string; description: string }[] = q.options ?? [];

    // Build buttons for each option + "Other" for free text
    const buttons = opts.map((opt: any, i: number) =>
      new ButtonBuilder()
        .setCustomId(`q_opt_${i}`)
        .setLabel(truncate(opt.label, 80))
        .setStyle(ButtonStyle.Primary),
    );
    buttons.push(
      new ButtonBuilder()
        .setCustomId("q_opt_other")
        .setLabel("Other...")
        .setStyle(ButtonStyle.Secondary),
    );

    // Build description text showing option details
    const optDetails = opts
      .map((opt: any) => `**${opt.label}** \u2014 ${opt.description}`)
      .join("\n");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

    const msg = await thread.send({
      content: `**${questionText}**\n${optDetails}`,
      components: [row],
    });

    try {
      const click = await msg.awaitMessageComponent({
        filter: (i) => i.customId.startsWith("q_opt_"),
        time: QUESTION_TIMEOUT_MS,
      });

      if (click.customId === "q_opt_other") {
        await click.update({
          content: `**${questionText}**\n${optDetails}\n\n*Type your answer below:*`,
          components: [],
        });

        // Wait for the next text message in the thread
        const collected = await thread.awaitMessages({
          filter: (m) => !m.author.bot,
          max: 1,
          time: QUESTION_TIMEOUT_MS,
        });

        const reply = collected.first()?.content ?? "No answer provided";
        answers[questionText] = reply;
        await thread
          .send(`Selected: **${reply}**`)
          .catch(() => {});
      } else {
        const idx = parseInt(click.customId.replace("q_opt_", ""), 10);
        const selected = opts[idx]?.label ?? "Unknown";
        answers[questionText] = selected;

        await click.update({
          content: `**${questionText}**\nSelected: **${selected}**`,
          components: [],
        });
      }
    } catch {
      await msg
        .edit({ content: `**Timed out**: ${questionText}`, components: [] })
        .catch(() => {});
      return {
        behavior: "deny",
        message: "Question timed out",
        toolUseID,
      };
    }
  }

  return {
    behavior: "allow",
    toolUseID,
    updatedInput: { ...input, answers },
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
