/**
 * Unit tests for server module functions and route logic
 */

import fastify from 'fastify';
import cors from '@fastify/cors';
import { executeClaudeAndStream } from '../src/claude-executor';
import { performHealthCheck } from '../src/health-checker';
import { authenticateRequest } from '../src/auth';
import { AuthenticationError } from '../src/errors';

// Mock dependencies
jest.mock('../src/claude-executor');
jest.mock('../src/health-checker');
jest.mock('../src/auth');

const mockExecuteClaudeAndStream = executeClaudeAndStream as jest.MockedFunction<typeof executeClaudeAndStream>;
const mockPerformHealthCheck = performHealthCheck as jest.MockedFunction<typeof performHealthCheck>;
const mockAuthenticateRequest = authenticateRequest as jest.MockedFunction<typeof authenticateRequest>;

// Helper to create test server
async function createTestServer() {
  const app = fastify({ logger: false });
  await app.register(cors);


  // Health check endpoint
  app.get('/health', async (_request: any, reply: any) => {
    try {
      const healthStatus = await performHealthCheck();
      
      // Set appropriate HTTP status code based on health
      let statusCode = 200;
      if (healthStatus.status === 'degraded') {
        statusCode = 200; // Still operational but with issues
      } else if (healthStatus.status === 'unhealthy') {
        statusCode = 503; // Service unavailable
      }
      
      reply.code(statusCode).send(healthStatus);
    } catch (error) {
      reply.code(500).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        uptime: process.uptime(),
        version: 'unknown',
        checks: {
          claudeCli: {
            status: 'unhealthy',
            message: 'Health check failed',
            timestamp: new Date().toISOString()
          },
          workspace: {
            status: 'unhealthy', 
            message: 'Health check failed',
            timestamp: new Date().toISOString()
          }
        }
      });
    }
  });

  // Setup Claude API route
  app.post<{ Body: any }>('/api/claude', {
    preHandler: authenticateRequest,
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
          ...(allowedTools && { allowedTools }),
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
          ...(allowedTools && { allowedTools }),
        },
        reply
      );
    }
  });

  // Setup OpenAI API route
  app.post<{ Body: any }>('/v1/chat/completions', {
    preHandler: authenticateRequest,
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
          prev_allowedTools = mcpAllowedMatch[1]
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
          ...(allowedTools && { allowedTools }),
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
          ...(allowedTools && { allowedTools }),
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
    
    // Mock authentication to pass by default
    mockAuthenticateRequest.mockResolvedValue();
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
          'allowed-tools': ['bash', 'edit', 'mcp__github__list'],
          'disallowed-tools': ['web'],
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
          allowedTools: ['bash', 'edit', 'mcp__github__list'],
          disallowedTools: ['web'],
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

  });

  describe('Health Check Endpoint', () => {
    it('should return healthy status', async () => {
      const app = await createTestServer();
      
      mockPerformHealthCheck.mockResolvedValue({
        status: 'healthy',
        timestamp: '2025-06-14T16:25:58.963Z',
        uptime: 129.465,
        version: '1.0.0',
        checks: {
          claudeCli: {
            status: 'healthy',
            message: 'Claude CLI is available and responsive',
            timestamp: '2025-06-14T16:25:58.963Z'
          },
          workspace: {
            status: 'healthy',
            message: 'Workspace directory is accessible and writable',
            timestamp: '2025-06-14T16:25:58.965Z'
          }
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toMatchObject({
        status: 'healthy',
        uptime: 129.465,
        version: '1.0.0',
        checks: {
          claudeCli: { status: 'healthy' },
          workspace: { status: 'healthy' },
        }
      });

      await app.close();
    });

    it('should return degraded status with 200 code', async () => {
      const app = await createTestServer();
      
      mockPerformHealthCheck.mockResolvedValue({
        status: 'degraded',
        timestamp: '2025-06-14T16:25:58.963Z',
        uptime: 129.465,
        version: '1.0.0',
        checks: {
          claudeCli: {
            status: 'healthy',
            message: 'Claude CLI is available and responsive',
            timestamp: '2025-06-14T16:25:58.963Z'
          },
          workspace: {
            status: 'degraded',
            message: 'Workspace directory is readable but not writable',
            timestamp: '2025-06-14T16:25:58.965Z'
          }
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toMatchObject({
        status: 'degraded'
      });

      await app.close();
    });

    it('should return unhealthy status with 503 code', async () => {
      const app = await createTestServer();
      
      mockPerformHealthCheck.mockResolvedValue({
        status: 'unhealthy',
        timestamp: '2025-06-14T16:25:58.963Z',
        uptime: 129.465,
        version: '1.0.0',
        checks: {
          claudeCli: {
            status: 'unhealthy',
            message: 'Claude CLI is not available',
            timestamp: '2025-06-14T16:25:58.963Z'
          },
          workspace: {
            status: 'healthy',
            message: 'Workspace directory is accessible and writable',
            timestamp: '2025-06-14T16:25:58.965Z'
          }
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.payload)).toMatchObject({
        status: 'unhealthy'
      });

      await app.close();
    });

    it('should handle health check errors with 500 code', async () => {
      const app = await createTestServer();
      
      mockPerformHealthCheck.mockRejectedValue(new Error('Health check failed'));

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(500);
      const payload = JSON.parse(response.payload);
      expect(payload).toMatchObject({
        status: 'unhealthy',
        error: 'Health check failed',
        version: 'unknown'
      });
      expect(payload.checks).toHaveProperty('claudeCli');
      expect(payload.checks).toHaveProperty('workspace');

      await app.close();
    });
  });

  describe('Authentication Integration', () => {
    it('should call authenticateRequest before processing Claude API request', async () => {
      const app = await createTestServer();

      await app.inject({
        method: 'POST',
        url: '/api/claude',
        payload: { prompt: 'Test' },
      });

      expect(mockAuthenticateRequest).toHaveBeenCalled();

      await app.close();
    });

    it('should call authenticateRequest before processing OpenAI API request', async () => {
      const app = await createTestServer();

      await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          messages: [{ role: 'user', content: 'Test' }],
          stream: true
        },
      });

      expect(mockAuthenticateRequest).toHaveBeenCalled();

      await app.close();
    });

    it('should not call authenticateRequest for health endpoint', async () => {
      const app = await createTestServer();
      mockPerformHealthCheck.mockResolvedValue({
        status: 'healthy',
        timestamp: '2025-06-14T16:25:58.963Z',
        uptime: 129.465,
        version: '1.0.0',
        checks: {
          claudeCli: { status: 'healthy', message: 'OK', timestamp: '2025-06-14T16:25:58.963Z' },
          workspace: { status: 'healthy', message: 'OK', timestamp: '2025-06-14T16:25:58.965Z' },
        }
      });

      await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(mockAuthenticateRequest).not.toHaveBeenCalled();

      await app.close();
    });

    it.skip('should block request when authentication fails for Claude API', async () => {
      const app = await createTestServer();
      
      // Mock authentication to reject with AuthenticationError
      mockAuthenticateRequest.mockImplementation(async (_request) => {
        throw new AuthenticationError('Invalid authentication credentials');
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/claude',
        payload: { prompt: 'Test' },
      });

      expect(response.statusCode).toBe(401);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.error.message).toBe('Invalid authentication credentials');
      expect(responseBody.error.type).toBe('authentication_error');
      expect(responseBody.error.code).toBe('missing_api_key');
      expect(responseBody.error.type).toBe('authentication_error');
      expect(responseBody.error.code).toBe('missing_api_key');
      expect(responseBody.error.requestId).toBeDefined();
      expect(responseBody.error.timestamp).toBeDefined();
      expect(mockExecuteClaudeAndStream).not.toHaveBeenCalled();

      await app.close();
    });

    it.skip('should block request when authentication fails for OpenAI API', async () => {
      const app = await createTestServer();
      
      // Mock authentication to reject with AuthenticationError
      mockAuthenticateRequest.mockImplementation(async (_request) => {
        throw new AuthenticationError('Invalid authentication credentials');
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          messages: [{ role: 'user', content: 'Test' }],
          stream: true
        },
      });

      expect(response.statusCode).toBe(401);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.error.message).toBe('Invalid authentication credentials');
      expect(responseBody.error.type).toBe('authentication_error');
      expect(responseBody.error.code).toBe('missing_api_key');
      expect(responseBody.error.type).toBe('authentication_error');
      expect(responseBody.error.code).toBe('missing_api_key');
      expect(responseBody.error.requestId).toBeDefined();
      expect(responseBody.error.timestamp).toBeDefined();
      expect(mockExecuteClaudeAndStream).not.toHaveBeenCalled();

      await app.close();
    });

    it('should process request when authentication passes', async () => {
      const app = await createTestServer();
      
      // Authentication passes by default mock

      const response = await app.inject({
        method: 'POST',
        url: '/api/claude',
        payload: { prompt: 'Test authenticated request' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockAuthenticateRequest).toHaveBeenCalled();
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Test authenticated request',
        null,
        {},
        expect.any(Object)
      );

      await app.close();
    });
  });
});