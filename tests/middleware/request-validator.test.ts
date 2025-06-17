/**
 * Tests for request validation middleware
 */

import { FastifyRequest } from 'fastify';
import {
  ValidationConstraints,
  performCustomValidation,
  claudeApiValidationSchema,
  openAIApiValidationSchema,
} from '../../src/middleware/request-validator';
import { ValidationError } from '../../src/errors';

describe('Request Validator', () => {
  describe('ValidationConstraints', () => {
    it('should have valid patterns defined', () => {
      expect(ValidationConstraints.SESSION_ID_PATTERN).toBeInstanceOf(RegExp);
      expect(ValidationConstraints.WORKSPACE_NAME_PATTERN).toBeInstanceOf(RegExp);
      expect(ValidationConstraints.TOOL_NAME_PATTERN).toBeInstanceOf(RegExp);
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

    it('should allow large messages for OpenAI endpoint', async () => {
      mockRequest = {
        ...mockRequest,
        url: '/v1/chat/completions',
      };
      mockRequest.body = {
        messages: [
          { role: 'system', content: 'A'.repeat(50000) },
          { role: 'user', content: 'B'.repeat(60000) }, // Large content now allowed
        ],
      };

      // Should not throw with large content (no size limits for personal use)
      await expect(
        performCustomValidation(mockRequest as FastifyRequest)
      ).resolves.not.toThrow();
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
      expect(props.prompt.minLength).toBe(1);
      expect(props['session-id'].pattern).toBe(ValidationConstraints.SESSION_ID_PATTERN.source);
      expect(props['allowed-tools'].type).toBe('array');
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
      expect(props.messages.type).toBe('array');
      expect(props.messages.items.required).toEqual(['role', 'content']);
      expect(props.messages.items.properties.role.enum).toEqual(['system', 'user', 'assistant']);
      expect(props.temperature?.minimum).toBe(0);
      expect(props.temperature?.maximum).toBe(2);
    });
  });

  describe('Validation patterns', () => {
    it('should have working regex patterns', () => {
      expect('test-123').toMatch(ValidationConstraints.SESSION_ID_PATTERN);
      expect('workspace_1').toMatch(ValidationConstraints.WORKSPACE_NAME_PATTERN);
      expect('mcp:tool').toMatch(ValidationConstraints.TOOL_NAME_PATTERN);
    });
  });
});