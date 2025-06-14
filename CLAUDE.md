# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Server Management
- `npm start` - Start the server on port 3000
- `npm run dev` - Start development server with file watching (TypeScript)
- `npm run build` - Build TypeScript to JavaScript
- `npm run start:bg` - Start server in background with logging to server.log
- `npm run stop` - Stop background server
- `npm run status` - Check if background server is running
- `npm run logs` - View server logs (tail -f server.log)

### Code Quality
- `npm run lint` - Run ESLint on TypeScript files
- `npm run lint:fix` - Run ESLint with auto-fix
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run type-check` - Run TypeScript type checking
- `npm run check-all` - Run all checks (type, lint, format)

### Testing the Server
Test the API endpoints using curl:
```bash
# Basic request to /api/claude endpoint
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{"prompt": "List files"}'

# OpenAI compatible endpoint
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-code", "messages": [{"role": "user", "content": "Hello"}], "stream": true}'
```

## Architecture Overview

### Core Components
The server follows a modular architecture with clear separation of concerns:

1. **server.js** - Main Fastify server with two API endpoints:
   - `/api/claude` - Direct Claude Code API with all parameters in request body
   - `/v1/chat/completions` - OpenAI-compatible streaming endpoint

2. **claude-executor.js** - Handles Claude CLI process execution:
   - Spawns `claude` CLI processes with appropriate flags
   - Manages process timeouts (total: 60 minutes, inactivity: 5 minutes)
   - Combines regular tools with MCP tools for `--allowedTools` flag

3. **session-manager.js** - Workspace isolation:
   - Creates `shared_workspace/` for default workspace
   - Creates `workspace/{name}/` for custom workspaces

4. **mcp-manager.js** - MCP (Model Context Protocol) integration:
   - Loads `mcp-config.json` configuration at startup
   - Validates MCP tool names against configured servers
   - Enables external tool integration (e.g., GitHub, DeepWiki)

### Key Architecture Patterns

**Dual API Design**: The server provides both a native API (`/api/claude`) and OpenAI-compatible API (`/v1/chat/completions`) that both route to the same Claude CLI execution logic.

**Parameter Extraction for OpenAI API**: The `/v1/chat/completions` endpoint extracts configuration from message content using regex patterns (e.g., `workspace=project-name`) and preserves session state across requests.

**Streaming Response Transformation**: Raw Claude CLI JSON output is transformed into OpenAI-compatible Server-Sent Events format, with special handling for thinking blocks, tool use, and error states.

**Tool Permission System**: Combines regular Claude tools with MCP tools into a single `--allowedTools` argument, with validation against configured MCP servers.

**System Prompt Support**: Both endpoints support custom system prompts:
- `/api/claude`: via `systemPrompt` parameter
- `/v1/chat/completions`: via first message with role "system"

### Configuration Files
- `mcp-config.json` - MCP server configurations (create from `mcp-config.json.example`)
- `.env` - Environment variables for server configuration (optional)
- Workspace directories are auto-created and gitignored

### Environment Variables
- `WORKSPACE_BASE_PATH` - Base directory for workspace creation (default: project root directory)
  - Example: `WORKSPACE_BASE_PATH=/tmp/claude-workspaces`

### Dependencies
- Requires Claude Code CLI v1.0.18+ to be installed and configured
- Uses minimal dependencies: Fastify + CORS plugin
- MCP servers must be installed separately (typically via npm)