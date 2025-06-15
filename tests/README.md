# Test Suite Documentation

This directory contains comprehensive tests for the Claude Code Server, including unit tests, integration tests, and end-to-end (E2E) tests with specific focus on OpenAI API compatibility.

## Test Structure

### Unit Tests
- `claude-executor.test.ts` - Tests for Claude CLI process execution
- `session-manager.test.ts` - Tests for workspace isolation
- `mcp-manager.test.ts` - Tests for Model Context Protocol integration
- `health-checker.test.ts` - Tests for system health monitoring
- `auth.test.ts` - Tests for authentication system
- `openai-transformer.test.ts` - Tests for OpenAI format transformation
- `stream-processor.test.ts` - Tests for streaming response processing
- `server.unit.test.ts` - Unit tests for server components
- `types.test.ts` - Type definition tests

### Integration Tests
- `server.integration.test.ts` - Integration tests for server endpoints
- `e2e.test.ts` - Basic end-to-end tests

### E2E Tests for OpenAI API Compatibility

#### Core Compatibility Tests
- **`openai-client-compatibility.e2e.test.ts`** - Comprehensive OpenAI API compatibility tests
  - Server-Sent Events (SSE) format validation
  - OpenAI streaming response structure verification
  - Tool use in OpenAI format
  - Authentication and session management
  - Error response scenarios
  - Advanced features (workspace extraction, system prompts, multi-turn conversations)

#### Client Library Integration Tests
- **`client-integrations/python-openai.e2e.test.ts`** - Python OpenAI client library compatibility
  - Python SDK request/response patterns
  - Async streaming patterns (`async for chunk in stream`)
  - Python-specific headers and metadata
  - Data science and ML use cases
  - Django/Flask web development scenarios
  - Function calling (tools) support
  - Error handling and retry mechanisms

- **`client-integrations/nodejs-openai.e2e.test.ts`** - Node.js OpenAI client library compatibility
  - Node.js SDK request/response patterns
  - Async/await with streaming (`for await...of`)
  - TypeScript integration and type safety
  - Express.js and React/Next.js use cases
  - ES modules and CommonJS compatibility
  - AbortController patterns
  - Custom configuration options

## Running Tests

### Unit Tests Only
```bash
npm run test:unit
```

### All E2E Tests
```bash
npm run test:e2e:all
```

### Specific E2E Test Suites
```bash
# Basic E2E tests
npm run test:e2e

# OpenAI compatibility tests
npm run test:e2e:openai

# Python client integration tests
npm run test:e2e:python

# Node.js client integration tests
npm run test:e2e:nodejs
```

### Coverage Reports
```bash
npm run test:coverage
```

### Continuous Integration
```bash
npm run test:ci
npm run ci:full
```

## Test Features

### Mock Claude CLI
Each E2E test suite creates its own mock Claude CLI executable to simulate realistic Claude Code responses:
- System initialization messages
- Text responses with proper formatting
- Tool use simulation
- Thinking blocks (optional)
- Session management

### Authentication Testing
- Bearer token validation
- API key format verification (sk-...)
- Invalid token rejection
- Session continuity across requests

### Streaming Response Validation
- Server-Sent Events format compliance
- OpenAI chunk structure verification
- Content reconstruction from streaming chunks
- Tool call handling in streaming format
- Error response format validation

### Client Library Simulation
Tests simulate real-world usage patterns from popular OpenAI client libraries:
- Python: `openai.OpenAI().chat.completions.create()`
- Node.js: `client.chat.completions.create()`
- Headers, metadata, and SDK-specific behavior
- Error handling patterns
- Timeout and retry mechanisms

## Test Configuration

### Jest Configuration
- TypeScript support via ts-jest
- 30-second timeout for E2E tests
- Separate test environments for different test types
- Coverage reporting for source files only

### Environment Variables
Tests use different ports and API keys to avoid conflicts:
- Port 3001: Basic E2E tests
- Port 3002: OpenAI compatibility tests
- Port 3003: Python client tests
- Port 3004: Node.js client tests

### Mock Setup
Each test suite:
1. Creates a unique mock Claude CLI script
2. Sets up PATH environment to use the mock
3. Starts a server instance with test configuration
4. Runs tests against the isolated server
5. Cleans up mock files and server processes

## Coverage Goals

The E2E test suite aims to verify:
- ✅ Streaming response format compatibility with OpenAI API
- ✅ Integration with Python and Node.js OpenAI client libraries
- ✅ Authentication and session management
- ✅ Server-Sent Events (SSE) implementation compliance
- ✅ Error response scenarios and edge cases
- ✅ Advanced features (workspace management, system prompts, tool use)
- ✅ Real-world client usage patterns and headers

## Troubleshooting

### Common Issues
1. **Server startup timeout**: Increase timeout in test setup if needed
2. **Port conflicts**: Each test suite uses different ports to avoid conflicts
3. **Mock Claude CLI**: Tests create temporary executable files that are cleaned up after tests
4. **Process cleanup**: Tests include proper cleanup of spawned server processes

### Debug Mode
Set `NODE_ENV=development` to enable more verbose logging during tests.

### Manual Testing
You can also manually test OpenAI compatibility using curl:

```bash
# Start server with authentication
API_KEY=sk-test123 npm start

# Test OpenAI endpoint
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-test123" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-code",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```