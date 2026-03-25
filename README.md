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

If you've never created a Discord bot before, see Discord's [Getting Started](https://discord.com/developers/docs/getting-started) guide and [Developer Portal documentation](https://discord.com/developers/docs/intro) for full context.

### 1. Create the Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it (e.g. "Queen")
3. On the **General Information** page, copy the **Application ID** and paste it as `DISCORD_APP_ID` in your `.env`

> See [Setting Up a Bot Application](https://discord.com/developers/docs/quick-start/getting-started#setting-up-a-bot-application) for more details.

### 2. Configure the Bot

1. Go to the **Bot** tab in the left sidebar
2. Click **Reset Token**, copy the token, and paste it as `DISCORD_BOT_TOKEN` in your `.env`
   - This is the only time the token is shown -- store it securely
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** -- required for reading thread replies

> See Discord's docs on [Gateway Intents](https://discord.com/developers/docs/events/gateway#gateway-intents) and [Privileged Intents](https://discord.com/developers/docs/events/gateway#privileged-intents) for background.

### 3. Invite the Bot to Your Server

1. Go to **OAuth2 > URL Generator** in the left sidebar
2. Under **Scopes**, select:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, select:

| Permission | Why |
|---|---|
| View Channels | See channels to interact with |
| Send Messages | Post responses in channels |
| Create Public Threads | Create a thread for each pawn session |
| Send Messages in Threads | Stream Claude's output into threads |
| Manage Threads | Archive/unarchive threads on session end/resume |
| Read Message History | Read context in threads the bot joins |
| Embed Links | Format links in responses |
| Add Reactions | React with hourglass when messages are queued |
| Use Slash Commands | Register and respond to slash commands |

4. Copy the generated URL at the bottom of the page
5. Open it in your browser and select which server to add the bot to

> See [Adding Your Bot to a Server](https://discord.com/developers/docs/quick-start/getting-started#adding-your-app-to-a-server) for more details.

### 4. Guild ID (recommended for development)

Without a guild ID, slash commands register globally and can take up to an hour to propagate. With a guild ID, they're available instantly.

1. In Discord, go to **Settings > Advanced** and enable **Developer Mode** ([docs](https://support-dev.discord.com/hc/en-us/articles/27698853506327-How-to-Enable-Developer-Mode))
2. Right-click your server name in the sidebar > **Copy Server ID**
3. Paste it as `DISCORD_GUILD_ID` in your `.env`

> See Discord's docs on [Registering Commands](https://discord.com/developers/docs/interactions/application-commands#registering-a-command) for the difference between guild and global commands.

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

## Running with systemd

To run Queen as a persistent service, create a user-level systemd unit:

```bash
mkdir -p ~/.config/systemd/user
```

Create `~/.config/systemd/user/queen.service`:

```ini
[Unit]
Description=Queen Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/queen
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=on-failure
RestartSec=10
EnvironmentFile=/path/to/queen/.env

# Ensure Claude Code and other tools are on PATH
Environment=PATH=/home/%u/.deno/bin:/home/%u/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=/home/%u
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

Update `WorkingDirectory`, `EnvironmentFile`, and `PATH` to match your setup, then enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable queen
systemctl --user start queen

# Check status and logs
systemctl --user status queen
journalctl --user -u queen -f
```

> **Note:** User-level services only run while you're logged in unless you enable lingering: `sudo loginctl enable-linger $USER`

## Tech Stack

- **TypeScript** with [tsx](https://github.com/privatenumber/tsx) for execution
- **[Discord.js](https://discord.js.org/) v14** for the bot
- **[@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)** for spawning Claude Code sessions
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** for session history and project registry

## License

[MIT](LICENSE)
