const Database = require('better-sqlite3')
const path = require('path')

const db = new Database(path.join(__dirname, 'sessions.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    claude_session_id TEXT PRIMARY KEY,
    workspace_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

function saveSession(claudeSessionId, workspacePath) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (claude_session_id, workspace_path, last_used_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `)
  stmt.run(claudeSessionId, workspacePath)
}

function getSession(claudeSessionId) {
  const stmt = db.prepare('SELECT * FROM sessions WHERE claude_session_id = ?')
  return stmt.get(claudeSessionId)
}

module.exports = { saveSession, getSession }