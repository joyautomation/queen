import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getSessionRecord } from "../db/queries";
import { getPawn, sendFollowUp } from "../sessions/manager";

const GLOBAL_COMMANDS_DIR = join(homedir(), ".claude", "commands");

export const data = new SlashCommandBuilder()
  .setName("run")
  .setDescription("Run a Claude command in the current pawn thread")
  .addStringOption((opt) =>
    opt
      .setName("command")
      .setDescription("Command name (autocompletes from project commands)")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("args")
      .setDescription("Arguments to pass to the command")
      .setRequired(false),
  );

export async function autocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.respond([]);
    return;
  }

  const cwd = resolveThreadCwd(channel.id);
  if (!cwd) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused().toLowerCase();
  const names = listCommandNames(cwd);
  const filtered = names
    .filter((n) => n.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((n) => ({ name: n, value: n }));

  await interaction.respond(filtered);
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.reply({
      content: "Use `/run` inside a pawn thread.",
      flags: 64,
    });
    return;
  }

  const pawn = getPawn(channel.id);
  if (!pawn) {
    await interaction.reply({
      content: "No active pawn in this thread.",
      flags: 64,
    });
    return;
  }

  const command = interaction.options.getString("command", true);
  const args = interaction.options.getString("args") ?? "";
  const prompt = args ? `/${command} ${args}` : `/${command}`;

  const { queued, error } = sendFollowUp(channel, prompt);

  if (error) {
    await interaction.reply({ content: error, flags: 64 });
    return;
  }

  const status = queued
    ? `Queued \`${prompt}\` (pawn is busy).`
    : `Sent \`${prompt}\` to pawn.`;

  await interaction.reply({ content: status, flags: 64 });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveThreadCwd(threadId: string): string | null {
  const pawn = getPawn(threadId);
  if (pawn) return pawn.cwd;

  const session = getSessionRecord(threadId);
  return session?.cwd ?? null;
}

function listCommandNames(projectPath: string): string[] {
  const dirs = [join(projectPath, ".claude", "commands"), GLOBAL_COMMANDS_DIR];
  const names = new Set<string>();

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith(".md")) names.add(entry.slice(0, -3));
      }
    } catch {
      // ignore
    }
  }

  return Array.from(names).sort();
}
