import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ChatInputCommandInteraction,
  Events,
  type Message,
  type Attachment,
} from "discord.js";
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { sendFollowUp, getPawn, spawnPawn } from "./sessions/manager";
import { getSessionRecord } from "./db/queries";
import { downloadAttachments } from "./utils/attachments";

import * as spawnCmd from "./commands/spawn";
import * as projectCmd from "./commands/project";
import * as killCmd from "./commands/kill";
import * as stopCmd from "./commands/stop";
import * as pawnsCmd from "./commands/pawns";
import * as usageCmd from "./commands/usage";

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

interface Command {
  data: { toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

const commands = new Map<string, Command>();
commands.set("spawn", spawnCmd);
commands.set("project", projectCmd);
commands.set("kill", killCmd);
commands.set("stop", stopCmd);
commands.set("pawns", pawnsCmd);
commands.set("usage", usageCmd);

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // --- Ready ---
  client.once(Events.ClientReady, async (c) => {
    console.log(`[queen] Logged in as ${c.user.tag}`);
    await registerCommands();
  });

  // --- Slash commands ---
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const cmd = commands.get(interaction.commandName);
    if (!cmd) return;

    try {
      await cmd.execute(interaction);
    } catch (err: any) {
      console.error(`[queen] Command error (${interaction.commandName}):`, err);
      const content = `Something went wrong: ${err.message?.slice(0, 1800)}`;
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: 64 }).catch(() => {});
      }
    }
  });

  // --- Thread follow-ups ---
  client.on(Events.MessageCreate, async (message) => {
    // Ignore bots, system messages, and non-thread messages
    if (message.author.bot) return;
    if (message.system) return;
    if (!message.channel.isThread()) return;

    const hasText = !!message.content?.trim();
    const hasAttachments = message.attachments.size > 0;
    if (!hasText && !hasAttachments) return;

    // Download any image/file attachments and build a prompt with file paths
    const prompt = await buildPromptWithAttachments(message);
    if (!prompt.trim()) return;

    const threadId = message.channel.id;
    const pawn = getPawn(threadId);

    // No live pawn — check if this was a previous session's thread
    if (!pawn) {
      const oldSession = getSessionRecord(threadId);
      if (!oldSession) return; // Not a pawn thread at all
      if (oldSession.status === "killed") return; // Explicitly killed — not resumable

      // Unarchive the thread if Discord archived it
      if (message.channel.archived) {
        await message.channel.setArchived(false).catch(() => {});
      }

      // Resume the old session if we have a session ID, otherwise start fresh
      const hasSession = !!oldSession.session_id;
      await message.channel.send(
        hasSession
          ? `Resuming previous session\u2026`
          : `Previous session had no history to resume. Starting a fresh one\u2026`,
      );
      try {
        spawnPawn(
          message.channel,
          oldSession.cwd,
          prompt,
          oldSession.project_name,
          oldSession.session_id,
        );
      } catch (err: any) {
        await message.reply(`Failed to respawn: ${err.message}`).catch(() => {});
      }
      return;
    }

    const { queued, error } = sendFollowUp(
      message.channel,
      prompt,
    );

    if (error) {
      await message.reply(error).catch(() => {});
      return;
    }

    if (queued) {
      await message.react("\u23f3").catch(() => {}); // hourglass
    }
  });

  return client;
}

// ---------------------------------------------------------------------------
// Slash command registration
// ---------------------------------------------------------------------------

async function registerCommands(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN!;
  const appId = process.env.DISCORD_APP_ID!;
  const guildId = process.env.DISCORD_GUILD_ID;

  const rest = new REST().setToken(token);
  const body = Array.from(commands.values()).map((c) => c.data.toJSON());

  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(appId, guildId), {
        body,
      });
      console.log(`[queen] Registered ${body.length} guild commands`);
    } else {
      await rest.put(Routes.applicationCommands(appId), { body });
      console.log(
        `[queen] Registered ${body.length} global commands (may take up to 1 hour to propagate)`,
      );
    }
  } catch (err) {
    console.error("[queen] Failed to register commands:", err);
  }
}

// ---------------------------------------------------------------------------
// Attachment handling
// ---------------------------------------------------------------------------

async function buildPromptWithAttachments(message: Message): Promise<string> {
  const parts: string[] = [];

  if (message.content?.trim()) {
    parts.push(message.content.trim());
  }

  if (message.attachments.size > 0) {
    const paths = await downloadAttachments(
      Array.from(message.attachments.values()),
    );
    if (paths.length > 0) {
      parts.push(
        paths
          .map((p) => `[Attached file: ${p}] — use the Read tool to view this file`)
          .join("\n"),
      );
    }
  }

  return parts.join("\n\n");
}
