import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getPawn, setPawnModel } from "../sessions/manager";

export const data = new SlashCommandBuilder()
  .setName("model")
  .setDescription("Switch model for this thread's session")
  .addStringOption((opt) =>
    opt
      .setName("value")
      .setDescription("Model to switch to")
      .setRequired(true)
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

  const value = interaction.options.getString("value", true);

  if (setPawnModel(channel.id, value)) {
    const short = value.replace("claude-", "").replace(/-\d.*/, "");
    await interaction.reply(`Model switched to **${short}**. Takes effect on next message.`);
  } else {
    await interaction.reply({
      content: "No active session in this thread.",
      flags: 64,
    });
  }
}
