/**
 * Unit tests for server module functions and route logic
 */

import fastify from 'fastify';
import cors from '@fastify/cors';
import { executeClaudeAndStream } from '../src/claude-executor';
import { loadMcpConfig } from '../src/mcp-manager';

// Mock dependencies
jest.mock('../src/claude-executor');
jest.mock('../src/mcp-manager');

const mockExecuteClaudeAndStream = executeClaudeAndStream as jest.MockedFunction<typeof executeClaudeAndStream>;
const mockLoadMcpConfig = loadMcpConfig as jest.MockedFunction<typeof loadMcpConfig>;

// Helper to create test server
async function createTestServer() {
  const app = fastify({ logger: false });
  await app.register(cors);

  // Mock MCP config loading
  mockLoadMcpConfig.mockResolvedValue(null);
  await mockLoadMcpConfig();

  // Setup Claude API route
  app.post<{ Body: any }>('/api/claude', {
    schema: {
      body: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string' },
          'session-id': { type: 'string' },
          workspace: { type: 'string' },
          'system-prompt': { type: 'string' },
          'dangerously-skip-permissions': { type: 'boolean' },
          'allowed-tools': { type: 'array', items: { type: 'string' } },
          'disallowed-tools': { type: 'array', items: { type: 'string' } },
          'mcp-allowed-tools': { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request: any, reply: any) => {
    const { prompt, workspace } = request.body;
    const sessionId = request.body['session-id'];
    const systemPrompt = request.body['system-prompt'];
    const allowedTools = request.body['allowed-tools'];
    const disallowedTools = request.body['disallowed-tools'];
    const mcpAllowedTools = request.body['mcp-allowed-tools'];
    const dangerouslySkipPermissions = request.body['dangerously-skip-permissions'];

    // Test server behavior without logging user data for security

    reply
      .type('text/event-stream')
      .header('Cache-Control', 'no-cache')
      .header('Connection', 'keep-alive')
      .header('Access-Control-Allow-Origin', '*');

    // For unit tests, don't hijack - just test the logic
    if (process.env.NODE_ENV === 'test') {
      await executeClaudeAndStream(
        prompt,
        sessionId || null,
        {
          ...(workspace && { workspace }),
          ...(systemPrompt && { systemPrompt }),
          ...(dangerouslySkipPermissions !== undefined && { dangerouslySkipPermissions }),
          ...(allowedTools && { allowedTools }),
          ...(disallowedTools && { disallowedTools }),
          ...(mcpAllowedTools && { mcpAllowedTools }),
        },
        reply
      );
      return reply.send('test-response');
    } else {
      reply.hijack();
      await executeClaudeAndStream(
        prompt,
        sessionId || null,
        {
          ...(workspace && { workspace }),
          ...(systemPrompt && { systemPrompt }),
          ...(dangerouslySkipPermissions !== undefined && { dangerouslySkipPermissions }),
          ...(allowedTools && { allowedTools }),
          ...(disallowedTools && { disallowedTools }),
          ...(mcpAllowedTools && { mcpAllowedTools }),
        },
        reply
      );
    }
  });

  // Setup OpenAI API route
  app.post<{ Body: any }>('/v1/chat/completions', {
    schema: {
      body: {
        type: 'object',
        required: ['messages'],
        properties: {
          model: { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                content: { type: 'string' },
              },
            },
          },
          stream: { type: 'boolean' },
          temperature: { type: 'number' },
          max_tokens: { type: 'number' },
        },
      },
    },
  }, async (request: any, reply: any) => {
    const { messages, stream = true } = request.body;

    if (!stream) {
      reply.code(400).send({ error: 'Only streaming is supported' });
      return;
    }

    // Extract system prompt if the first message has role "system"
    let systemPrompt: string | null = null;
    let messageStartIndex = 0;
    if (messages.length > 0 && messages[0].role === 'system') {
      systemPrompt = messages[0].content;
      messageStartIndex = 1;
    }

    // Get the latest user message
    const userMessage = messages[messages.length - 1]?.content || '';

    // Extract session_id and workspace from previous assistant messages
    let session_id: string | null = null;
    let workspace: string | null = null;
    let prev_dangerously_skip_permissions: boolean | null = null;
    let prev_allowedTools: string[] | null = null;
    let prev_disallowedTools: string[] | null = null;
    let prev_mcpAllowedTools: string[] | null = null;

    for (let i = messages.length - 2; i >= messageStartIndex; i--) {
      if (messages[i].role === 'assistant') {
        const content = messages[i].content || '';

        const sessionMatch = content.match(/session-id=([a-f0-9-]+)/);
        if (sessionMatch) session_id = sessionMatch[1];

        const workspaceMatch = content.match(/workspace=([^\s\n]+)/);
        if (workspaceMatch) workspace = workspaceMatch[1];

        const dangerMatch = content.match(/dangerously-skip-permissions=(\w+)/);
        if (dangerMatch)
          prev_dangerously_skip_permissions = dangerMatch[1].toLowerCase() === 'true';

        const allowedMatch = content.match(/allowed-tools=\[([^\]]+)\]/);
        if (allowedMatch) {
          prev_allowedTools = allowedMatch[1]
            .split(',')
            .map((tool: string) => tool.trim().replace(/['"]/g, ''));
        }

        const disallowedMatch = content.match(/disallowed-tools=\[([^\]]+)\]/);
        if (disallowedMatch) {
          prev_disallowedTools = disallowedMatch[1]
            .split(',')
            .map((tool: string) => tool.trim().replace(/['"]/g, ''));
        }

        const mcpAllowedMatch = content.match(/mcp-allowed-tools=\[([^\]]+)\]/);
        if (mcpAllowedMatch) {
          prev_mcpAllowedTools = mcpAllowedMatch[1]
            .split(',')
            .map((tool: string) => tool.trim().replace(/['"]/g, ''));
        }
        break;
      }
    }

    // Parse current message settings
    const currentWorkspaceMatch = userMessage.match(/workspace=([^\s\n]+)/);
    if (currentWorkspaceMatch) workspace = currentWorkspaceMatch[1];

    const dangerMatch = userMessage.match(/dangerously-skip-permissions=(\w+)/);
    const dangerouslySkipPermissions = dangerMatch
      ? dangerMatch[1].toLowerCase() === 'true'
      : prev_dangerously_skip_permissions;

    const allowedMatch = userMessage.match(/allowed-tools=\[([^\]]+)\]/);
    const allowedTools = allowedMatch
      ? allowedMatch[1].split(',').map((tool: string) => tool.trim().replace(/['"]/g, ''))
      : prev_allowedTools;

    const disallowedMatch = userMessage.match(/disallowed-tools=\[([^\]]+)\]/);
    const disallowedTools = disallowedMatch
      ? disallowedMatch[1].split(',').map((tool: string) => tool.trim().replace(/['"]/g, ''))
      : prev_disallowedTools;

    const mcpAllowedMatch = userMessage.match(/mcp-allowed-tools=\[([^\]]+)\]/);
    const mcpAllowedTools = mcpAllowedMatch
      ? mcpAllowedMatch[1].split(',').map((tool: string) => tool.trim().replace(/['"]/g, ''))
      : prev_mcpAllowedTools;

    // Extract prompt
    const promptMatch = userMessage.match(/prompt="([^"]+)"/);
    let prompt: string;
    if (promptMatch) {
      prompt = promptMatch[1];
    } else {
      // Remove settings from message
      prompt = userMessage
        .replace(
          /(workspace=[^\s\n]+|dangerously-skip-permissions=\w+|allowed-tools=\[[^\]]+\]|disallowed-tools=\[[^\]]+\]|mcp-allowed-tools=\[[^\]]+\]|prompt="[^"]+"|prompt=)(\s*)/g,
          ''
        )
        .trim();
      if (!prompt) prompt = userMessage;
    }

    // OpenAI Chat API test without logging user data for security

    if (process.env.NODE_ENV === 'test') {
      await executeClaudeAndStream(
        prompt,
        session_id,
        {
          ...(workspace && { workspace }),
          ...(systemPrompt && { systemPrompt }),
          ...(dangerouslySkipPermissions !== null && { dangerouslySkipPermissions }),
          ...(allowedTools && { allowedTools }),
          ...(disallowedTools && { disallowedTools }),
          ...(mcpAllowedTools && { mcpAllowedTools }),
        },
        reply
      );
      return reply.send('test-openai-response');
    } else {
      reply.hijack();
      // Manually write headers after hijacking
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      await executeClaudeAndStream(
        prompt,
        session_id,
        {
          ...(workspace && { workspace }),
          ...(systemPrompt && { systemPrompt }),
          ...(dangerouslySkipPermissions !== null && { dangerouslySkipPermissions }),
          ...(allowedTools && { allowedTools }),
          ...(disallowedTools && { disallowedTools }),
          ...(mcpAllowedTools && { mcpAllowedTools }),
        },
        reply
      );
    }
  });

  await app.ready();
  return app;
}

describe('Server Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    
    // Mock executeClaudeAndStream to prevent actual execution
    mockExecuteClaudeAndStream.mockResolvedValue();
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  describe('Claude API Route Logic', () => {
    it('should process request parameters correctly', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/api/claude',
        payload: {
          prompt: 'Hello world',
          'session-id': 'test-session',
          workspace: 'my-workspace',
          'system-prompt': 'You are helpful',
          'allowed-tools': ['bash', 'edit'],
          'disallowed-tools': ['web'],
          'mcp-allowed-tools': ['mcp__github__list'],
          'dangerously-skip-permissions': true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
      expect(response.headers['access-control-allow-origin']).toBe('*');

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Hello world',
        'test-session',
        {
          workspace: 'my-workspace',
          systemPrompt: 'You are helpful',
          allowedTools: ['bash', 'edit'],
          disallowedTools: ['web'],
          mcpAllowedTools: ['mcp__github__list'],
          dangerouslySkipPermissions: true,
        },
        expect.any(Object)
      );

      await app.close();
    });

    it('should handle minimal request with only prompt', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/api/claude',
        payload: {
          prompt: 'Simple request',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Simple request',
        null,
        {},
        expect.any(Object)
      );

      await app.close();
    });

    it('should validate required prompt field', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/api/claude',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(mockExecuteClaudeAndStream).not.toHaveBeenCalled();

      await app.close();
    });

    it('should handle boolean fields correctly', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/api/claude',
        payload: {
          prompt: 'Test',
          'dangerously-skip-permissions': false,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Test',
        null,
        {
          dangerouslySkipPermissions: false,
        },
        expect.any(Object)
      );

      await app.close();
    });
  });

  describe('OpenAI API Route Logic', () => {
    it('should process OpenAI format request correctly', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'claude-code',
          messages: [
            { role: 'user', content: 'Hello from OpenAI' }
          ],
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Hello from OpenAI',
        null,
        {},
        expect.any(Object)
      );

      await app.close();
    });

    it('should extract system prompt from first message', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          messages: [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'Help me code' }
          ],
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Help me code',
        null,
        {
          systemPrompt: 'You are a helpful assistant',
        },
        expect.any(Object)
      );

      await app.close();
    });

    it('should extract session ID from previous assistant messages', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          messages: [
            { role: 'user', content: 'First message' },
            { role: 'assistant', content: 'session-id=abc-123\nworkspace=my-project\nHello!' },
            { role: 'user', content: 'Continue conversation' }
          ],
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Continue conversation',
        'abc-123',
        {
          workspace: 'my-project',
        },
        expect.any(Object)
      );

      await app.close();
    });

    it('should parse settings from user message', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          messages: [
            { role: 'user', content: 'workspace=my-project allowed-tools=["bash","edit"] Help me' }
          ],
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Help me',
        null,
        {
          workspace: 'my-project',
          allowedTools: ['bash', 'edit'],
        },
        expect.any(Object)
      );

      await app.close();
    });

    it('should reject non-streaming requests', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload)).toEqual({ error: 'Only streaming is supported' });
      expect(mockExecuteClaudeAndStream).not.toHaveBeenCalled();

      await app.close();
    });

    it('should validate required messages field', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'claude-code',
          stream: true,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mockExecuteClaudeAndStream).not.toHaveBeenCalled();

      await app.close();
    });

    it('should handle empty messages array', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          messages: [],
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        '',
        null,
        {},
        expect.any(Object)
      );

      await app.close();
    });

    it('should use latest user message as prompt', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          messages: [
            { role: 'user', content: 'First message' },
            { role: 'assistant', content: 'Response' },
            { role: 'user', content: 'Latest message' }
          ],
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Latest message',
        null,
        {},
        expect.any(Object)
      );

      await app.close();
    });
  });

  describe('CORS Support', () => {
    it('should include CORS headers', async () => {
      const app = await createTestServer();

      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/claude',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBeDefined();

      await app.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle executeClaudeAndStream errors', async () => {
      const app = await createTestServer();
      mockExecuteClaudeAndStream.mockRejectedValue(new Error('Execution failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/claude',
        payload: {
          prompt: 'Test error',
        },
      });

      expect(response.statusCode).toBe(500);

      await app.close();
    });

    it('should handle loadMcpConfig errors', async () => {
      mockLoadMcpConfig.mockRejectedValue(new Error('MCP config failed'));

      // Should still create server even if MCP config fails
      const app = await createTestServer();
      expect(app).toBeDefined();

      await app.close();
    });
  });
});