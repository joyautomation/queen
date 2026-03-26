import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getPawn, setPawnEffort } from "../sessions/manager";

export const data = new SlashCommandBuilder()
  .setName("effort")
  .setDescription("Switch effort level for this thread's session")
  .addStringOption((opt) =>
    opt
      .setName("value")
      .setDescription("Effort level")
      .setRequired(true)
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
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.reply({
      content: "Run `/effort` inside a pawn thread.",
      flags: 64,
    });
    return;
  }

  const value = interaction.options.getString("value", true);

  if (setPawnEffort(channel.id, value)) {
    await interaction.reply(`Effort switched to **${value}**. Takes effect on next message.`);
  } else {
    await interaction.reply({
      content: "No active session in this thread.",
      flags: 64,
    });
  }
}
