import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getDb } from "../db/schema";

export const data = new SlashCommandBuilder()
  .setName("usage")
  .setDescription("Show Claude usage and rate limit status");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: 64 });

  try {
    // Spin up a minimal query just to grab rate limit info
    const session = query({
      prompt: "ok",
      options: { cwd: "/tmp", maxTurns: 1 },
    });

    const accountInfo = await session.accountInfo();

    let rateLimitInfo: any = null;
    for await (const msg of session) {
      if ((msg as any).type === "rate_limit_event") {
        rateLimitInfo = (msg as any).rate_limit_info;
      }
      if ((msg as any).type === "result") break;
    }

    // Build the response
    const lines: string[] = [];

    // Account info
    lines.push(`**Account:** ${accountInfo?.email ?? "unknown"}`);
    lines.push(`**Plan:** ${accountInfo?.subscriptionType ?? "unknown"}`);
    lines.push("");

    // Rate limit info
    if (rateLimitInfo) {
      const statusEmoji =
        rateLimitInfo.status === "allowed"
          ? "\u2705"
          : rateLimitInfo.status === "allowed_warning"
            ? "\u26a0\ufe0f"
            : "\u274c";

      lines.push(`**Status:** ${statusEmoji} ${rateLimitInfo.status}`);

      if (rateLimitInfo.utilization != null) {
        const pct = Math.round(rateLimitInfo.utilization * 100);
        const bar = buildBar(rateLimitInfo.utilization);
        lines.push(`**Window usage:** ${bar} ${pct}%`);
      }

      if (rateLimitInfo.rateLimitType) {
        const typeLabel: Record<string, string> = {
          five_hour: "5-hour window",
          seven_day: "7-day window",
          seven_day_opus: "7-day Opus window",
          seven_day_sonnet: "7-day Sonnet window",
          overage: "Overage",
        };
        lines.push(
          `**Window type:** ${typeLabel[rateLimitInfo.rateLimitType] ?? rateLimitInfo.rateLimitType}`,
        );
      }

      if (rateLimitInfo.resetsAt) {
        const resetDate = new Date(rateLimitInfo.resetsAt * 1000);
        const now = Date.now();
        const diffMs = resetDate.getTime() - now;
        if (diffMs > 0) {
          const hours = Math.floor(diffMs / 3600000);
          const mins = Math.floor((diffMs % 3600000) / 60000);
          lines.push(`**Resets in:** ${hours}h ${mins}m`);
        } else {
          lines.push(`**Resets:** now`);
        }
      }

      if (rateLimitInfo.isUsingOverage) {
        lines.push(`**Overage:** active`);
      }

      if (rateLimitInfo.surpassedThreshold != null) {
        lines.push(
          `**Threshold surpassed:** ${Math.round(rateLimitInfo.surpassedThreshold * 100)}%`,
        );
      }
    } else {
      lines.push("*No rate limit info available*");
    }

    // Queen session stats
    lines.push("");
    lines.push("**Queen Stats (all time):**");

    const stats = getDb()
      .prepare(
        `SELECT
          COUNT(*) as total_sessions,
          COUNT(CASE WHEN status = 'running' OR status = 'idle' OR status = 'interrupted' OR status = 'stopped' THEN 1 END) as resumable
        FROM sessions`,
      )
      .get() as any;

    lines.push(
      `Sessions: ${stats.total_sessions} total, ${stats.resumable} resumable`,
    );

    await interaction.editReply(lines.join("\n"));
  } catch (err: any) {
    await interaction.editReply(
      `Failed to fetch usage info: ${err.message?.slice(0, 500)}`,
    );
  }
}

function buildBar(utilization: number): string {
  const filled = Math.round(utilization * 10);
  const empty = 10 - filled;
  return `\`[${"#".repeat(filled)}${"-".repeat(empty)}]\``;
}
