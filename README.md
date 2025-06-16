# Claude Code Proxy

[![CI](https://github.com/0235-jp/Claude-Code-Server/actions/workflows/ci.yml/badge.svg)](https://github.com/0235-jp/Claude-Code-Server/actions/workflows/ci.yml)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-0235--jp%2FClaude--Code--Server-blue.svg?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAyCAYAAAAnWDnqAAAAAXNSR0IArs4c6QAAA05JREFUaEPtmUtyEzEQhtWTQyQLHNak2AB7ZnyXZMEjXMGeK/AIi+QuHrMnbChYY7MIh8g01fJoopFb0uhhEqqcbWTp06/uv1saEDv4O3n3dV60RfP947Mm9/SQc0ICFQgzfc4CYZoTPAswgSJCCUJUnAAoRHOAUOcATwbmVLWdGoH//PB8mnKqScAhsD0kYP3j/Yt5LPQe2KvcXmGvRHcDnpxfL2zOYJ1mFwrryWTz0advv1Ut4CJgf5uhDuDj5eUcAUoahrdY/56ebRWeraTjMt/00Sh3UDtjgHtQNHwcRGOC98BJEAEymycmYcWwOprTgcB6VZ5JK5TAJ+fXGLBm3FDAmn6oPPjR4rKCAoJCal2eAiQp2x0vxTPB3ALO2CRkwmDy5WohzBDwSEFKRwPbknEggCPB/imwrycgxX2NzoMCHhPkDwqYMr9tRcP5qNrMZHkVnOjRMWwLCcr8ohBVb1OMjxLwGCvjTikrsBOiA6fNyCrm8V1rP93iVPpwaE+gO0SsWmPiXB+jikdf6SizrT5qKasx5j8ABbHpFTx+vFXp9EnYQmLx02h1QTTrl6eDqxLnGjporxl3NL3agEvXdT0WmEost648sQOYAeJS9Q7bfUVoMGnjo4AZdUMQku50McDcMWcBPvr0SzbTAFDfvJqwLzgxwATnCgnp4wDl6Aa+Ax283gghmj+vj7feE2KBBRMW3FzOpLOADl0Isb5587h/U4gGvkt5v60Z1VLG8BhYjbzRwyQZemwAd6cCR5/XFWLYZRIMpX39AR0tjaGGiGzLVyhse5C9RKC6ai42ppWPKiBagOvaYk8lO7DajerabOZP46Lby5wKjw1HCRx7p9sVMOWGzb/vA1hwiWc6jm3MvQDTogQkiqIhJV0nBQBTU+3okKCFDy9WwferkHjtxib7t3xIUQtHxnIwtx4mpg26/HfwVNVDb4oI9RHmx5WGelRVlrtiw43zboCLaxv46AZeB3IlTkwouebTr1y2NjSpHz68WNFjHvupy3q8TFn3Hos2IAk4Ju5dCo8B3wP7VPr/FGaKiG+T+v+TQqIrOqMTL1VdWV1DdmcbO8KXBz6esmYWYKPwDL5b5FA1a0hwapHiom0r/cKaoqr+27/XcrS5UwSMbQAAAABJRU5ErkJggg==)](https://deepwiki.com/0235-jp/Claude-Code-Server)

A streaming HTTP proxy server that provides API access to Claude Code CLI functionality with MCP support.

## Overview

Claude Code Proxy is a Fastify-based HTTP proxy server that wraps the Claude Code CLI (v1.0.18+), providing RESTful streaming APIs for interacting with Claude Code sessions. It supports workspace management and Model Context Protocol (MCP) integration for external data sources.

## Features

- **Streaming API**: Real-time Claude Code responses via Server-Sent Events
- **Authentication**: Optional Bearer token authentication (OpenAI-compatible)
- **Health Monitoring**: Built-in health check endpoint for system monitoring
- **Workspace Management**: Isolated workspaces with custom naming or shared workspace
- **System Prompt Support**: Custom system prompts for both API endpoints
- **MCP Support**: Integration with Model Context Protocol for external tools
- **Session Management**: Resume conversations with Claude Code sessions
- **OpenAI API Compatible**: Drop-in replacement for OpenAI chat completions
- **Permission Control**: Fine-grained tool permission management
- **Structured Logging**: Comprehensive logging with security and performance monitoring

## Tech Stack

- **TypeScript** - Type-safe JavaScript development
- **Fastify** - Web framework
- **Claude Code CLI** - v1.0.18+ with MCP support
- **Node.js** - Runtime environment
- **MCP (Model Context Protocol)** - External data source integration
- **Pino** - Structured logging
- **ESLint + Prettier** - Code quality and formatting
- **GitHub Actions** - CI/CD pipeline

## Project Structure

```
claude-code-proxy/
├── .github/
│   └── workflows/
│       └── ci.yml          # GitHub Actions CI/CD workflow
├── src/
│   ├── server.ts           # Fastify server with API endpoints
│   ├── claude-executor.ts  # Claude Code execution with MCP support
│   ├── session-manager.ts  # Workspace management
│   ├── mcp-manager.ts      # MCP configuration handling
│   ├── health-checker.ts   # Health monitoring system
│   ├── auth.ts            # Authentication middleware
│   ├── logger.ts          # Unified logging system
│   └── types.ts            # TypeScript type definitions
├── dist/                   # Compiled TypeScript output
├── package.json
├── tsconfig.json           # TypeScript configuration
├── .eslintrc.js           # ESLint configuration
├── .prettierrc            # Prettier configuration
├── .husky/                # Git hooks for code quality
├── .env                   # Environment variables (gitignored)
├── .env.example           # Environment variables template
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
| `session-id` | string | Resume existing Claude session | `"9c88687a-61ce-4315-afd5-58b7d84ee68b"` |
| `workspace` | string | Custom workspace name (default: shared) | `"my-project"` |
| `system-prompt` | string | Custom system prompt to set Claude's behavior | `"You are a Python expert"` |
| `dangerously-skip-permissions` | boolean | Skip tool permission prompts | `true` |
| `allowed-tools` | string[] | Allowed Claude tools | `["Bash", "Edit", "Write"]` |
| `disallowed-tools` | string[] | Disallowed Claude tools | `["WebFetch", "WebSearch"]` |
| `mcp-allowed-tools` | string[] | Allowed MCP tools | `["mcp__github__get_repo"]` |

## API Endpoints

### GET /health

Health check endpoint for monitoring server status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-06-14T16:25:58.963Z",
  "uptime": 129.465,
  "version": "1.0.0",
  "checks": {
    "claudeCli": {
      "status": "healthy",
      "message": "Claude CLI is available and responsive",
      "details": {
        "version": "1.0.24 (Claude Code)",
        "exitCode": 0
      },
      "timestamp": "2025-06-14T16:25:58.963Z"
    },
    "workspace": {
      "status": "healthy",
      "message": "Workspace directory is accessible and writable",
      "details": {
        "path": "/path/to/workspace",
        "readable": true,
        "writable": true
      },
      "timestamp": "2025-06-14T16:25:58.965Z"
    },
    "mcpConfig": {
      "status": "healthy",
      "message": "MCP is disabled (no configuration file found)",
      "details": {
        "enabled": false,
        "configPath": "/path/to/mcp-config.json"
      },
      "timestamp": "2025-06-14T16:25:58.965Z"
    }
  }
}
```

**Status Codes:**
- `200` - Healthy or degraded (still operational)
- `503` - Unhealthy (service unavailable)
- `500` - Internal server error

**Health Status Values:**
- `healthy` - All checks passed
- `degraded` - Some issues detected but still operational
- `unhealthy` - Critical issues detected, service may not work properly

### POST /api/claude

**Request Body:**
```json
{
  "prompt": "Create a Python script",
  "session-id": "9c88687a-61ce-4315-afd5-58b7d84ee68b",
  "workspace": "my-project",
  "system-prompt": "You are a Python expert who writes clean, efficient code with proper documentation.",
  "dangerously-skip-permissions": true,
  "allowed-tools": ["Bash", "Edit", "Write"],
  "disallowed-tools": ["WebFetch"],
  "mcp-allowed-tools": ["mcp__github__get_repo"]
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

The session-id is automatically read from the previous response.
Other parameters will inherit information from the previous response unless specified.

```
workspace=project-name
allowed-tools=["Bash","Edit","Write"]
mcp-allowed-tools=["mcp__github__get_repo"]
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

### Configurable Workspace Location

You can customize the base directory for all workspaces using environment variables:

```bash
# Create .env file
cp .env.example .env

# Edit .env file
WORKSPACE_BASE_PATH=/tmp/claude-workspaces
```

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port for the server to listen on |
| `HOST` | `0.0.0.0` | Host address for the server to bind to |
| `CLAUDE_TOTAL_TIMEOUT_MS` | `3600000` | Total timeout for Claude processes (1 hour) |
| `CLAUDE_INACTIVITY_TIMEOUT_MS` | `300000` | Inactivity timeout for Claude processes (5 minutes) |
| `PROCESS_KILL_TIMEOUT_MS` | `5000` | Timeout before force-killing processes (5 seconds) |
| `MCP_CONFIG_PATH` | `../mcp-config.json` | Path to MCP configuration file |
| `WORKSPACE_BASE_PATH` | project root | Base directory for workspace creation |
| `API_KEY` | (none) | Single API key for authentication (OpenAI-compatible format) |
| `API_KEYS` | (none) | Multiple API keys (comma-separated, alternative to API_KEY) |
| `LOG_LEVEL` | `debug` | Logging level (error, warn, info, debug) - defaults to debug for personal use |
| `NODE_ENV` | `development` | Environment mode (development enables pretty-printed logs when pino-pretty is available) |

### Usage Examples

#### Development Mode (No Authentication)

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

**OpenAI-compatible endpoint:**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-code",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

#### Production Mode (With Authentication)

**Shared workspace with API key:**
```bash
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-1234567890abcdef1234567890abcdef12345678" \
  -d '{"prompt": "List files"}'
```

**OpenAI-compatible endpoint with API key:**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-1234567890abcdef1234567890abcdef12345678" \
  -d '{
    "model": "claude-code",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

#### Advanced Usage

**With MCP tools:**
```bash
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analyze the Claude-Code-Server repository",
    "mcp-allowed-tools": ["mcp__github__get_repo", "mcp__deepwiki__ask_question"]
  }'
```

**With System Prompt:**
```bash
curl -X POST http://localhost:3000/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a web application",
    "system-prompt": "You are a senior software engineer who specializes in modern web development with TypeScript and React."
  }'
```

## Authentication

### Overview

Claude Code Proxy supports optional Bearer token authentication compatible with OpenAI's API format. This allows you to secure your proxy server in production environments while maintaining compatibility with OpenAI client libraries.

### Authentication Modes

- **Development Mode**: No authentication required (default when no API keys are configured)
- **Production Mode**: Bearer token authentication required when API keys are configured

### API Key Configuration

#### Single API Key
```bash
# In .env file
API_KEY=sk-1234567890abcdef1234567890abcdef12345678

# Or via environment variable
API_KEY=sk-1234567890abcdef1234567890abcdef12345678 npm start
```

#### Multiple API Keys
```bash
# In .env file
API_KEYS=sk-key1...,sk-key2...,sk-key3...

# Or via environment variable
API_KEYS=sk-key1...,sk-key2...,sk-key3... npm start
```

### Client Usage

When authentication is enabled, include the Authorization header in all requests:

```bash
# curl example
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key-here" \
  -d '{"model": "claude-code", "messages": [{"role": "user", "content": "Hello"}], "stream": true}'
```

### OpenAI Client Library Compatibility

Works seamlessly with OpenAI client libraries:

**Python:**
```python
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

**Node.js:**
```javascript
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

### Security Features

- **Request Logging**: All authentication attempts are logged for security monitoring
- **API Key Masking**: API keys are masked in logs (only first 8 characters shown)
- **Structured Logging**: Authentication events are logged with detailed context
- **Public Health Endpoint**: `/health` endpoint remains public for monitoring systems

## Installation & Setup

### Prerequisites

- **Node.js** 18+
- **Claude Code CLI** v1.0.18+ installed and configured
- **MCP servers** (optional, installed via npm)

### Setup

```bash
# Install dependencies
npm install

# Setup environment variables (optional)
cp .env.example .env
# Edit .env with your configuration (e.g., WORKSPACE_BASE_PATH)

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

### Custom Configuration

You can customize server behavior using environment variables:

```bash
# Start server on custom port and host
PORT=8080 HOST=127.0.0.1 npm start

# Set custom timeouts (in milliseconds)
CLAUDE_TOTAL_TIMEOUT_MS=7200000 CLAUDE_INACTIVITY_TIMEOUT_MS=600000 npm start

# Use custom workspace location
WORKSPACE_BASE_PATH=/tmp/my-workspaces npm start

# Enable authentication with single API key
API_KEY=sk-1234567890abcdef1234567890abcdef12345678 npm start

# Enable authentication with multiple API keys
API_KEYS=sk-key1...,sk-key2...,sk-key3... npm start

# Set logging level (error, warn, info, debug)
LOG_LEVEL=info npm start

# Combine multiple settings
PORT=8080 API_KEY=sk-your-api-key WORKSPACE_BASE_PATH=/tmp/workspaces npm start
```

### Development

```bash
# Development
npm run dev     # Development server with file watching
npm run start:bg # Background server
npm run stop    # Stop background server
npm run status  # Check server status
npm run logs    # View server logs

# Code Quality
npm run build        # Compile TypeScript
npm run type-check   # Run TypeScript compiler
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint issues automatically
npm run format       # Format code with Prettier
npm run format:check # Check code formatting
npm run check-all    # Run all checks (type-check, lint, format)
```

## Development Features

- **Type Safety**: Full TypeScript implementation with strict type checking
- **Code Quality**: ESLint with TypeScript support for code quality enforcement
- **Code Formatting**: Prettier for consistent code formatting
- **Pre-commit Hooks**: Husky + lint-staged for automated code quality checks
- **CI/CD**: GitHub Actions workflow for automated testing and building
- **Hot Reload**: Development server with file watching for faster development
