import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ChannelType,
  TextChannel,
} from "discord.js";
import { existsSync } from "fs";
import { resolve } from "path";
import {
  addProject,
  removeProject,
  listProjects,
  getProject,
} from "../db/queries";
import { spawnPawn } from "../sessions/manager";
import { truncate } from "../utils/discord";

export const data = new SlashCommandBuilder()
  .setName("project")
  .setDescription("Manage registered project directories")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Register a project directory")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Project name").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("path")
          .setDescription("Absolute path to project directory")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List registered projects"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Unregister a project")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Project name").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("spawn")
      .setDescription("Spawn a pawn in a registered project")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Project name").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("prompt")
          .setDescription("Initial prompt for Claude")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("model")
          .setDescription("Model override (default: from /config)")
          .addChoices(
            { name: "opus", value: "claude-opus-4-6" },
            { name: "sonnet", value: "claude-sonnet-4-6" },
            { name: "haiku", value: "claude-haiku-4-5" },
          ),
      )
      .addStringOption((opt) =>
        opt
          .setName("effort")
          .setDescription("Effort override (default: from /config)")
          .addChoices(
            { name: "low", value: "low" },
            { name: "medium", value: "medium" },
            { name: "high", value: "high" },
            { name: "max", value: "max" },
          ),
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case "add":
      return handleAdd(interaction);
    case "list":
      return handleList(interaction);
    case "remove":
      return handleRemove(interaction);
    case "spawn":
      return handleSpawn(interaction);
  }
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const name = interaction.options.getString("name", true);
  const rawPath = interaction.options.getString("path", true);
  const projectPath = resolve(rawPath);

  if (!existsSync(projectPath)) {
    await interaction.reply({
      content: `Directory not found: \`${projectPath}\``,
      flags: 64,
    });
    return;
  }

  addProject(name, projectPath);
  await interaction.reply(`Project **${name}** registered at \`${projectPath}\``);
}

async function handleList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const projects = listProjects();

  if (projects.length === 0) {
    await interaction.reply({
      content: "No projects registered. Use `/project add` to register one.",
      flags: 64,
    });
    return;
  }

  const lines = projects.map((p) => `**${p.name}** \u2014 \`${p.path}\``);
  await interaction.reply(lines.join("\n"));
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const name = interaction.options.getString("name", true);

  if (removeProject(name)) {
    await interaction.reply(`Project **${name}** removed.`);
  } else {
    await interaction.reply({
      content: `Project **${name}** not found.`,
      flags: 64,
    });
  }
}

async function handleSpawn(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const name = interaction.options.getString("name", true);
  const prompt = interaction.options.getString("prompt", true);
  const project = getProject(name);

  if (!project) {
    await interaction.reply({
      content: `Project **${name}** not found. Use \`/project add\` first.`,
      flags: 64,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || channel.isThread() || !("threads" in channel)) {
    await interaction.reply({
      content: "Run this command in a text channel (not inside a thread).",
      flags: 64,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const thread = await (channel as TextChannel).threads.create({
      name: truncate(`${name}: ${prompt}`, 95),
      type: ChannelType.PublicThread,
      autoArchiveDuration: 1440,
    });

    await thread.send(
      `**Project:** ${name}\n**Prompt:** ${prompt}\n**Directory:** \`${project.path}\`\n\u2500\u2500\u2500`,
    );

    const model = interaction.options.getString("model") ?? undefined;
    const effort = interaction.options.getString("effort") ?? undefined;
    spawnPawn(thread, project.path, prompt, name, null, { model, effort });

    await interaction.editReply(`Pawn spawned \u2192 ${thread}`);
  } catch (err: any) {
    await interaction.editReply(
      `Failed to spawn pawn: ${err.message?.slice(0, 1800)}`,
    );
  }
}
