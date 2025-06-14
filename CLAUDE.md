# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Server Management
- `npm start` - Start the server (default: port 3000, host 0.0.0.0)
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
Test the API endpoints using curl (default port 3000):
```bash
# Health check endpoint
curl http://localhost:3000/health

# Basic request to /api/claude endpoint
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{"prompt": "List files"}'

# OpenAI compatible endpoint
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-code", "messages": [{"role": "user", "content": "Hello"}], "stream": true}'

# Test with custom port (if PORT environment variable is set)
curl http://localhost:8080/health
curl -X POST http://localhost:8080/api/claude \
  -H "Content-Type: application/json" \
  -d '{"prompt": "List files"}'
```

## Architecture Overview

### Core Components
The server follows a modular architecture with clear separation of concerns:

1. **server.js** - Main Fastify server with three API endpoints:
   - `/health` - Health check endpoint for monitoring server status
   - `/api/claude` - Direct Claude Code API with all parameters in request body
   - `/v1/chat/completions` - OpenAI-compatible streaming endpoint

2. **claude-executor.js** - Handles Claude CLI process execution:
   - Spawns `claude` CLI processes with appropriate flags
   - Manages configurable process timeouts (default: total 60 minutes, inactivity 5 minutes)
   - Combines regular tools with MCP tools for `--allowedTools` flag

3. **session-manager.js** - Workspace isolation:
   - Creates `shared_workspace/` for default workspace
   - Creates `workspace/{name}/` for custom workspaces

4. **mcp-manager.js** - MCP (Model Context Protocol) integration:
   - Loads `mcp-config.json` configuration at startup
   - Validates MCP tool names against configured servers
   - Enables external tool integration (e.g., GitHub, DeepWiki)

5. **health-checker.js** - Health monitoring system:
   - Checks Claude CLI availability and version
   - Verifies workspace directory accessibility and permissions
   - Monitors MCP configuration status
   - Provides comprehensive system health reporting

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

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port for the server to listen on |
| `HOST` | `0.0.0.0` | Host address for the server to bind to |
| `CLAUDE_TOTAL_TIMEOUT_MS` | `3600000` | Total timeout for Claude processes (1 hour) |
| `CLAUDE_INACTIVITY_TIMEOUT_MS` | `300000` | Inactivity timeout for Claude processes (5 minutes) |
| `PROCESS_KILL_TIMEOUT_MS` | `5000` | Timeout before force-killing processes (5 seconds) |
| `MCP_CONFIG_PATH` | `../mcp-config.json` | Path to MCP configuration file (relative to dist directory) |
| `WORKSPACE_BASE_PATH` | project root | Base directory for workspace creation |

**Usage Examples:**
```bash
# Start server on custom port and host
PORT=8080 HOST=127.0.0.1 npm start

# Set custom timeouts (2 hours total, 10 minutes inactivity)
CLAUDE_TOTAL_TIMEOUT_MS=7200000 CLAUDE_INACTIVITY_TIMEOUT_MS=600000 npm start

# Use custom workspace location
WORKSPACE_BASE_PATH=/tmp/claude-workspaces npm start

# Use custom MCP config location
MCP_CONFIG_PATH=/path/to/my-mcp-config.json npm start
```

### Dependencies
- Requires Claude Code CLI v1.0.18+ to be installed and configured
- Uses minimal dependencies: Fastify + CORS plugin
- MCP servers must be installed separately (typically via npm)