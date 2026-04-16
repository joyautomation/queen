import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { listProjects, getProject } from "../db/queries";

export const data = new SlashCommandBuilder()
  .setName("skills")
  .setDescription("List skills available for a registered project")
  .addStringOption((opt) =>
    opt
      .setName("project")
      .setDescription("Project name")
      .setRequired(true)
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
  const name = interaction.options.getString("project", true);
  const project = getProject(name);

  if (!project) {
    await interaction.reply({
      content: `Project **${name}** not found.`,
      flags: 64,
    });
    return;
  }

  const skills = loadSkills(project.path);

  if (skills.length === 0) {
    await interaction.reply({
      content: `No skills found for **${name}**.\nAdd skills to \`${project.path}/.claude/skills/\`.`,
      flags: 64,
    });
    return;
  }

  const lines = [
    `**Skills for ${name}** (\`${project.path}/.claude/skills/\`)`,
    "",
    ...skills.map(({ name: skillName, description, userInvocable }) => {
      const invoke = userInvocable ? " — *user-invocable*" : "";
      const desc = description ? `\n  ${description}` : "";
      return `**/${skillName}**${invoke}${desc}`;
    }),
  ];

  await interaction.reply(lines.join("\n"));
}

interface Skill {
  name: string;
  description: string;
  userInvocable: boolean;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    result[key] = value;
  }
  return result;
}

function loadSkills(projectPath: string): Skill[] {
  const skillsDir = join(projectPath, ".claude", "skills");
  if (!existsSync(skillsDir)) return [];

  const skills: Skill[] = [];
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }

  for (const entry of entries.sort()) {
    const skillFile = join(skillsDir, entry, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    try {
      const content = readFileSync(skillFile, "utf-8");
      const fm = parseFrontmatter(content);
      skills.push({
        name: fm.name ?? entry,
        description: fm.description ?? "",
        userInvocable: fm["user-invocable"] === "true",
      });
    } catch {
      // Skip unreadable files
    }
  }

  return skills;
}
