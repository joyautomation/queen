# Queen

A Discord bot that manages multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions from Discord. One long-lived bot process, N ephemeral Claude Code sessions (pawns).

Runs on a desktop/server machine and authenticates through your existing Claude Code login (Max plan, no API key needed).

## How It Works

```
Discord                          Your Machine
------                          ------------
#general
  /project spawn tentacle        Queen (bot process)
     |                              |
     +---> [new thread] -----> spawns Claude Code session (pawn)
              |                     |  via @anthropic-ai/claude-agent-sdk
              |  <-- streams -------+
              |  output back
              |
           user replies -------> follow-up prompts
              |  <-- streams -------+
              |  response
```

- **Queen** -- the single Discord.js bot process, always running
- **Pawn** -- a Claude Code session tied to a Discord thread
- **Project** -- a registered directory path mapped to a name for quick access

## Features

- Spawn Claude Code sessions from Discord slash commands
- Each session runs in its own thread with full conversation history
- Auto permission mode with Discord button approvals for risky operations
- Sessions resume across bot restarts (conversation context preserved)
- Register project directories for quick access
- Concurrent sessions (configurable limit, default 5)
- MCP tool support (loads project-level MCP configurations)
- Message queuing when a pawn is busy

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (Max plan or API key)
- A Discord bot application ([setup guide below](#discord-bot-setup))

## Installation

```bash
git clone https://github.com/joyautomation/queen.git
cd queen
npm install
```

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

```env
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_APP_ID=your-application-id
DISCORD_GUILD_ID=your-server-id        # optional, for instant command registration
QUEEN_DB_PATH=./queen.db               # optional, default: ./queen.db
QUEEN_MAX_PAWNS=5                      # optional, default: 5
```

## Usage

```bash
# Start the bot
npm start

# Start with auto-reload during development
npm run dev
```

### Slash Commands

| Command | Where | Description |
|---|---|---|
| `/spawn <path> <prompt>` | Any channel | Spawn a pawn in a directory, creates a thread |
| `/project add <name> <path>` | Any channel | Register a named project directory |
| `/project list` | Any channel | Show registered projects |
| `/project remove <name>` | Any channel | Unregister a project |
| `/project spawn <name> <prompt>` | Any channel | Spawn a pawn in a registered project |
| `/kill` | Inside a thread | Kill the active pawn in this thread |
| `/pawns` | Any channel | List active and dormant (resumable) sessions |

### Thread Lifecycle

1. Run `/spawn` or `/project spawn` in a text channel
2. Queen creates a new thread and starts a Claude Code session
3. Claude's output streams into the thread, chunked for Discord's 2000-char limit
4. Reply in the thread to send follow-up prompts
5. If a tool needs approval, Queen posts Approve/Deny buttons
6. Session ends naturally or via `/kill`

### Session Resume

Sessions persist across bot restarts. If the bot goes down and comes back:

- Reply in any previous pawn thread and it resumes with full conversation history
- `/pawns` shows dormant (resumable) sessions
- No need to re-explain context -- the session picks up where it left off

### Permissions

Queen uses Claude Code's **auto** permission mode:

- Safe operations (file reads, local commands, test artifacts) run automatically
- Risky operations (force push, production deploys, external writes) surface as Discord buttons
- You get 5 minutes to Approve or Deny before it auto-denies

## Discord Bot Setup

### 1. Create the Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**, name it whatever you like
3. Copy the **Application ID** and paste it as `DISCORD_APP_ID` in `.env`

### 2. Create the Bot

1. Go to the **Bot** tab
2. Click **Reset Token**, copy it, paste as `DISCORD_BOT_TOKEN` in `.env`
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**

### 3. Invite the Bot

Go to **OAuth2 > URL Generator**:

**Scopes:** `bot`, `applications.commands`

**Bot Permissions:**
- View Channels
- Send Messages
- Create Public Threads
- Send Messages in Threads
- Manage Threads
- Read Message History
- Embed Links
- Add Reactions
- Use Slash Commands

Open the generated URL and select your server.

### 4. Guild ID (optional)

For instant slash command registration during development:

1. Enable Developer Mode in Discord (Settings > Advanced)
2. Right-click your server name > Copy Server ID
3. Set as `DISCORD_GUILD_ID` in `.env`

Without this, global commands can take up to an hour to propagate.

## Project Structure

```
queen/
├── src/
│   ├── index.ts              # Entry point, env validation, shutdown
│   ├── bot.ts                # Discord client, event routing, command registration
│   ├── commands/
│   │   ├── spawn.ts          # /spawn — start a session by path
│   │   ├── project.ts        # /project — add, list, remove, spawn
│   │   ├── kill.ts           # /kill — terminate a session
│   │   └── pawns.ts          # /pawns — list active and dormant sessions
│   ├── sessions/
│   │   ├── manager.ts        # Pawn lifecycle, Agent SDK integration, permissions
│   │   └── streamer.ts       # SDK messages → Discord message formatting
│   ├── db/
│   │   ├── schema.ts         # SQLite initialization
│   │   └── queries.ts        # Project and session CRUD
│   └── utils/
│       └── discord.ts        # Message chunking, formatting helpers
├── package.json
├── tsconfig.json
├── .env.example
└── queen-spec.md             # Original design spec
```

## Tech Stack

- **TypeScript** with [tsx](https://github.com/privatenumber/tsx) for execution
- **[Discord.js](https://discord.js.org/) v14** for the bot
- **[@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)** for spawning Claude Code sessions
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** for session history and project registry

## License

[MIT](LICENSE)
