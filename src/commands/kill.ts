import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { killPawn, getPawn } from "../sessions/manager";

export const data = new SlashCommandBuilder()
  .setName("kill")
  .setDescription("Kill the active pawn session in this thread");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channel = interaction.channel;

  if (!channel?.isThread()) {
    await interaction.reply({
      content: "Run `/kill` inside a pawn thread.",
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

  killPawn(channel.id);
  await interaction.reply("Pawn killed.");
}
