import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { listProjects, getProject, getSessionRecord } from "../db/queries";
import { getPawn } from "../sessions/manager";

const GLOBAL_COMMANDS_DIR = join(homedir(), ".claude", "commands");

export const data = new SlashCommandBuilder()
  .setName("commands")
  .setDescription("List Claude commands available in a project")
  .addStringOption((opt) =>
    opt
      .setName("project")
      .setDescription("Project name (inferred from thread if omitted)")
      .setRequired(false)
      .setAutocomplete(true),
  );

export async function autocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const projects = listProjects();
  const filtered = projects
    .filter((p) => p.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((p) => ({ name: p.name, value: p.name }));
  await interaction.respond(filtered);
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // Resolve cwd: thread context first, then explicit project option
  const cwdInfo = resolveCwd(interaction);
  if (!cwdInfo) {
    await interaction.reply({
      content:
        "Use this inside a pawn thread, or pass a `project` name.",
      flags: 64,
    });
    return;
  }

  const { cwd, label } = cwdInfo;
  const projectCommands = loadCommands(join(cwd, ".claude", "commands"));
  const globalCommands = loadCommands(GLOBAL_COMMANDS_DIR).filter(
    (g) => !projectCommands.some((p) => p.name === g.name),
  );

  if (projectCommands.length === 0 && globalCommands.length === 0) {
    await interaction.reply({
      content: `No commands found for **${label}**.\nAdd \`.md\` files to \`${cwd}/.claude/commands/\` or \`~/.claude/commands/\`.`,
      flags: 64,
    });
    return;
  }

  const renderCommand = ({ name, hints }: ClaudeCommand) => {
    const [description, ...rest] = hints;
    const header = description ? `**/${name}** — ${description}` : `**/${name}**`;
    return [header, ...rest.map((h) => `  *${h}*`)];
  };

  const lines: string[] = [];
  if (projectCommands.length > 0) {
    lines.push(`**Project commands for ${label}** (\`${cwd}/.claude/commands/\`)`, "");
    lines.push(...projectCommands.flatMap(renderCommand));
  }
  if (globalCommands.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`**Global commands** (\`~/.claude/commands/\`)`, "");
    lines.push(...globalCommands.flatMap(renderCommand));
  }
  lines.push("", "*Run these by typing \`/<command> [args]\` in the thread.*");

  await interaction.reply({ content: lines.join("\n"), flags: 64 });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveCwd(
  interaction: ChatInputCommandInteraction,
): { cwd: string; label: string } | null {
  // Explicit project option takes precedence
  const projectName = interaction.options.getString("project");
  if (projectName) {
    const project = getProject(projectName);
    if (!project) return null;
    return { cwd: project.path, label: projectName };
  }

  // Infer from thread context
  const channel = interaction.channel;
  if (channel?.isThread()) {
    const threadId = channel.id;

    const pawn = getPawn(threadId);
    if (pawn) return { cwd: pawn.cwd, label: pawn.projectName ?? pawn.cwd };

    const session = getSessionRecord(threadId);
    if (session) {
      return {
        cwd: session.cwd,
        label: session.project_name ?? session.cwd,
      };
    }
  }

  return null;
}

interface ClaudeCommand {
  name: string;
  hints: string[]; // first 3 non-blank, non-heading lines
}

function loadCommands(commandsDir: string): ClaudeCommand[] {
  if (!existsSync(commandsDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(commandsDir);
  } catch {
    return [];
  }

  const commands: ClaudeCommand[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    const name = entry.slice(0, -3);
    try {
      const content = readFileSync(join(commandsDir, entry), "utf-8");
      commands.push({ name, hints: meaningfulLines(content, 3) });
    } catch {
      commands.push({ name, hints: [] });
    }
  }
  return commands;
}

function meaningfulLines(content: string, max: number): string[] {
  const results: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      results.push(trimmed);
      if (results.length >= max) break;
    }
  }
  return results;
}
