/**
 * Comprehensive integration tests for server endpoints
 */

import supertest from 'supertest';
import { server } from '../src/server';
import { executeClaudeAndStream } from '../src/claude-executor';
import { loadMcpConfig } from '../src/mcp-manager';
import { performHealthCheck } from '../src/health-checker';
import { authenticateRequest } from '../src/auth';
import { OpenAITransformer } from '../src/openai-transformer';
import { StreamProcessor } from '../src/stream-processor';

// Mock dependencies
jest.mock('../src/claude-executor');
jest.mock('../src/mcp-manager');
jest.mock('../src/health-checker');
jest.mock('../src/auth');
jest.mock('../src/openai-transformer');
jest.mock('../src/stream-processor');

const mockExecuteClaudeAndStream = executeClaudeAndStream as jest.MockedFunction<typeof executeClaudeAndStream>;
const mockLoadMcpConfig = loadMcpConfig as jest.MockedFunction<typeof loadMcpConfig>;
const mockPerformHealthCheck = performHealthCheck as jest.MockedFunction<typeof performHealthCheck>;
const mockAuthenticateRequest = authenticateRequest as jest.MockedFunction<typeof authenticateRequest>;
const mockOpenAITransformer = {
  convertRequest: jest.fn(),
  createChunk: jest.fn(),
};
const mockStreamProcessor = {
  processChunk: jest.fn(),
  setOriginalWrite: jest.fn(),
  cleanup: jest.fn(),
};

(OpenAITransformer as any).convertRequest = mockOpenAITransformer.convertRequest;
(OpenAITransformer as any).createChunk = mockOpenAITransformer.createChunk;
(StreamProcessor as any).mockImplementation(() => mockStreamProcessor);

