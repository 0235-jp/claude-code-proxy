/**
 * Basic request validation middleware for Claude Code Server
 * Provides additional validation beyond JSON schema for improved data integrity
 */

import { FastifyRequest, FastifyReply, FastifySchema } from 'fastify';
import { ValidationError, ErrorCode, ValidationErrorDetail } from '../errors';

/**
 * Validation constraints for different fields
 */
export const ValidationConstraints = {
  // Maximum lengths (in characters)
  MAX_PROMPT_LENGTH: 100000, // 100KB roughly (assuming UTF-8)
  MAX_SYSTEM_PROMPT_LENGTH: 10000, // 10KB
  MAX_SESSION_ID_LENGTH: 128,
  MAX_WORKSPACE_NAME_LENGTH: 64,
  MAX_TOOL_NAME_LENGTH: 128,
  MAX_ARRAY_LENGTH: 100,
  MAX_MESSAGE_CONTENT_LENGTH: 100000,

  // Patterns
  SESSION_ID_PATTERN: /^[a-zA-Z0-9-_]+$/,
  WORKSPACE_NAME_PATTERN: /^[a-zA-Z0-9-_]+$/,
  TOOL_NAME_PATTERN: /^[a-zA-Z0-9:.\-_]+$/, // Allow colon for MCP tools like "mcp:tool"
} as const;

/**
 * Custom validation error messages
 */
export const ValidationMessages = {
  PROMPT_TOO_LONG: `Prompt must be ${ValidationConstraints.MAX_PROMPT_LENGTH} characters or less`,
  SYSTEM_PROMPT_TOO_LONG: `System prompt must be ${ValidationConstraints.MAX_SYSTEM_PROMPT_LENGTH} characters or less`,
  SESSION_ID_INVALID:
    'Session ID must contain only alphanumeric characters, hyphens, and underscores',
  SESSION_ID_TOO_LONG: `Session ID must be ${ValidationConstraints.MAX_SESSION_ID_LENGTH} characters or less`,
  WORKSPACE_NAME_INVALID:
    'Workspace name must contain only alphanumeric characters, hyphens, and underscores',
  WORKSPACE_NAME_TOO_LONG: `Workspace name must be ${ValidationConstraints.MAX_WORKSPACE_NAME_LENGTH} characters or less`,
  TOOL_NAME_INVALID:
    'Tool name must contain only alphanumeric characters, dots, colons, hyphens, and underscores',
  TOOL_NAME_TOO_LONG: `Tool name must be ${ValidationConstraints.MAX_TOOL_NAME_LENGTH} characters or less`,
  ARRAY_TOO_LONG: `Array must contain ${ValidationConstraints.MAX_ARRAY_LENGTH} items or less`,
  MESSAGE_CONTENT_TOO_LONG: `Message content must be ${ValidationConstraints.MAX_MESSAGE_CONTENT_LENGTH} characters or less`,
  EMPTY_PROMPT: 'Prompt cannot be empty',
  EMPTY_MESSAGE_CONTENT: 'Message content cannot be empty',
  INVALID_MESSAGE_ROLE: 'Message role must be one of: system, user, assistant',
} as const;

/**
 * Extended validation schemas for Claude API
 */
export const claudeApiValidationSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: ValidationConstraints.MAX_PROMPT_LENGTH,
      },
      'session-id': {
        type: 'string',
        maxLength: ValidationConstraints.MAX_SESSION_ID_LENGTH,
        pattern: ValidationConstraints.SESSION_ID_PATTERN.source,
      },
      workspace: {
        type: 'string',
        maxLength: ValidationConstraints.MAX_WORKSPACE_NAME_LENGTH,
        pattern: ValidationConstraints.WORKSPACE_NAME_PATTERN.source,
      },
      'system-prompt': {
        type: 'string',
        maxLength: ValidationConstraints.MAX_SYSTEM_PROMPT_LENGTH,
      },
      'dangerously-skip-permissions': { type: 'boolean' },
      'allowed-tools': {
        type: 'array',
        maxItems: ValidationConstraints.MAX_ARRAY_LENGTH,
        items: {
          type: 'string',
          maxLength: ValidationConstraints.MAX_TOOL_NAME_LENGTH,
          pattern: ValidationConstraints.TOOL_NAME_PATTERN.source,
        },
      },
      'disallowed-tools': {
        type: 'array',
        maxItems: ValidationConstraints.MAX_ARRAY_LENGTH,
        items: {
          type: 'string',
          maxLength: ValidationConstraints.MAX_TOOL_NAME_LENGTH,
          pattern: ValidationConstraints.TOOL_NAME_PATTERN.source,
        },
      },
      'mcp-allowed-tools': {
        type: 'array',
        maxItems: ValidationConstraints.MAX_ARRAY_LENGTH,
        items: {
          type: 'string',
          maxLength: ValidationConstraints.MAX_TOOL_NAME_LENGTH,
          pattern: ValidationConstraints.TOOL_NAME_PATTERN.source,
        },
      },
    },
  },
};

