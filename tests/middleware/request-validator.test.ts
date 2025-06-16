/**
 * Tests for request validation middleware
 */

import { FastifyRequest } from 'fastify';
import {
  ValidationConstraints,
  ValidationMessages,
  performCustomValidation,
  claudeApiValidationSchema,
  openAIApiValidationSchema,
} from '../../src/middleware/request-validator';
import { ValidationError } from '../../src/errors';

describe('Request Validator', () => {
  describe('ValidationConstraints', () => {
    it('should have reasonable constraint values', () => {
      expect(ValidationConstraints.MAX_PROMPT_LENGTH).toBe(100000);
      expect(ValidationConstraints.MAX_SYSTEM_PROMPT_LENGTH).toBe(10000);
      expect(ValidationConstraints.MAX_SESSION_ID_LENGTH).toBe(128);
      expect(ValidationConstraints.MAX_WORKSPACE_NAME_LENGTH).toBe(64);
      expect(ValidationConstraints.MAX_TOOL_NAME_LENGTH).toBe(128);
      expect(ValidationConstraints.MAX_ARRAY_LENGTH).toBe(100);
    });

    it('should have valid regex patterns', () => {
      // Valid session IDs
      expect('session-123_abc').toMatch(ValidationConstraints.SESSION_ID_PATTERN);
      expect('SESSION_ID').toMatch(ValidationConstraints.SESSION_ID_PATTERN);
      
      // Invalid session IDs
      expect('session@123').not.toMatch(ValidationConstraints.SESSION_ID_PATTERN);
      expect('session 123').not.toMatch(ValidationConstraints.SESSION_ID_PATTERN);
      
      // Valid workspace names
      expect('my-workspace_1').toMatch(ValidationConstraints.WORKSPACE_NAME_PATTERN);
      expect('WORKSPACE').toMatch(ValidationConstraints.WORKSPACE_NAME_PATTERN);
      
      // Invalid workspace names
      expect('my workspace').not.toMatch(ValidationConstraints.WORKSPACE_NAME_PATTERN);
      expect('workspace@home').not.toMatch(ValidationConstraints.WORKSPACE_NAME_PATTERN);
      
      // Valid tool names (including MCP format)
      expect('tool-name_1').toMatch(ValidationConstraints.TOOL_NAME_PATTERN);
      expect('mcp:github').toMatch(ValidationConstraints.TOOL_NAME_PATTERN);
      expect('com.example.tool').toMatch(ValidationConstraints.TOOL_NAME_PATTERN);
      
      // Invalid tool names
      expect('tool name').not.toMatch(ValidationConstraints.TOOL_NAME_PATTERN);
      expect('tool@name').not.toMatch(ValidationConstraints.TOOL_NAME_PATTERN);
    });
  });

  describe('performCustomValidation', () => {
    let mockRequest: Partial<FastifyRequest>;

    beforeEach(() => {
      mockRequest = {
        id: 'test-request-id',
        url: '/api/claude',
        method: 'POST',
        body: {},
      };
    });

    it('should pass validation for valid Claude API request', async () => {
      mockRequest.body = {
        prompt: 'Hello, Claude!',
        'session-id': 'session-123',
        workspace: 'my-workspace',
      };

      await expect(
        performCustomValidation(mockRequest as FastifyRequest)
      ).resolves.not.toThrow();
    });

    it('should detect conflicting tool permissions', async () => {
      mockRequest.body = {
        prompt: 'Test',
        'allowed-tools': ['tool1', 'tool2', 'tool3'],
        'disallowed-tools': ['tool2', 'tool4'],
      };

      await expect(
        performCustomValidation(mockRequest as FastifyRequest)
      ).rejects.toThrow(ValidationError);

      try {
        await performCustomValidation(mockRequest as FastifyRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.validationErrors).toHaveLength(1);
        expect(validationError.validationErrors[0].field).toBe('allowed-tools/disallowed-tools');
        expect(validationError.validationErrors[0].code).toBe('conflicting_tool_permissions');
        expect(validationError.validationErrors[0].value).toEqual(['tool2']);
      }
    });

    it('should validate total message length for OpenAI endpoint', async () => {
      mockRequest = {
        ...mockRequest,
        url: '/v1/chat/completions',
      };
      mockRequest.body = {
        messages: [
          { role: 'system', content: 'A'.repeat(50000) },
          { role: 'user', content: 'B'.repeat(60000) }, // Total: 110000 > 100000
        ],
      };

      await expect(
        performCustomValidation(mockRequest as FastifyRequest)
      ).rejects.toThrow(ValidationError);

      try {
        await performCustomValidation(mockRequest as FastifyRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.validationErrors).toHaveLength(1);
        expect(validationError.validationErrors[0].field).toBe('messages');
        expect(validationError.validationErrors[0].code).toBe('messages_too_long');
      }
    });

    it('should pass validation for valid OpenAI request within limits', async () => {
      mockRequest = {
        ...mockRequest,
        url: '/v1/chat/completions',
      };
      mockRequest.body = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' },
        ],
      };

      await expect(
        performCustomValidation(mockRequest as FastifyRequest)
      ).resolves.not.toThrow();
    });

    it('should not check message length for non-OpenAI endpoints', async () => {
      mockRequest = {
        ...mockRequest,
        url: '/api/claude',
      };
      mockRequest.body = {
        prompt: 'Test',
        messages: [
          { role: 'user', content: 'A'.repeat(200000) }, // Would exceed limit if checked
        ],
      };

      await expect(
        performCustomValidation(mockRequest as FastifyRequest)
      ).resolves.not.toThrow();
    });
  });

  describe('Validation Schemas', () => {
    it('should have required fields in Claude API schema', () => {
      const body = claudeApiValidationSchema.body as any;
      expect(body.required).toEqual(['prompt']);
      expect(body.properties.prompt).toBeDefined();
      expect(body.properties['session-id']).toBeDefined();
      expect(body.properties.workspace).toBeDefined();
    });

    it('should have proper constraints in Claude API schema', () => {
      const body = claudeApiValidationSchema.body as any;
      const props = body.properties;
      expect(props.prompt.minLength).toBe(1);
      expect(props.prompt.maxLength).toBe(ValidationConstraints.MAX_PROMPT_LENGTH);
      expect(props['session-id'].pattern).toBe(ValidationConstraints.SESSION_ID_PATTERN.source);
      expect(props['allowed-tools'].maxItems).toBe(ValidationConstraints.MAX_ARRAY_LENGTH);
    });

    it('should have required fields in OpenAI API schema', () => {
      const body = openAIApiValidationSchema.body as any;
      expect(body.required).toEqual(['messages']);
      expect(body.properties.messages).toBeDefined();
      expect(body.properties.model).toBeDefined();
      expect(body.properties.stream).toBeDefined();
    });

    it('should have proper constraints in OpenAI API schema', () => {
      const body = openAIApiValidationSchema.body as any;
      const props = body.properties;
      expect(props.messages.minItems).toBe(1);
      expect(props.messages.maxItems).toBe(ValidationConstraints.MAX_ARRAY_LENGTH);
      expect(props.messages.items.required).toEqual(['role', 'content']);
      expect(props.messages.items.properties.role.enum).toEqual(['system', 'user', 'assistant']);
      expect(props.temperature?.minimum).toBe(0);
      expect(props.temperature?.maximum).toBe(2);
    });
  });

  describe('Error Messages', () => {
    it('should have user-friendly error messages', () => {
      expect(ValidationMessages.PROMPT_TOO_LONG).toContain('100000 characters or less');
      expect(ValidationMessages.SESSION_ID_INVALID).toContain('alphanumeric');
      expect(ValidationMessages.WORKSPACE_NAME_INVALID).toContain('alphanumeric');
      expect(ValidationMessages.EMPTY_PROMPT).toBe('Prompt cannot be empty');
      expect(ValidationMessages.INVALID_MESSAGE_ROLE).toContain('system, user, assistant');
    });
  });
});