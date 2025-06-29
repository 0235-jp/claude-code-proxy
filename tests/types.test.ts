/**
 * Tests for types module
 */

import {
  ClaudeOptions,
  ClaudeApiRequest,
  OpenAIMessage,
  OpenAIRequest,
  McpConfig,
  SessionInfo,
  StreamJsonData,
} from '../src/types';

describe('types', () => {
  describe('ClaudeOptions', () => {
    it('should allow valid ClaudeOptions', () => {
      const options: ClaudeOptions = {
        workspace: 'test-workspace',
        systemPrompt: 'You are a helpful assistant',
        dangerouslySkipPermissions: true,
        allowedTools: ['tool1', 'tool2', 'mcp__github__listRepos'],
        disallowedTools: ['tool3'],
      };

      expect(options.workspace).toBe('test-workspace');
      expect(options.systemPrompt).toBe('You are a helpful assistant');
      expect(options.dangerouslySkipPermissions).toBe(true);
      expect(options.allowedTools).toEqual(['tool1', 'tool2', 'mcp__github__listRepos']);
      expect(options.disallowedTools).toEqual(['tool3']);
    });

    it('should allow empty ClaudeOptions', () => {
      const options: ClaudeOptions = {};
      expect(options).toEqual({});
    });
  });

  describe('ClaudeApiRequest', () => {
    it('should allow valid ClaudeApiRequest', () => {
      const request: ClaudeApiRequest = {
        prompt: 'Test prompt',
        'session-id': 'session-123',
        workspace: 'test-workspace',
        'system-prompt': 'You are helpful',
        'dangerously-skip-permissions': true,
        'allowed-tools': ['tool1', 'mcp__tool'],
        'disallowed-tools': ['tool2'],
      };

      expect(request.prompt).toBe('Test prompt');
      expect(request['session-id']).toBe('session-123');
      expect(request.workspace).toBe('test-workspace');
    });

    it('should require prompt field', () => {
      const request: ClaudeApiRequest = {
        prompt: 'Required prompt',
      };

      expect(request.prompt).toBe('Required prompt');
    });
  });

  describe('OpenAIMessage', () => {
    it('should allow system message', () => {
      const message: OpenAIMessage = {
        role: 'system',
        content: 'You are a helpful assistant',
      };

      expect(message.role).toBe('system');
      expect(message.content).toBe('You are a helpful assistant');
    });

    it('should allow user message', () => {
      const message: OpenAIMessage = {
        role: 'user',
        content: 'Hello world',
      };

      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello world');
    });

    it('should allow assistant message', () => {
      const message: OpenAIMessage = {
        role: 'assistant',
        content: 'Hello! How can I help you?',
      };

      expect(message.role).toBe('assistant');
      expect(message.content).toBe('Hello! How can I help you?');
    });
  });

  describe('OpenAIRequest', () => {
    it('should allow valid OpenAIRequest', () => {
      const request: OpenAIRequest = {
        model: 'claude-code',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        stream: true,
        temperature: 0.7,
        max_tokens: 1000,
      };

      expect(request.model).toBe('claude-code');
      expect(request.messages).toHaveLength(2);
      expect(request.stream).toBe(true);
      expect(request.temperature).toBe(0.7);
      expect(request.max_tokens).toBe(1000);
    });

    it('should require messages field', () => {
      const request: OpenAIRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      expect(request.messages).toHaveLength(1);
    });
  });

  describe('McpConfig', () => {
    it('should allow valid McpConfig', () => {
      const config: McpConfig = {
        mcpServers: {
          github: {
            command: 'node',
            args: ['github-server.js'],
          },
          filesystem: {
            command: 'node',
            args: ['fs-server.js'],
          },
        },
      };

      expect(config.mcpServers).toHaveProperty('github');
      expect(config.mcpServers).toHaveProperty('filesystem');
    });

    it('should allow empty mcpServers', () => {
      const config: McpConfig = {
        mcpServers: {},
      };

      expect(config.mcpServers).toEqual({});
    });
  });

  describe('SessionInfo', () => {
    it('should allow valid SessionInfo', () => {
      const info: SessionInfo = {
        session_id: 'session-123',
        workspace: 'test-workspace',
        dangerouslySkipPermissions: true,
        allowedTools: ['tool1', 'tool2', 'mcp__tool'],
        disallowedTools: ['tool3'],
      };

      expect(info.session_id).toBe('session-123');
      expect(info.workspace).toBe('test-workspace');
      expect(info.dangerouslySkipPermissions).toBe(true);
    });

    it('should require session_id field', () => {
      const info: SessionInfo = {
        session_id: 'required-session-id',
      };

      expect(info.session_id).toBe('required-session-id');
    });
  });

  describe('StreamJsonData', () => {
    it('should allow system type data', () => {
      const data: StreamJsonData = {
        type: 'system',
        subtype: 'init',
        session_id: 'session-123',
      };

      expect(data.type).toBe('system');
      expect(data.subtype).toBe('init');
      expect(data.session_id).toBe('session-123');
    });

    it('should allow assistant type data with message', () => {
      const data: StreamJsonData = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'text',
              text: 'Hello world',
            },
            {
              type: 'thinking',
              thinking: 'Let me think about this...',
            },
          ],
          stop_reason: 'end_turn',
        },
      };

      expect(data.type).toBe('assistant');
      expect(data.message?.content).toHaveLength(2);
      expect(data.message?.stop_reason).toBe('end_turn');
    });

    it('should allow error type data', () => {
      const data: StreamJsonData = {
        type: 'error',
        error: 'Something went wrong',
      };

      expect(data.type).toBe('error');
      expect(data.error).toBe('Something went wrong');
    });

    it('should allow error with object format', () => {
      const data: StreamJsonData = {
        type: 'error',
        error: {
          message: 'Detailed error message',
        },
      };

      expect(data.type).toBe('error');
      expect(typeof data.error).toBe('object');
      expect((data.error as { message: string }).message).toBe('Detailed error message');
    });

    it('should allow tool_use content', () => {
      const data: StreamJsonData = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'search',
              input: { query: 'test' },
            },
          ],
        },
      };

      const toolUse = data.message?.content?.[0];
      expect(toolUse?.type).toBe('tool_use');
      expect(toolUse?.name).toBe('search');
      expect(toolUse?.input).toEqual({ query: 'test' });
    });

    it('should allow tool_result content', () => {
      const data: StreamJsonData = {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: 'Search results...',
              is_error: false,
            },
          ],
        },
      };

      const toolResult = data.message?.content?.[0];
      expect(toolResult?.type).toBe('tool_result');
      expect(toolResult?.content).toBe('Search results...');
      expect(toolResult?.is_error).toBe(false);
    });
  });
});