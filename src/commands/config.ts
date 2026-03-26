import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getConfig, setConfig, getAllConfig } from "../db/queries";

const VALID_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "opus",
  "sonnet",
  "haiku",
];

const VALID_EFFORTS = ["low", "medium", "high", "max"];

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure Queen defaults")
  .addSubcommand((sub) =>
    sub
      .setName("model")
      .setDescription("Set the default model for new sessions")
      .addStringOption((opt) =>
        opt
          .setName("value")
          .setDescription("Model name (e.g. opus, sonnet, haiku, claude-opus-4-6)")
          .setRequired(true)
          .addChoices(
            { name: "opus (claude-opus-4-6)", value: "claude-opus-4-6" },
            { name: "sonnet (claude-sonnet-4-6)", value: "claude-sonnet-4-6" },
            { name: "haiku (claude-haiku-4-5)", value: "claude-haiku-4-5" },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("effort")
      .setDescription("Set the default effort level for new sessions")
      .addStringOption((opt) =>
        opt
          .setName("value")
          .setDescription("Effort level")
          .setRequired(true)
          .addChoices(
            { name: "low", value: "low" },
            { name: "medium", value: "medium" },
            { name: "high", value: "high" },
            { name: "max", value: "max" },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("show").setDescription("Show current configuration"),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case "model": {
      const value = interaction.options.getString("value", true);
      setConfig("default_model", value);
      await interaction.reply(`Default model set to **${value}**`);
      break;
    }
    case "effort": {
      const value = interaction.options.getString("value", true);
      setConfig("default_effort", value);
      await interaction.reply(`Default effort set to **${value}**`);
      break;
    }
    case "show": {
      const cfg = getAllConfig();
      const model = cfg.default_model ?? "*(not set — uses Claude Code default)*";
      const effort = cfg.default_effort ?? "*(not set — uses Claude Code default)*";
      await interaction.reply(
        `**Current config:**\nModel: ${model}\nEffort: ${effort}`,
      );
      break;
    }
  }
}
