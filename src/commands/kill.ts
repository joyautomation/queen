import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { killPawn, getPawn } from "../sessions/manager";
import { getSessionRecord, endSessionRecord } from "../db/queries";

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
  if (pawn) {
    killPawn(channel.id);
    await interaction.reply("Pawn killed. Locking thread.");
    await channel.setLocked(true).catch(() => {});
    return;
  }

  // No active pawn — check if it's a dormant session in the DB
  const session = getSessionRecord(channel.id);
  if (session && session.status !== "killed") {
    endSessionRecord(channel.id, "killed");
    await interaction.reply("Dormant session killed. Locking thread.");
    await channel.setLocked(true).catch(() => {});
    return;
  }

  await interaction.reply({
    content: "No session found in this thread.",
    flags: 64,
  });
}
