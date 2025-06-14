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

#### Without Authentication (Development)
```bash
# Health check endpoint (always public)
curl http://localhost:3000/health

# Basic request to /api/claude endpoint
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{"prompt": "List files"}'

# OpenAI compatible endpoint
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-code", "messages": [{"role": "user", "content": "Hello"}], "stream": true}'
```

#### With Authentication (Production)
```bash
# Set your API key
API_KEY="sk-1234567890abcdef1234567890abcdef12345678"

# Basic request to /api/claude endpoint with authentication
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"prompt": "List files"}'

# OpenAI compatible endpoint with authentication
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"model": "claude-code", "messages": [{"role": "user", "content": "Hello"}], "stream": true}'

# Test with custom port
curl -X POST http://localhost:8080/api/claude \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
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
| `API_KEY` | (none) | Single API key for authentication (OpenAI-compatible format) |
| `API_KEYS` | (none) | Multiple API keys (comma-separated, alternative to API_KEY) |
| `LOG_LEVEL` | `debug` | Logging level (error, warn, info, debug) - defaults to debug for personal use |
| `NODE_ENV` | `development` | Environment mode (development enables pretty-printed logs when pino-pretty is available) |

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

# Enable authentication with single API key
API_KEY=sk-1234567890abcdef1234567890abcdef12345678 npm start

# Enable authentication with multiple API keys
API_KEYS=sk-key1...,sk-key2...,sk-key3... npm start
```

## Authentication

The server supports optional API key authentication compatible with OpenAI's Bearer token format. This is ideal for securing the server in production environments while maintaining compatibility with OpenAI client libraries.

### Authentication Configuration

Authentication is controlled through environment variables:

- **Development Mode**: No authentication required (default when no API keys are configured)
- **Production Mode**: Bearer token authentication required when API keys are configured

### API Key Format

API keys should follow the OpenAI format: `sk-` followed by a string of characters (typically 48 characters total).

**Examples:**
```
sk-1234567890abcdef1234567890abcdef12345678
sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890123456
```

### Single API Key Setup

Set a single API key using the `API_KEY` environment variable:

```bash
# In .env file
API_KEY=sk-1234567890abcdef1234567890abcdef12345678

# Or via command line
API_KEY=sk-1234567890abcdef1234567890abcdef12345678 npm start
```

### Multiple API Keys Setup

For multiple API keys, use the `API_KEYS` environment variable with comma-separated values:

```bash
# In .env file
API_KEYS=sk-key1...,sk-key2...,sk-key3...

# Or via command line
API_KEYS=sk-key1...,sk-key2...,sk-key3... npm start
```

### Client Usage

When authentication is enabled, all API requests must include the `Authorization` header:

```bash
Authorization: Bearer sk-your-api-key-here
```

### OpenAI Client Library Compatibility

The authentication system is fully compatible with OpenAI client libraries:

```python
# Python example
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-api-key-here",
    base_url="http://localhost:3000/v1"
)

response = client.chat.completions.create(
    model="claude-code",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True
)
```

```javascript
// Node.js example
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'sk-your-api-key-here',
  baseURL: 'http://localhost:3000/v1'
});

const response = await client.chat.completions.create({
  model: 'claude-code',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true
});
```

### Authentication Status

The server logs authentication status on startup:

- **Authentication disabled**: No API keys configured, all requests accepted
- **Authentication enabled**: API keys configured, Bearer token required

### Security Features

- **Request logging**: All authentication attempts are logged for security monitoring
- **API key masking**: API keys are masked in logs (only first 8 characters shown)
- **Structured security logging**: Authentication events are logged with detailed context
- **Error handling**: Proper HTTP 401 responses for authentication failures

### Health Check Endpoint

The `/health` endpoint is always public and does not require authentication, allowing monitoring systems to check server status without API keys.

```

## Logging System

The server uses a unified structured logging system built on Pino for comprehensive monitoring and debugging.

### Logging Features

- **Structured JSON Logging**: All logs are output in structured JSON format for easy parsing and analysis
- **Request Correlation**: Each request gets a unique correlation ID for tracking across components
- **Component-based Organization**: Logs are organized by component (server, executor, mcp, health, session)
- **Performance Logging**: Built-in performance tracking for operations and requests
- **Security Logging**: Specialized logging for authentication and permission checks
- **Process Lifecycle Logging**: Detailed tracking of Claude CLI process spawning, execution, and termination
- **Health Check Logging**: Comprehensive logging for system health monitoring
- **Pretty Printing**: Human-readable logs in development mode (when pino-pretty is available)

### Log Levels

The server defaults to `debug` level for maximum verbosity (designed for personal use):

- `error`: Errors and failures
- `warn`: Warnings and degraded conditions  
- `info`: General information and successful operations
- `debug`: Detailed debugging information

### Log Configuration

Control logging behavior with environment variables:

```bash
# Set log level (error, warn, info, debug)
LOG_LEVEL=info npm start

# Enable production mode (disables pretty printing)
NODE_ENV=production npm start

# Maximum verbosity (default for personal use)
LOG_LEVEL=debug NODE_ENV=development npm start
```

### Log Structure

Each log entry includes:

```json
{
  "level": "info",
  "time": 1749920001794,
  "pid": 671131,
  "hostname": "server-name",
  "component": "server",
  "type": "server_startup",
  "correlationId": "uuid-for-request-tracking",
  "timestamp": "2025-06-14T16:53:21.794Z",
  "environment": "development",
  "msg": "Human-readable message",
  "additionalContext": "varies by log type"
}
```

### Monitoring Logs

View logs in real-time:

```bash
# View background server logs
npm run logs

# View logs with JSON formatting
npm run logs | jq

# Filter logs by component
npm run logs | grep '"component":"health"'

# Filter logs by level
npm run logs | grep '"level":"error"'
```

### Log Types

The system logs various event types:

- `server_startup`, `server_ready` - Server lifecycle
- `api_request`, `api_error` - API request handling
- `process_spawn`, `process_exit`, `process_error` - Claude CLI process management
- `health_check`, `health_check_complete` - Health monitoring
- `config_loaded`, `config_missing` - Configuration management
- `workspace_created`, `workspace_creation_error` - Workspace management
- `mcp_config`, `tool_validation` - MCP operations

### Dependencies
- Requires Claude Code CLI v1.0.18+ to be installed and configured
- Uses minimal dependencies: Fastify + CORS plugin + Pino logging
- MCP servers must be installed separately (typically via npm)
- Optional: pino-pretty for development pretty-printing