# Claude Code Server

A streaming API server that provides HTTP access to Claude Code CLI functionality.

## Overview

Claude Code Server is a Fastify-based server that wraps the Claude Code CLI, providing a RESTful streaming API for interacting with Claude Code sessions. It manages workspaces and session persistence using SQLite.

## Tech Stack

- **Fastify** - Web framework
- **better-sqlite3** - SQLite operations
- **child_process** - Claude Code execution
- **Node.js fs/path** - File operations

## Project Structure

```
/home/kohei/workspace/claude-code-server/
├── package.json
├── server.js              # Fastify server
├── database.js           # SQLite management
├── session-manager.js    # Session & workspace management
├── claude-executor.js    # Claude Code execution
├── sessions.db          # SQLite file
└── Workspace/           # Working directories
    ├── session-abc123/  # Server-generated UUID
    └── session-def456/
```

## Database Schema

```sql
CREATE TABLE sessions (
  claude_session_id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Specification

### POST /api/claude

**Request Body:**
```json
{
  "query": "hello",
  "session_id": "9c88687a-61ce-4315-afd5-58b7d84ee68b",  // Optional (for new sessions)
  "dangerously-skip-permissions": true,                   // Optional
  "allowedTools": ["Bash", "Edit"],                      // Optional
  "disallowedTools": ["WebFetch"]                        // Optional
}
```

**Request Body Schema:**
```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": { "type": "string" },
    "session_id": { "type": "string" },
    "dangerously-skip-permissions": { "type": "boolean" },
    "allowedTools": { "type": "array", "items": { "type": "string" } },
    "disallowedTools": { "type": "array", "items": { "type": "string" } }
  }
}
```

**Response (Server-Sent Events):**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"system","subtype":"init","session_id":"9c88687a-61ce-4315-afd5-58b7d84ee68b","tools":["Task","Bash"...],"mcp_servers":[]}

data: {"type":"assistant","message":{"id":"msg_01545CVqvPPL9nn43Ah4WqB2","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[{"type":"text","text":"Hello! I'm Claude Code, ready to help you with software engineering tasks. What would you like me to work on?"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":0,"cache_read_input_tokens":13476,"output_tokens":28,"service_tier":"standard"},"ttftMs":1977},"session_id":"9c88687a-61ce-4315-afd5-58b7d84ee68b"}

data: {"type":"result","subtype":"success","cost_usd":0.00338106,"is_error":false,"duration_ms":2727,"duration_api_ms":4561,"num_turns":1,"result":"Hello! I'm Claude Code, ready to help you with software engineering tasks. What would you like me to work on?","total_cost":0.00338106,"session_id":"9c88687a-61ce-4315-afd5-58b7d84ee68b"}
```

## Claude Code Command Specifications

### New Session
```bash
claude -p --verbose --output-format stream-json "query"
```

### Resume Session
```bash
claude -p --verbose --resume <claude-session-id> --output-format stream-json "query"
```

### With Permission Options
```bash
claude -p --verbose --dangerously-skip-permissions --allowedTools "Bash,Edit" --disallowedTools "WebFetch" --output-format stream-json "query"
```

## Installation & Usage

### Prerequisites
- Node.js
- Claude Code CLI installed and configured
- Claude Code CLI available at `/home/kohei/.npm-global/bin/claude`

### Setup
```bash
npm install
npm start
```

The server starts on port 3000 and provides the `/api/claude` endpoint for Claude Code interactions.

### Example Usage

**New Session:**
```bash
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{"query": "Hello, Claude Code!"}' \
  -N
```

**Resume Session:**
```bash
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Continue from where we left off",
    "session_id": "9c88687a-61ce-4315-afd5-58b7d84ee68b"
  }' \
  -N
```

**With Permission Controls:**
```bash
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Create a new file",
    "dangerously-skip-permissions": true,
    "allowedTools": ["Bash", "Edit", "Write"],
    "disallowedTools": ["WebFetch", "WebSearch"]
  }' \
  -N
```

## Architecture

### Process Flow

#### New Session
1. Server creates workspace directory (`session-{uuid}/`)
2. Execute `claude -p --verbose --output-format stream-json "query"`
3. Extract Claude Code session_id from system init message
4. Save Claude Code session_id and workspace path to database
5. Stream all JSON messages directly to client

#### Session Resume
1. Validate Claude Code session_id in database
2. Retrieve workspace path from database
3. Execute `claude -p --verbose --resume <claude-session-id> --output-format stream-json "query"`
4. Update database with new session_id (Claude Code generates new ID on resume)
5. Stream all JSON messages directly to client

### Key Features

- **Session Persistence**: Claude Code session_ids are mapped to persistent workspaces
- **Workspace Isolation**: Each session has its own workspace directory with server-generated UUID
- **Streaming Response**: Direct streaming of Claude Code output to clients
- **Permission Control**: API access to Claude Code permission flags
- **CORS Support**: Cross-origin requests enabled

### Database Management

- SQLite database stores session mappings
- Primary key: Claude Code session_id
- Workspace paths use server-generated UUIDs for isolation
- Session timestamps for lifecycle management

## Development

### Scripts
- `npm start` - Start production server
- `npm run dev` - Start development server with file watching

### Environment
The server runs on `0.0.0.0:3000` and is configured for both local and networked access.