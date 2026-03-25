import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getPawn, stopPawn } from "../sessions/manager";

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop the active pawn session (resumable by replying in thread)");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channel = interaction.channel;

  if (!channel?.isThread()) {
    await interaction.reply({
      content: "Run `/stop` inside a pawn thread.",
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

  stopPawn(channel.id);
  await interaction.reply("Session stopped. Reply in this thread to resume.");
}
