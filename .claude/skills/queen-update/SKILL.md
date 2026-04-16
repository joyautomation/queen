---
name: queen-update
description: Use when updating queen's dependencies (especially @anthropic-ai/claude-agent-sdk), running npm install in queen, or any change to queen's source that needs to take effect in the running bot. Triggers on phrases like "update the SDK", "upgrade queen", "bump dependency", "deploy queen", "restart queen", or after editing files under /home/joyja/Development/joyautomation/queen/src.
version: 1.0.0
---

# Queen Update & Restart

Queen runs as a systemd user service (`queen.service`) that does NOT auto-reload on file changes. After modifying source or upgrading dependencies, the service must be restarted manually for changes to take effect.

## When this skill applies

- Updating any dependency in `/home/joyja/Development/joyautomation/queen/package.json`
- Running `npm install` or `npm update` in queen
- Editing files in `/home/joyja/Development/joyautomation/queen/src/**`
- User asks to "deploy", "restart", or "reload" queen

## Required workflow

After making changes, run these steps in order:

### 1. Type-check
```
npx tsc --noEmit
```
Run from `/home/joyja/Development/joyautomation/queen`. Fix any errors before restarting — queen uses `tsx` so type errors won't block startup, but they will surface as runtime crashes.

### 2. Check for active sessions BEFORE restarting
```
node -e "const db=require('better-sqlite3')('/home/joyja/Development/joyautomation/queen/queen.db'); console.log(db.prepare(\"SELECT thread_id, project_name, status FROM sessions WHERE status='running'\").all());"
```

If there are running sessions:
- The shutdown handler in `src/index.ts` calls `stopPawn()` on each active pawn before exit, marking them `stopped` (resumable by replying in thread).
- This is safe — sessions are aborted cleanly via the SDK's AbortController.
- Still, **tell the user** what's about to happen before restarting if there's anything running. They may want to wait.

### 3. Restart
```
systemctl --user restart queen.service
```

### 4. Verify
```
sleep 2 && systemctl --user status queen.service --no-pager | head -20
```

Look for:
- `Active: active (running)`
- `[queen] Logged in as Queen#...`
- `[queen] Registered N guild commands`

If you see `Marked N stale session(s) as interrupted` for sessions you expected to be `stopped`, the graceful shutdown handler may have regressed — check `src/index.ts` `shutdown()` function still iterates `listPawns()` and calls `stopPawn()`.

## Known gotcha

The graceful shutdown handler was added on 2026-04-08. Restarts BEFORE this date left running sessions in `error`/`killed` state (not resumable). The current handler in `src/index.ts:28` calls `stopPawn()` on every active pawn, which marks them `stopped` — resumable via thread reply.

## Service location

- Unit file: `/home/joyja/.config/systemd/user/queen.service`
- Working directory: `/home/joyja/Development/joyautomation/queen`
- DB: `/home/joyja/Development/joyautomation/queen/queen.db`
- Logs: `journalctl --user -u queen.service -f`
