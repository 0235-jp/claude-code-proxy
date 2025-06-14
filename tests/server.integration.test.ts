/**
 * Integration tests for server endpoints
 */

import supertest from 'supertest';
import fastify from 'fastify';
import cors from '@fastify/cors';
import { executeClaudeAndStream } from '../src/claude-executor';
import { loadMcpConfig } from '../src/mcp-manager';

// Mock dependencies
jest.mock('../src/claude-executor');
jest.mock('../src/mcp-manager');

const mockExecuteClaudeAndStream = executeClaudeAndStream as jest.MockedFunction<typeof executeClaudeAndStream>;
const mockLoadMcpConfig = loadMcpConfig as jest.MockedFunction<typeof loadMcpConfig>;

describe('Server Integration Tests', () => {
  let app: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Create a fresh Fastify instance for each test
    app = fastify({ logger: false });
    await app.register(cors);
    
    // Mock MCP config loading
    mockLoadMcpConfig.mockResolvedValue(null);
    await mockLoadMcpConfig();

    // Mock executeClaudeAndStream to simulate streaming response
    mockExecuteClaudeAndStream.mockImplementation(async (_prompt, _sessionId, _options, reply) => {
      // Simulate basic streaming response
      reply.raw.write('data: {"type":"system","subtype":"init","session_id":"test-session"}\n\n');
      reply.raw.write('data: {"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}\n\n');
      reply.raw.end();
    });

    // Setup routes
    app.post('/api/claude', {
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

      reply
        .type('text/event-stream')
        .header('Cache-Control', 'no-cache')
        .header('Connection', 'keep-alive')
        .header('Access-Control-Allow-Origin', '*');

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
    });

    app.post('/v1/chat/completions', {
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

      const userMessage = messages[messages.length - 1]?.content || '';
      let systemPrompt: string | null = null;
      
      if (messages.length > 0 && messages[0].role === 'system') {
        systemPrompt = messages[0].content;
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      await executeClaudeAndStream(
        userMessage,
        null,
        {
          ...(systemPrompt && { systemPrompt }),
        },
        reply
      );
    });
    
    // Prepare the app for testing after routes are set up
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('POST /api/claude', () => {
    it('should accept basic request with prompt', async () => {
      const response = await supertest(app.server)
        .post('/api/claude')
        .send({ prompt: 'Hello world' })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Hello world',
        null,
        {},
        expect.any(Object)
      );
    });

    it('should handle request with session ID', async () => {
      const sessionId = 'test-session-123';
      
      await supertest(app.server)
        .post('/api/claude')
        .send({ 
          prompt: 'Continue conversation',
          'session-id': sessionId 
        })
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Continue conversation',
        sessionId,
        {},
        expect.any(Object)
      );
    });

    it('should handle request with workspace', async () => {
      await supertest(app.server)
        .post('/api/claude')
        .send({ 
          prompt: 'List files',
          workspace: 'my-project'
        })
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'List files',
        null,
        { workspace: 'my-project' },
        expect.any(Object)
      );
    });

    it('should handle request with system prompt', async () => {
      await supertest(app.server)
        .post('/api/claude')
        .send({ 
          prompt: 'Help me',
          'system-prompt': 'You are a coding assistant'
        })
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Help me',
        null,
        { systemPrompt: 'You are a coding assistant' },
        expect.any(Object)
      );
    });

    it('should handle request with allowed tools', async () => {
      await supertest(app.server)
        .post('/api/claude')
        .send({ 
          prompt: 'Use tools',
          'allowed-tools': ['bash', 'edit']
        })
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Use tools',
        null,
        { allowedTools: ['bash', 'edit'] },
        expect.any(Object)
      );
    });

    it('should handle request with dangerously skip permissions', async () => {
      await supertest(app.server)
        .post('/api/claude')
        .send({ 
          prompt: 'Run command',
          'dangerously-skip-permissions': true
        })
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Run command',
        null,
        { dangerouslySkipPermissions: true },
        expect.any(Object)
      );
    });

    it('should handle request with MCP allowed tools', async () => {
      await supertest(app.server)
        .post('/api/claude')
        .send({ 
          prompt: 'Use MCP tools',
          'mcp-allowed-tools': ['mcp__github__listRepos']
        })
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Use MCP tools',
        null,
        { mcpAllowedTools: ['mcp__github__listRepos'] },
        expect.any(Object)
      );
    });

    it('should handle request with all options', async () => {
      const requestBody = {
        prompt: 'Complex request',
        'session-id': 'session-123',
        workspace: 'my-workspace',
        'system-prompt': 'You are helpful',
        'dangerously-skip-permissions': true,
        'allowed-tools': ['bash', 'edit'],
        'disallowed-tools': ['web'],
        'mcp-allowed-tools': ['mcp__github__listRepos'],
      };

      await supertest(app.server)
        .post('/api/claude')
        .send(requestBody)
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Complex request',
        'session-123',
        {
          workspace: 'my-workspace',
          systemPrompt: 'You are helpful',
          dangerouslySkipPermissions: true,
          allowedTools: ['bash', 'edit'],
          disallowedTools: ['web'],
          mcpAllowedTools: ['mcp__github__listRepos'],
        },
        expect.any(Object)
      );
    });

    it('should return 400 for missing prompt', async () => {
      await supertest(app.server)
        .post('/api/claude')
        .send({})
        .expect(400);

      expect(mockExecuteClaudeAndStream).not.toHaveBeenCalled();
    });

    it('should set correct headers for streaming', async () => {
      const response = await supertest(app.server)
        .post('/api/claude')
        .send({ prompt: 'Test' });

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('should accept basic OpenAI format request', async () => {
      const response = await supertest(app.server)
        .post('/v1/chat/completions')
        .send({
          model: 'claude-code',
          messages: [
            { role: 'user', content: 'Hello' }
          ],
          stream: true
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Hello',
        null,
        {},
        expect.any(Object)
      );
    });

    it('should handle system message', async () => {
      await supertest(app.server)
        .post('/v1/chat/completions')
        .send({
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Help me' }
          ],
          stream: true
        })
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Help me',
        null,
        { systemPrompt: 'You are helpful' },
        expect.any(Object)
      );
    });

    it('should return 400 for non-streaming requests', async () => {
      await supertest(app.server)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false
        })
        .expect(400)
        .expect({ error: 'Only streaming is supported' });

      expect(mockExecuteClaudeAndStream).not.toHaveBeenCalled();
    });

    it('should return 400 for missing messages', async () => {
      await supertest(app.server)
        .post('/v1/chat/completions')
        .send({
          model: 'claude-code',
          stream: true
        })
        .expect(400);

      expect(mockExecuteClaudeAndStream).not.toHaveBeenCalled();
    });

    it('should handle empty messages array', async () => {
      await supertest(app.server)
        .post('/v1/chat/completions')
        .send({
          messages: [],
          stream: true
        })
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        '',
        null,
        {},
        expect.any(Object)
      );
    });

    it('should use latest user message as prompt', async () => {
      await supertest(app.server)
        .post('/v1/chat/completions')
        .send({
          messages: [
            { role: 'user', content: 'First message' },
            { role: 'assistant', content: 'Response' },
            { role: 'user', content: 'Latest message' }
          ],
          stream: true
        })
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Latest message',
        null,
        {},
        expect.any(Object)
      );
    });

    it('should set correct headers for streaming', async () => {
      const response = await supertest(app.server)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Test' }],
          stream: true
        });

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('CORS', () => {
    it('should handle preflight OPTIONS request', async () => {
      await supertest(app.server)
        .options('/api/claude')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
    });

    it('should include CORS headers in response', async () => {
      const response = await supertest(app.server)
        .post('/api/claude')
        .set('Origin', 'http://localhost:3000')
        .send({ prompt: 'Test' });

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });
});