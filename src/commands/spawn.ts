import {
  ChatInputCommandInteraction,
  ChannelType,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { existsSync } from "fs";
import { resolve } from "path";
import { spawnPawn } from "../sessions/manager";
import { truncate } from "../utils/discord";

export const data = new SlashCommandBuilder()
  .setName("spawn")
  .setDescription("Spawn a Claude Code session in a new thread")
  .addStringOption((opt) =>
    opt
      .setName("path")
      .setDescription("Working directory for the session")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("prompt")
      .setDescription("Initial prompt for Claude")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("name")
      .setDescription("Custom thread name"),
  )
  .addStringOption((opt) =>
    opt
      .setName("model")
      .setDescription("Model override (default: from /config)")
      .addChoices(
        { name: "opus", value: "claude-opus-4-6" },
        { name: "sonnet", value: "claude-sonnet-4-6" },
        { name: "haiku", value: "claude-haiku-4-5" },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName("effort")
      .setDescription("Effort override (default: from /config)")
      .addChoices(
        { name: "low", value: "low" },
        { name: "medium", value: "medium" },
        { name: "high", value: "high" },
        { name: "max", value: "max" },
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const rawPath = interaction.options.getString("path", true);
  const prompt = interaction.options.getString("prompt", true);
  const cwd = resolve(rawPath);

  if (!existsSync(cwd)) {
    await interaction.reply({
      content: `Directory not found: \`${cwd}\``,
      flags: 64, // Ephemeral
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || channel.isThread() || !("threads" in channel)) {
    await interaction.reply({
      content: "Run this command in a text channel (not inside a thread).",
      flags: 64,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const thread = await (channel as TextChannel).threads.create({
      name: truncate(interaction.options.getString("name") ?? prompt, 95),
      type: ChannelType.PublicThread,
      autoArchiveDuration: 1440,
    });

    await thread.send(
      `**Prompt:** ${prompt}\n**Directory:** \`${cwd}\`\n\u2500\u2500\u2500`,
    );

    const model = interaction.options.getString("model") ?? undefined;
    const effort = interaction.options.getString("effort") ?? undefined;
    spawnPawn(thread, cwd, prompt, null, null, { model, effort });

    await interaction.editReply(`Pawn spawned \u2192 ${thread}`);
  } catch (err: any) {
    await interaction.editReply(
      `Failed to spawn pawn: ${err.message?.slice(0, 1800)}`,
    );
  }
}
