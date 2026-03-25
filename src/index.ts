import "dotenv/config";
import { createClient } from "./bot";
import { closeDb } from "./db/schema";

// Validate required env vars
const required = ["DISCORD_BOT_TOKEN", "DISCORD_APP_ID"] as const;
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[queen] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// Initialize the database and mark any stale sessions from a previous run
import { getDb } from "./db/schema";
import { markStaleSessions } from "./db/queries";
getDb();
const stale = markStaleSessions();
if (stale > 0) {
  console.log(`[queen] Marked ${stale} stale session(s) as interrupted`);
}

// Start the bot
const client = createClient();
client.login(process.env.DISCORD_BOT_TOKEN);

// Graceful shutdown
function shutdown() {
  console.log("[queen] Shutting down...");
  client.destroy();
  closeDb();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
