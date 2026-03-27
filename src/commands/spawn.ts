import {
  ChatInputCommandInteraction,
  ChannelType,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { existsSync } from "fs";
import { resolve } from "path";
import { spawnPawn, canSpawn } from "../sessions/manager";
import { truncate, shortModel } from "../utils/discord";
import { downloadAttachments } from "../utils/attachments";

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
  .addAttachmentOption((opt) =>
    opt
      .setName("image")
      .setDescription("Attach an image or file for Claude to see"),
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

  const check = canSpawn();
  if (!check.ok) {
    await interaction.reply({ content: check.reason!, flags: 64 });
    return;
  }

  await interaction.deferReply();

  try {
    const thread = await (channel as TextChannel).threads.create({
      name: truncate(interaction.options.getString("name") ?? prompt, 95),
      type: ChannelType.PublicThread,
      autoArchiveDuration: 1440,
    });

    const model = interaction.options.getString("model") ?? undefined;
    const effort = interaction.options.getString("effort") ?? undefined;

    // Build prompt with optional attachment
    let fullPrompt = prompt;
    const attachment = interaction.options.getAttachment("image");
    if (attachment) {
      const paths = await downloadAttachments([attachment]);
      if (paths.length > 0) {
        fullPrompt += `\n\n[Attached file: ${paths[0]}] — use the Read tool to view this file`;
      }
    }

    const resolved = spawnPawn(thread, cwd, fullPrompt, null, null, { model, effort });

    const modelLabel = shortModel(resolved.model);
    const effortLabel = resolved.effort ?? "default";
    await thread.send(
      `**Prompt:** ${prompt}\n**Directory:** \`${cwd}\`\n**Model:** ${modelLabel} | **Effort:** ${effortLabel}\n\u2500\u2500\u2500`,
    );

    await interaction.editReply(`Pawn spawned \u2192 ${thread}`);
  } catch (err: any) {
    await interaction.editReply(
      `Failed to spawn pawn: ${err.message?.slice(0, 1800)}`,
    );
  }
}
