import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getPawn, setPawnModel } from "../sessions/manager";
import { shortModel } from "../utils/discord";

export const data = new SlashCommandBuilder()
  .setName("model")
  .setDescription("Switch or show model for this thread's session")
  .addStringOption((opt) =>
    opt
      .setName("value")
      .setDescription("Model to switch to (omit to show current)")
      .addChoices(
        { name: "opus", value: "claude-opus-4-6" },
        { name: "sonnet", value: "claude-sonnet-4-6" },
        { name: "haiku", value: "claude-haiku-4-5" },
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.reply({
      content: "Run `/model` inside a pawn thread.",
      flags: 64,
    });
    return;
  }

  const pawn = getPawn(channel.id);
  if (!pawn) {
    await interaction.reply({
      content: "No active session in this thread.",
      flags: 64,
    });
    return;
  }

  const value = interaction.options.getString("value");

  if (!value) {
    // Show current
    await interaction.reply({
      content: `Current model: **${shortModel(pawn.model)}** | Effort: **${pawn.effort ?? "default"}**`,
      flags: 64,
    });
    return;
  }

  setPawnModel(channel.id, value);
  await interaction.reply(
    `Model switched to **${shortModel(value)}**. Takes effect on next message.`,
  );
}
