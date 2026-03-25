import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { listPawns } from "../sessions/manager";
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

  if (active.length === 0 && dormant.length === 0) {
    await interaction.reply({
      content: "No active or resumable pawns.",
      flags: 64,
    });
    return;
  }

  const lines: string[] = [];

  for (const p of active) {
    const uptime = formatDuration(Date.now() - p.startedAt.getTime());
    const icon = p.status === "running" ? "\u25b6\ufe0f" : "\u23f8\ufe0f";
    lines.push(
      `${icon} <#${p.threadId}> \u2014 \`${p.cwd}\` \u2014 ${uptime} \u2014 ${p.status}`,
    );
  }

  if (dormant.length > 0) {
    if (active.length > 0) lines.push("");
    lines.push(`**Dormant** (reply in thread to resume):`);
    for (const s of dormant) {
      const name = s.project_name ? `**${s.project_name}**` : `\`${s.cwd}\``;
      lines.push(`\ud83d\udca4 <#${s.thread_id}> \u2014 ${name}`);
    }
  }

  await interaction.reply(lines.join("\n"));
}
