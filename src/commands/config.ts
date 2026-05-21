import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getConfig, setConfig, getAllConfig } from "../db/queries";
import { getBackend, setBackend, applyBackendEnv } from "../sessions/backend";

const VALID_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "opus",
  "sonnet",
  "haiku",
];

const VALID_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

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
          .setDescription("Model name (e.g. opus, sonnet, haiku, claude-opus-4-7)")
          .setRequired(true)
          .addChoices(
            { name: "opus (claude-opus-4-7)", value: "claude-opus-4-7" },
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
            { name: "xhigh", value: "xhigh" },
            { name: "max", value: "max" },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("backend")
      .setDescription("Switch the API backend (use 'bedrock' as a fallback during Anthropic outages)")
      .addStringOption((opt) =>
        opt
          .setName("value")
          .setDescription("Backend to use for new sessions")
          .setRequired(true)
          .addChoices(
            { name: "anthropic (direct API)", value: "anthropic" },
            { name: "bedrock (AWS fallback)", value: "bedrock" },
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
    case "backend": {
      const value = interaction.options.getString("value", true) as
        | "anthropic"
        | "bedrock";
      setBackend(value);
      applyBackendEnv();
      const note =
        value === "bedrock"
          ? "\n*New sessions will route through AWS Bedrock. Existing sessions are unaffected. Switch back with `/config backend anthropic` when the outage is over.*"
          : "";
      await interaction.reply(`Backend set to **${value}**${note}`);
      break;
    }
    case "show": {
      const cfg = getAllConfig();
      const model = cfg.default_model ?? "*(not set — uses Claude Code default)*";
      const effort = cfg.default_effort ?? "*(not set — uses Claude Code default)*";
      const backend = getBackend();
      await interaction.reply(
        `**Current config:**\nBackend: ${backend}\nModel: ${model}\nEffort: ${effort}`,
      );
      break;
    }
  }
}
