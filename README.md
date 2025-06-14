# Claude Code Server

A streaming API server that provides HTTP access to Claude Code CLI functionality with MCP support.

## Overview

Claude Code Server is a Fastify-based server that wraps the Claude Code CLI (v1.0.18+), providing RESTful streaming APIs for interacting with Claude Code sessions. It supports workspace management and Model Context Protocol (MCP) integration for external data sources.

## Features

- **Streaming API**: Real-time Claude Code responses via Server-Sent Events
- **Workspace Management**: Isolated workspaces with custom naming or shared workspace
- **System Prompt Support**: Custom system prompts for both API endpoints
- **MCP Support**: Integration with Model Context Protocol for external tools
- **Session Management**: Resume conversations with Claude Code sessions
- **OpenAI API Compatible**: Drop-in replacement for OpenAI chat completions
- **Permission Control**: Fine-grained tool permission management

## Tech Stack

- **Fastify** - Web framework
- **Claude Code CLI** - v1.0.18+ with MCP support
- **Node.js** - Runtime environment
- **MCP (Model Context Protocol)** - External data source integration

## Project Structure

```
claude-code-server/
├── package.json
├── server.js              # Fastify server with dual API endpoints
├── claude-executor.js     # Claude Code execution with MCP support
├── session-manager.js     # Workspace management
├── mcp-manager.js         # MCP configuration handling
├── mcp-config.json        # MCP server configuration (gitignored)
├── mcp-config.json.example # MCP configuration template
├── shared_workspace/      # Default workspace (gitignored)
└── workspace/             # Custom workspaces (gitignored)
    ├── project-a/
    └── project-b/
```

## API Parameters

### Available Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `prompt` | string | The message/instruction for Claude | `"Create a Python script"` |
| `session_id` | string | Resume existing Claude session | `"9c88687a-61ce-4315-afd5-58b7d84ee68b"` |
| `workspace` | string | Custom workspace name (default: shared) | `"my-project"` |
| `systemPrompt` | string | Custom system prompt to set Claude's behavior | `"You are a Python expert"` |
| `dangerously-skip-permissions` | boolean | Skip tool permission prompts | `true` |
| `allowedTools` | string[] | Allowed Claude tools | `["Bash", "Edit", "Write"]` |
| `disallowedTools` | string[] | Disallowed Claude tools | `["WebFetch", "WebSearch"]` |
| `mcp_allowed_tools` | string[] | Allowed MCP tools | `["mcp__github__get_repo"]` |

## API Endpoints

### POST /api/claude

**Request Body:**
```json
{
  "prompt": "Create a Python script",
  "session_id": "9c88687a-61ce-4315-afd5-58b7d84ee68b",
  "workspace": "my-project",
  "systemPrompt": "You are a Python expert who writes clean, efficient code with proper documentation.",
  "dangerously-skip-permissions": true,
  "allowedTools": ["Bash", "Edit", "Write"],
  "disallowedTools": ["WebFetch"],
  "mcp_allowed_tools": ["mcp__github__get_repo"]
}
```

### POST /v1/chat/completions (OpenAI Compatible)

**Standard Request Body:**
```json
{
  "model": "claude-code",
  "messages": [
    {"role": "user", "content": "Create a Python web application"}
  ],
  "stream": true
}
```

**With System Prompt (first message with role "system"):**
```json
{
  "model": "claude-code",
  "messages": [
    {"role": "system", "content": "You are a Python expert who writes clean, efficient code with proper documentation."},
    {"role": "user", "content": "Create a Python web application"}
  ],
  "stream": true
}
```

**To set parameters in the OpenAI API, use the following content:**

The session_id is automatically read from the previous response.
Other parameters will inherit information from the previous response unless specified.

```
workspace=project-name
allowedTools=["Bash","Edit","Write"]
mcp_allowed_tools=["mcp__github__get_repo"]
dangerously-skip-permissions=true

Your actual prompt here
```

**Response (Server-Sent Events):**
```
Content-Type: text/event-stream

data: {"type":"system","subtype":"init","session_id":"abc123","tools":["Task","Bash"],"mcp_servers":["github","deepwiki"]}

data: {"type":"assistant","message":{"content":[{"type":"text","text":"I'll help you analyze this repository..."}]}}
```

## MCP (Model Context Protocol) Support

### Configuration

Create `mcp-config.json` from the example:
```bash
cp mcp-config.json.example mcp-config.json
# Edit mcp-config.json with your MCP server configurations
```

## Workspace Management

### Workspace Types

1. **Shared Workspace** (default): `shared_workspace/`
2. **Custom Workspace**: `workspace/{workspace-name}/`

### Usage Examples

**Shared workspace:**
```bash
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{"prompt": "List files"}'
```

**Custom workspace:**
```bash
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Initialize a Node.js project",
    "workspace": "my-nodejs-app"
  }'
```

**With MCP tools:**
```bash
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analyze the Claude-Code-Server repository",
    "mcp_allowed_tools": ["mcp__github__get_repo", "mcp__deepwiki__ask_question"]
  }'
```

**With System Prompt:**
```bash
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a web application",
    "systemPrompt": "You are a senior software engineer who specializes in modern web development with TypeScript and React."
  }'
```

## Installation & Setup

### Prerequisites

- **Node.js** 18+
- **Claude Code CLI** v1.0.18+ installed and configured
- **MCP servers** (optional, installed via npm)

### Setup

```bash
# Install dependencies
npm install

# Setup MCP configuration (optional)
cp mcp-config.json.example mcp-config.json
# Edit mcp-config.json with your MCP server configurations

# Setup Claude Code permissions (if using dangerously-skip-permissions)
claude --dangerously-skip-permissions "test"
# Type 'y' when prompted to accept

# Start server
npm start
```

The server runs on `http://localhost:3000`

### Development

```bash
npm run dev     # Development server with file watching
npm run start:bg # Background server
npm run stop    # Stop background server
npm run status  # Check server status
npm run logs    # View server logs
```