/**
 * Extended validation schemas for OpenAI API
 */
export const openAIApiValidationSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['messages'],
    properties: {
      model: { type: 'string' },
      messages: {
        type: 'array',
        minItems: 1,
        maxItems: ValidationConstraints.MAX_ARRAY_LENGTH,
        items: {
          type: 'object',
          required: ['role', 'content'],
          properties: {
            role: {
              type: 'string',
              enum: ['system', 'user', 'assistant'],
            },
            content: {
              type: 'string',
              minLength: 1,
              maxLength: ValidationConstraints.MAX_MESSAGE_CONTENT_LENGTH,
            },
          },
        },
      },
      stream: { type: 'boolean' },
      temperature: {
        type: 'number',
        minimum: 0,
        maximum: 2,
      },
      max_tokens: {
        type: 'number',
        minimum: 1,
        maximum: 1000000,
      },
    },
  },
};

/**
 * Additional custom validation logic beyond JSON schema
 * This runs after JSON schema validation passes
 */
export async function performCustomValidation(request: FastifyRequest): Promise<void> {
  const validationErrors: ValidationErrorDetail[] = [];

  // Check for specific business logic validations
  const body = request.body as Record<string, unknown>;

  // Example: Check for conflicting tool permissions
  if (body['allowed-tools'] && body['disallowed-tools']) {
    const allowedSet = new Set(body['allowed-tools'] as string[]);
    const conflicts = (body['disallowed-tools'] as string[]).filter((tool: string) =>
      allowedSet.has(tool)
    );

    if (conflicts.length > 0) {
      validationErrors.push({
        field: 'allowed-tools/disallowed-tools',
        value: conflicts,
        message: `Tools cannot be both allowed and disallowed: ${conflicts.join(', ')}`,
        code: 'conflicting_tool_permissions',
      });
    }
  }

  // Example: Validate combined message length for OpenAI endpoint
  if (request.url === '/v1/chat/completions' && body.messages) {
    const messages = body.messages as { content?: string }[];
    const totalLength = messages.reduce(
      (sum: number, msg: { content?: string }) => sum + (msg.content?.length || 0),
      0
    );

    if (totalLength > ValidationConstraints.MAX_PROMPT_LENGTH) {
      validationErrors.push({
        field: 'messages',
        value: `${totalLength} characters total`,
        message: `Total message content exceeds maximum of ${ValidationConstraints.MAX_PROMPT_LENGTH} characters`,
        code: 'messages_too_long',
      });
    }
  }

  // Throw validation error if any issues found
  if (validationErrors.length > 0) {
    throw new ValidationError(
      'Request validation failed',
      validationErrors,
      {
        requestId: request.id,
        endpoint: request.url,
        method: request.method,
      },
      ErrorCode.INVALID_REQUEST
    );
  }
}

/**
 * Create a validation preHandler that combines JSON schema and custom validation
 */
export function createValidationPreHandler() {
  return async function validationPreHandler(
    request: FastifyRequest,
    _reply: FastifyReply // eslint-disable-line @typescript-eslint/no-unused-vars, no-unused-vars
  ): Promise<void> {
    // JSON schema validation is handled by Fastify automatically
    // We only need to run our custom validation logic
    await performCustomValidation(request);
  };
}