describe('Server Integration Tests', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Mock authentication to pass by default
    mockAuthenticateRequest.mockImplementation(async (_request, _reply) => {
      // Authentication passes by default
    });
    
    // Mock MCP config loading
    mockLoadMcpConfig.mockResolvedValue(null);
    
    // Mock health check to return healthy status
    mockPerformHealthCheck.mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: 12345,
      version: '1.0.0',
      checks: {
        claudeCli: {
          status: 'healthy',
          message: 'Claude CLI is available',
          timestamp: new Date().toISOString(),
          details: { version: '1.0.18' },
        },
        workspace: {
          status: 'healthy',
          message: 'Workspace directory is accessible',
          timestamp: new Date().toISOString(),
        },
        mcpConfig: {
          status: 'healthy',
          message: 'MCP configuration loaded successfully',
          timestamp: new Date().toISOString(),
        },
      },
    });

    // Mock executeClaudeAndStream to simulate streaming response
    mockExecuteClaudeAndStream.mockImplementation(async (_prompt, _sessionId, _options, reply) => {
      // Simulate basic streaming response
      reply.raw.write('data: {"type":"system","subtype":"init","session_id":"test-session"}\n\n');
      reply.raw.write('data: {"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}\n\n');
      reply.raw.end();
    });
    
    // Mock OpenAI Transformer
    mockOpenAITransformer.convertRequest.mockReturnValue({
      prompt: 'Hello',
      systemPrompt: null,
      sessionInfo: {
        session_id: null,
        workspace: null,
        dangerouslySkipPermissions: null,
        allowedTools: null,
        disallowedTools: null,
        mcpAllowedTools: null,
      },
    });
    
    mockOpenAITransformer.createChunk.mockImplementation((id, content, finishReason) => ({
      id,
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'claude-code',
      choices: [{
        index: 0,
        delta: { content },
        finish_reason: finishReason,
      }],
    }));
    
    // Mock StreamProcessor
    mockStreamProcessor.processChunk.mockReturnValue(true);
  });

  afterEach(async () => {
    await server.close();
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await supertest(server.server)
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        version: '1.0.0',
        checks: {
          claudeCli: {
            status: 'healthy',
            message: 'Claude CLI is available',
            timestamp: expect.any(String),
            details: { version: '1.0.18' },
          },
          workspace: {
            status: 'healthy',
            message: 'Workspace directory is accessible',
            timestamp: expect.any(String),
          },
          mcpConfig: {
            status: 'healthy',
            message: 'MCP configuration loaded successfully',
            timestamp: expect.any(String),
          },
        },
      });
    });

    it('should return degraded status with 200 when partially healthy', async () => {
      mockPerformHealthCheck.mockResolvedValueOnce({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptime: 12345,
        version: '1.0.0',
        checks: {
          claudeCli: {
            status: 'healthy',
            message: 'Claude CLI is available',
            timestamp: new Date().toISOString(),
            details: { version: '1.0.18' },
          },
          workspace: {
            status: 'degraded',
            message: 'Workspace directory has warnings',
            timestamp: new Date().toISOString(),
          },
          mcpConfig: {
            status: 'healthy',
            message: 'MCP configuration loaded successfully',
            timestamp: new Date().toISOString(),
          },
        },
      });

      const response = await supertest(server.server)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
    });

    it('should return unhealthy status with 503 when unhealthy', async () => {
      mockPerformHealthCheck.mockResolvedValueOnce({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: 12345,
        version: '1.0.0',
        checks: {
          claudeCli: {
            status: 'unhealthy',
            message: 'Claude CLI not found',
            timestamp: new Date().toISOString(),
          },
          workspace: {
            status: 'unhealthy',
            message: 'Workspace directory not accessible',
            timestamp: new Date().toISOString(),
          },
          mcpConfig: {
            status: 'unhealthy',
            message: 'MCP configuration failed',
            timestamp: new Date().toISOString(),
          },
        },
      });

      const response = await supertest(server.server)
        .get('/health')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
    });

    it('should handle health check errors with 500', async () => {
      mockPerformHealthCheck.mockRejectedValueOnce(new Error('Health check failed'));

      const response = await supertest(server.server)
        .get('/health')
        .expect(500);

      expect(response.body).toEqual({
        status: 'unhealthy',
        timestamp: expect.any(String),
        error: 'Health check failed',
        uptime: expect.any(Number),
        version: 'unknown',
        checks: {
          claudeCli: {
            status: 'unhealthy',
            message: 'Health check failed',
            timestamp: expect.any(String),
          },
          workspace: {
            status: 'unhealthy',
            message: 'Health check failed',
            timestamp: expect.any(String),
          },
          mcpConfig: {
            status: 'unhealthy',
            message: 'Health check failed',
            timestamp: expect.any(String),
          },
        },
      });
    });
  });

  describe('POST /api/claude', () => {
    it('should accept basic request with prompt', async () => {
      const response = await supertest(server.server)
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
      
      await supertest(server.server)
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
      await supertest(server.server)
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
      await supertest(server.server)
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
      await supertest(server.server)
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
      await supertest(server.server)
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
      await supertest(server.server)
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

      await supertest(server.server)
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
      await supertest(server.server)
        .post('/api/claude')
        .send({})
        .expect(400);

      expect(mockExecuteClaudeAndStream).not.toHaveBeenCalled();
    });

    it('should set correct headers for streaming', async () => {
      const response = await supertest(server.server)
        .post('/api/claude')
        .send({ prompt: 'Test' });

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('should handle executeClaudeAndStream errors gracefully', async () => {
      mockExecuteClaudeAndStream.mockRejectedValueOnce(new Error('Execution failed'));

      await supertest(server.server)
        .post('/api/claude')
        .send({ prompt: 'Test error handling' })
        .expect(200); // Still 200 because hijacked

      expect(mockExecuteClaudeAndStream).toHaveBeenCalled();
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('should accept basic OpenAI format request', async () => {
      const response = await supertest(server.server)
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
      expect(mockOpenAITransformer.convertRequest).toHaveBeenCalled();
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Hello',
        null,
        {},
        expect.any(Object)
      );
    });

    it('should handle system message', async () => {
      mockOpenAITransformer.convertRequest.mockReturnValueOnce({
        prompt: 'Help me',
        systemPrompt: 'You are helpful',
        sessionInfo: {
          session_id: null,
          workspace: null,
          dangerouslySkipPermissions: null,
          allowedTools: null,
          disallowedTools: null,
          mcpAllowedTools: null,
        },
      });

      await supertest(server.server)
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
      await supertest(server.server)
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
      await supertest(server.server)
        .post('/v1/chat/completions')
        .send({
          model: 'claude-code',
          stream: true
        })
        .expect(400);

      expect(mockExecuteClaudeAndStream).not.toHaveBeenCalled();
    });

    it('should handle empty messages array', async () => {
      mockOpenAITransformer.convertRequest.mockReturnValueOnce({
        prompt: '',
        systemPrompt: null,
        sessionInfo: {
          session_id: null,
          workspace: null,
          dangerouslySkipPermissions: null,
          allowedTools: null,
          disallowedTools: null,
          mcpAllowedTools: null,
        },
      });

      await supertest(server.server)
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

    it('should use OpenAI transformer for request conversion', async () => {
      mockOpenAITransformer.convertRequest.mockReturnValueOnce({
        prompt: 'Latest message',
        systemPrompt: null,
        sessionInfo: {
          session_id: null,
          workspace: null,
          dangerouslySkipPermissions: null,
          allowedTools: null,
          disallowedTools: null,
          mcpAllowedTools: null,
        },
      });

      await supertest(server.server)
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

      expect(mockOpenAITransformer.convertRequest).toHaveBeenCalled();
      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Latest message',
        null,
        {},
        expect.any(Object)
      );
    });

    it('should set correct headers for streaming', async () => {
      const response = await supertest(server.server)
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

    it('should handle complex OpenAI request with session configuration', async () => {
      mockOpenAITransformer.convertRequest.mockReturnValueOnce({
        prompt: 'Complex request',
        systemPrompt: 'You are a helpful assistant',
        sessionInfo: {
          session_id: 'session-123',
          workspace: 'my-workspace',
          dangerouslySkipPermissions: true,
          allowedTools: ['bash', 'edit'],
          disallowedTools: ['web'],
          mcpAllowedTools: ['mcp__github__listRepos'],
        },
      });

      await supertest(server.server)
        .post('/v1/chat/completions')
        .send({
          messages: [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'workspace=my-workspace allowed-tools=bash,edit session-id=session-123' },
            { role: 'user', content: 'Complex request' }
          ],
          stream: true
        })
        .expect(200);

      expect(mockExecuteClaudeAndStream).toHaveBeenCalledWith(
        'Complex request',
        'session-123',
        {
          workspace: 'my-workspace',
          systemPrompt: 'You are a helpful assistant',
          dangerouslySkipPermissions: true,
          allowedTools: ['bash', 'edit'],
          disallowedTools: ['web'],
          mcpAllowedTools: ['mcp__github__listRepos'],
        },
        expect.any(Object)
      );
    });

    it('should handle executeClaudeAndStream errors gracefully in OpenAI format', async () => {
      mockExecuteClaudeAndStream.mockRejectedValueOnce(new Error('Execution failed'));

      await supertest(server.server)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Test error handling' }],
          stream: true
        })
        .expect(200); // Still 200 because hijacked

      expect(mockExecuteClaudeAndStream).toHaveBeenCalled();
      expect(mockOpenAITransformer.createChunk).toHaveBeenCalled();
    });
  });

  describe('Authentication', () => {
    it('should call authentication middleware for /api/claude', async () => {
      await supertest(server.server)
        .post('/api/claude')
        .send({ prompt: 'Test' })
        .expect(200);

      expect(mockAuthenticateRequest).toHaveBeenCalled();
    });

    it('should call authentication middleware for /v1/chat/completions', async () => {
      await supertest(server.server)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Test' }],
          stream: true
        })
        .expect(200);

      expect(mockAuthenticateRequest).toHaveBeenCalled();
    });

    it('should handle authentication failure', async () => {
      const authError = new Error('Invalid API key');
      (authError as any).statusCode = 401;
      mockAuthenticateRequest.mockRejectedValueOnce(authError);

      await supertest(server.server)
        .post('/api/claude')
        .send({ prompt: 'Test' })
        .expect(401);
    });

    it('should not require authentication for health endpoint', async () => {
      await supertest(server.server)
        .get('/health')
        .expect(200);

      // Health endpoint should not call authentication
      expect(mockAuthenticateRequest).not.toHaveBeenCalled();
    });
  });

  describe('CORS', () => {
    it('should handle preflight OPTIONS request', async () => {
      await supertest(server.server)
        .options('/api/claude')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
    });

    it('should include CORS headers in response', async () => {
      const response = await supertest(server.server)
        .post('/api/claude')
        .set('Origin', 'http://localhost:3000')
        .send({ prompt: 'Test' });

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON in request body', async () => {
      await supertest(server.server)
        .post('/api/claude')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);
    });

    it('should handle unsupported HTTP methods', async () => {
      await supertest(server.server)
        .get('/api/claude')
        .expect(404);
    });

    it('should handle requests to non-existent endpoints', async () => {
      await supertest(server.server)
        .post('/api/nonexistent')
        .send({ data: 'test' })
        .expect(404);
    });
  });

  describe('Request Validation', () => {
    it('should validate schema for /api/claude endpoint', async () => {
      await supertest(server.server)
        .post('/api/claude')
        .send({
          prompt: 123, // Invalid type
        })
        .expect(400);
    });

    it('should validate schema for /v1/chat/completions endpoint', async () => {
      await supertest(server.server)
        .post('/v1/chat/completions')
        .send({
          messages: 'not an array', // Invalid type
          stream: true
        })
        .expect(400);
    });

    it('should accept optional parameters in /api/claude', async () => {
      await supertest(server.server)
        .post('/api/claude')
        .send({
          prompt: 'Test',
          'session-id': 'session-123',
          workspace: 'my-workspace',
          'system-prompt': 'You are helpful',
          'dangerously-skip-permissions': false,
          'allowed-tools': ['bash'],
          'disallowed-tools': ['web'],
          'mcp-allowed-tools': ['mcp__github__listRepos'],
        })
        .expect(200);
    });

    it('should accept optional parameters in /v1/chat/completions', async () => {
      await supertest(server.server)
        .post('/v1/chat/completions')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'Test' }],
          stream: true,
          temperature: 0.7,
          max_tokens: 1000,
        })
        .expect(200);
    });
  });
});