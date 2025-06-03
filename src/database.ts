import Database from 'better-sqlite3'
import path from 'path'

interface Session {
  claude_session_id: string
  workspace_path: string
  created_at: string
  last_used_at: string
}

const db = new Database(path.join(__dirname, '..', 'sessions.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    claude_session_id TEXT PRIMARY KEY,
    workspace_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

export function saveSession(claudeSessionId: string, workspacePath: string): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (claude_session_id, workspace_path, last_used_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `)
  stmt.run(claudeSessionId, workspacePath)
}

export function getSession(claudeSessionId: string): Session | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE claude_session_id = ?')
  return stmt.get(claudeSessionId) as Session | undefined
}
