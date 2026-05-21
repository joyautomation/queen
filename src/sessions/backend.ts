import { getConfig, setConfig } from "../db/queries";

export type Backend = "anthropic" | "bedrock";

// Capture the Bedrock model IDs at startup so we can restore them on backend swap.
// These are Bedrock inference profile IDs (e.g. "global.anthropic.claude-opus-4-7")
// and would be invalid if leaked to the Anthropic direct API.
const BEDROCK_MODEL = process.env.ANTHROPIC_MODEL;
const BEDROCK_SMALL_FAST_MODEL = process.env.ANTHROPIC_SMALL_FAST_MODEL;

export function getBackend(): Backend {
  return getConfig("backend") === "bedrock" ? "bedrock" : "anthropic";
}

export function setBackend(b: Backend): void {
  setConfig("backend", b);
}

/**
 * Sync process.env to the configured backend so the next query() picks it up.
 * Bedrock uses ANTHROPIC_MODEL / ANTHROPIC_SMALL_FAST_MODEL plus a Bedrock
 * API key (AWS_BEARER_TOKEN_BEDROCK) or standard AWS credentials, set in
 * queen's runtime env.
 */
export function applyBackendEnv(): Backend {
  const b = getBackend();
  if (b === "bedrock") {
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    if (BEDROCK_MODEL) process.env.ANTHROPIC_MODEL = BEDROCK_MODEL;
    if (BEDROCK_SMALL_FAST_MODEL) process.env.ANTHROPIC_SMALL_FAST_MODEL = BEDROCK_SMALL_FAST_MODEL;
  } else {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_SMALL_FAST_MODEL;
  }
  return b;
}
