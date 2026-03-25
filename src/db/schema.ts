import Database from "better-sqlite3";

const DB_PATH = process.env.QUEEN_DB_PATH || "./queen.db";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      thread_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      project_name TEXT,
      cwd TEXT NOT NULL,
      prompt TEXT NOT NULL,
      session_id TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      FOREIGN KEY (project_name) REFERENCES projects(name) ON DELETE SET NULL
    );
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
