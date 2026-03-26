import { getDb } from "./schema";

// --- Config ---

export function getConfig(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM config WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setConfig(key: string, value: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)")
    .run(key, value);
}

export function getAllConfig(): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT key, value FROM config ORDER BY key")
    .all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export interface Project {
  name: string;
  path: string;
  created_at: string;
}

export interface SessionRecord {
  thread_id: string;
  channel_id: string;
  project_name: string | null;
  cwd: string;
  prompt: string;
  session_id: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
}

// --- Projects ---

export function addProject(name: string, projectPath: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO projects (name, path) VALUES (?, ?)")
    .run(name, projectPath);
}

export function removeProject(name: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM projects WHERE name = ?")
    .run(name);
  return result.changes > 0;
}

export function getProject(name: string): Project | undefined {
  return getDb()
    .prepare("SELECT * FROM projects WHERE name = ?")
    .get(name) as Project | undefined;
}

export function listProjects(): Project[] {
  return getDb()
    .prepare("SELECT * FROM projects ORDER BY name")
    .all() as Project[];
}

// --- Sessions ---

export function createSessionRecord(
  threadId: string,
  channelId: string,
  cwd: string,
  prompt: string,
  projectName: string | null,
): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO sessions (thread_id, channel_id, cwd, prompt, project_name) VALUES (?, ?, ?, ?, ?)",
    )
    .run(threadId, channelId, cwd, prompt, projectName);
}

export function updateSessionAgentId(
  threadId: string,
  sessionId: string,
): void {
  getDb()
    .prepare("UPDATE sessions SET session_id = ? WHERE thread_id = ?")
    .run(sessionId, threadId);
}

export function endSessionRecord(threadId: string, status: string): void {
  getDb()
    .prepare(
      "UPDATE sessions SET ended_at = datetime('now'), status = ? WHERE thread_id = ?",
    )
    .run(status, threadId);
}

export function getSessionRecord(
  threadId: string,
): SessionRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE thread_id = ?")
    .get(threadId) as SessionRecord | undefined;
}

export function addSessionCost(threadId: string, cost: number): void {
  getDb()
    .prepare("UPDATE sessions SET cost_usd = cost_usd + ? WHERE thread_id = ?")
    .run(cost, threadId);
}

/** Mark all sessions that were 'running' as 'interrupted' (bot crashed/restarted). */
export function markStaleSessions(): number {
  const result = getDb()
    .prepare(
      "UPDATE sessions SET status = 'interrupted' WHERE status = 'running'",
    )
    .run();
  return result.changes;
}

/** Get all sessions that are resumable (have a session_id, not killed). */
export function getDormantSessions(): SessionRecord[] {
  return getDb()
    .prepare(
      "SELECT * FROM sessions WHERE session_id IS NOT NULL AND status NOT IN ('killed', 'error') ORDER BY started_at DESC",
    )
    .all() as SessionRecord[];
}
