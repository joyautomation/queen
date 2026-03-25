# Queen — Discord Bot for Managing Claude Code Sessions

## Overview

Queen is a Discord bot that manages multiple Claude Code sessions from Discord. One long-lived bot process, N ephemeral Claude Code sessions (pawns). Runs on a desktop dev machine, authenticates through existing Claude Code login (Max plan, no API key needed).

## Tech Stack

- **TypeScript** (Node.js or Bun)
- **Discord.js v14** for the bot
- **@anthropic-ai/claude-agent-sdk** for spawning and managing Claude Code sessions
- **SQLite** (via better-sqlite3 or drizzle) for session history and project registry persistence

## Core Concepts

- **Queen** — the single Discord.js bot process, always running
- **Pawn** — a Claude Code session spawned via the Agent SDK, tied to a Discord thread
- **Project** — a registered directory path mapped to a name for quick access

## Agent SDK Integration

Use the TypeScript Agent SDK `query()` function to spawn sessions:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

const session = query({
  prompt: userMessage,
  options: {
    cwd: projectPath,
    permissionMode: 'acceptEdits', // or use permission callbacks for Discord buttons
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob'],
    settingSources: ['project'], // pick up CLAUDE.md and project skills
  }
})

for await (const message of session) {
  // stream messages back to Discord thread
}
```

Use permission hook callbacks to surface approve/deny as Discord button components when `permissionMode` is not `acceptEdits`.

## Slash Commands

| Command | Context | Description |
|---|---|---|
| `/spawn <path> <prompt>` | Any channel | Spawn a pawn in `<path>`, create a thread, stream output |
| `/project add <name> <path>` | Any channel | Register a named project directory |
| `/project list` | Any channel | Show registered projects |
| `/project remove <name>` | Any channel | Unregister a project |
| `/<project-name> <prompt>` | Any channel | Shortcut — spawn a pawn in a registered project's directory |
| `/kill` | Inside a thread | Kill the active pawn in this thread |
| `/pawns` | Any channel | List all active pawns with status, thread, cwd, uptime |

## Thread Lifecycle

1. User runs `/spawn` or a project shortcut command
2. Bot creates a new Discord thread in the current channel
3. Bot spawns a Claude Code session via Agent SDK with `cwd` set to the target directory
4. Bot streams Agent SDK messages back to the thread, chunked for Discord's 2000 char limit
5. User replies in thread → fed as follow-up prompts to the running session (use the SDK's conversation/multi-turn support if available, otherwise spawn a new query with context)
6. Permission prompts from hooks → surfaced as Discord button components (Approve / Deny)
7. Session ends naturally (ResultMessage) or via `/kill` → bot posts a summary and archives the thread

## Message Handling

- Stream `AssistantMessage` content to Discord as it arrives
- Chunk messages at 2000 chars, preferring line breaks as split points
- Use Discord code blocks (```) for code content when detected
- Show a typing indicator while the pawn is working
- Tool use messages (file edits, bash commands) can be shown as compact embeds

## State Management

- **In-memory**: Map of `threadId → { session, cwd, startedAt, status }` for active pawns
- **SQLite**: 
  - `projects` table: `name`, `path`, `created_at`
  - `sessions` table: `thread_id`, `channel_id`, `project_name`, `cwd`, `prompt`, `started_at`, `ended_at`, `status`
  - Provides history and allows graceful handling of bot restarts

## File Structure

```
queen/
├── src/
│   ├── index.ts          # Entry point — start bot
│   ├── bot.ts            # Discord.js client setup, event handlers
│   ├── commands/         # Slash command definitions and handlers
│   │   ├── spawn.ts
│   │   ├── project.ts
│   │   ├── kill.ts
│   │   └── pawns.ts
│   ├── sessions/
│   │   ├── manager.ts    # Session lifecycle — spawn, track, kill
│   │   └── streamer.ts   # Agent SDK message → Discord message formatting
│   ├── db/
│   │   ├── schema.ts     # SQLite schema
│   │   └── queries.ts    # DB operations
│   └── utils/
│       └── discord.ts    # Message chunking, embed helpers
├── package.json
├── tsconfig.json
├── .env                  # DISCORD_BOT_TOKEN, DISCORD_APP_ID
└── README.md
```

## Configuration

Environment variables in `.env`:
- `DISCORD_BOT_TOKEN` — bot token from Discord developer portal
- `DISCORD_APP_ID` — application ID for slash command registration
- `QUEEN_DB_PATH` — path to SQLite DB file (default: `./queen.db`)
- `QUEEN_MAX_PAWNS` — max concurrent sessions (default: 5)

## Discord Bot Setup Requirements

Bot needs these gateway intents:
- `Guilds`
- `GuildMessages`
- `MessageContent`

Bot permissions:
- Send Messages
- Create Public Threads
- Send Messages in Threads
- Manage Threads
- Use Slash Commands
- Add Reactions

## MVP Scope

For the first version, just get these working:
1. `/project add` and `/project list`
2. `/spawn` with a path and prompt — creates thread, streams output
3. Reply-in-thread sends follow-up to the session
4. `/kill` to terminate a session
5. `/pawns` to see what's running

Defer to later:
- Permission button UI (start with `acceptEdits` mode)
- Dynamic slash commands per project name
- Session resume after bot restart
- File attachment handling
- Git diff summary on session end
