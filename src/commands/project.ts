import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
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
  setProjectDefaults,
} from "../db/queries";
import { spawnPawn, canSpawn } from "../sessions/manager";
import { truncate, shortModel, chunkMessage } from "../utils/discord";
import { downloadAttachments } from "../utils/attachments";

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
        opt.setName("name").setDescription("Project name").setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("spawn")
      .setDescription("Spawn a pawn in a registered project")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Project name").setRequired(true).setAutocomplete(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("prompt")
          .setDescription("Initial prompt for Claude")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("thread_name")
          .setDescription("Custom thread name"),
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
      .addAttachmentOption((opt) =>
        opt
          .setName("image")
          .setDescription("Attach an image or file for Claude to see"),
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
  )
  .addSubcommand((sub) =>
    sub
      .setName("config")
      .setDescription("Set default model/effort for a project")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Project name").setRequired(true).setAutocomplete(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("model")
          .setDescription("Default model for this project")
          .addChoices(
            { name: "opus", value: "claude-opus-4-6" },
            { name: "sonnet", value: "claude-sonnet-4-6" },
            { name: "haiku", value: "claude-haiku-4-5" },
            { name: "clear", value: "clear" },
          ),
      )
      .addStringOption((opt) =>
        opt
          .setName("effort")
          .setDescription("Default effort for this project")
          .addChoices(
            { name: "low", value: "low" },
            { name: "medium", value: "medium" },
            { name: "high", value: "high" },
            { name: "max", value: "max" },
            { name: "clear", value: "clear" },
          ),
      ),
  );

export async function autocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const projects = listProjects();
  const filtered = projects
    .filter((p) => p.name.toLowerCase().includes(focused))
    .slice(0, 25) // Discord max 25 choices
    .map((p) => ({ name: p.name, value: p.name }));
  await interaction.respond(filtered);
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case "add":
      return handleAdd(interaction);
    case "config":
      return handleConfig(interaction);
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

  const lines = projects.map((p) => {
    let line = `**${p.name}** \u2014 \`${p.path}\``;
    const extras: string[] = [];
    if (p.default_model) extras.push(p.default_model.replace("claude-", "").replace(/-\d.*/, ""));
    if (p.default_effort) extras.push(p.default_effort);
    if (extras.length > 0) line += ` (${extras.join(", ")})`;
    return line;
  });
  const chunks = chunkMessage(lines.join("\n"));
  await interaction.reply({ content: chunks[0], flags: 64 });
  for (const chunk of chunks.slice(1)) {
    await interaction.followUp({ content: chunk, flags: 64 });
  }
}

async function handleConfig(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const name = interaction.options.getString("name", true);
  const project = getProject(name);

  if (!project) {
    await interaction.reply({
      content: `Project **${name}** not found.`,
      flags: 64,
    });
    return;
  }

  const model = interaction.options.getString("model");
  const effort = interaction.options.getString("effort");

  if (model === null && effort === null) {
    // Show current config
    const m = project.default_model ?? "*(global default)*";
    const e = project.default_effort ?? "*(global default)*";
    await interaction.reply(`**${name}** config:\nModel: ${m}\nEffort: ${e}`);
    return;
  }

  // Update — "clear" means remove override, null means don't change
  const newModel = model === "clear" ? null : (model ?? project.default_model);
  const newEffort = effort === "clear" ? null : (effort ?? project.default_effort);
  setProjectDefaults(name, newModel, newEffort);

  const parts: string[] = [];
  if (model !== null) parts.push(`model: **${model === "clear" ? "cleared" : model}**`);
  if (effort !== null) parts.push(`effort: **${effort === "clear" ? "cleared" : effort}**`);
  await interaction.reply(`Updated **${name}** \u2014 ${parts.join(", ")}`);
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

  const check = canSpawn();
  if (!check.ok) {
    await interaction.reply({ content: check.reason!, flags: 64 });
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
      name: truncate(interaction.options.getString("thread_name") ?? `${name}: ${prompt}`, 95),
      type: ChannelType.PublicThread,
      autoArchiveDuration: 1440,
    });

    const model = interaction.options.getString("model") ?? undefined;
    const effort = interaction.options.getString("effort") ?? undefined;

    let fullPrompt = prompt;
    const attachment = interaction.options.getAttachment("image");
    if (attachment) {
      const paths = await downloadAttachments([attachment]);
      if (paths.length > 0) {
        fullPrompt += `\n\n[Attached file: ${paths[0]}] — use the Read tool to view this file`;
      }
    }

    const resolved = spawnPawn(thread, project.path, fullPrompt, name, null, { model, effort });

    const modelLabel = shortModel(resolved.model);
    const effortLabel = resolved.effort ?? "default";
    await thread.send(
      `**Project:** ${name}\n**Prompt:** ${prompt}\n**Directory:** \`${project.path}\`\n**Model:** ${modelLabel} | **Effort:** ${effortLabel}\n\u2500\u2500\u2500`,
    );

    await interaction.editReply(`Pawn spawned \u2192 ${thread}`);
  } catch (err: any) {
    await interaction.editReply(
      `Failed to spawn pawn: ${err.message?.slice(0, 1800)}`,
    );
  }
}
