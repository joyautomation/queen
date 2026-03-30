import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { listPawns, getMaxPawns } from "../sessions/manager";
import { getDormantSessions } from "../db/queries";
import { formatDuration } from "../utils/discord";

export const data = new SlashCommandBuilder()
  .setName("pawns")
  .setDescription("List all active pawn sessions");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const active = listPawns();
  const activeThreadIds = new Set(active.map((p) => p.threadId));

  // Dormant = in DB with a session_id, not ended, but not in-memory
  const dormant = getDormantSessions().filter(
    (s) => !activeThreadIds.has(s.thread_id),
  );

  const max = getMaxPawns();

  if (active.length === 0 && dormant.length === 0) {
    await interaction.reply({
      content: `No active or resumable pawns. (0/${max})`,
      flags: 64,
    });
    return;
  }

  const lines: string[] = [
    `**Active: ${active.length}/${max}**`,
  ];

  if (active.length > 0) {
    for (const p of active) {
      const uptime = formatDuration(Date.now() - p.startedAt.getTime());
      const icon = p.status === "running" ? "\u25b6\ufe0f" : "\u23f8\ufe0f";
      const name = p.projectName ?? "";
      lines.push(
        `${icon} <#${p.threadId}> ${name ? `(${name})` : ""} \u2014 ${uptime} \u2014 ${p.status}`,
      );
    }
  } else {
    lines.push("*None running*");
  }

  if (dormant.length > 0) {
    lines.push("");
    lines.push(`**Dormant: ${dormant.length}** (reply in thread to resume)`);
    for (const s of dormant) {
      const name = s.project_name ? `(${s.project_name})` : "";
      lines.push(`\ud83d\udca4 <#${s.thread_id}> ${name}`);
    }
  }

  await interaction.reply(lines.join("\n"));
}
