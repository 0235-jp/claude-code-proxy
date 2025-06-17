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
  // Patterns for format validation (no size limits for personal use)
  SESSION_ID_PATTERN: /^[a-zA-Z0-9-_]+$/,
  WORKSPACE_NAME_PATTERN: /^[a-zA-Z0-9-_]+$/,
  TOOL_NAME_PATTERN: /^[a-zA-Z0-9:.\-_]+$/, // Allow colon for MCP tools like "mcp:tool"
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
      },
      'session-id': {
        type: 'string',
        pattern: ValidationConstraints.SESSION_ID_PATTERN.source,
      },
      workspace: {
        type: 'string',
        pattern: ValidationConstraints.WORKSPACE_NAME_PATTERN.source,
      },
      'system-prompt': {
        type: 'string',
      },
      'dangerously-skip-permissions': { type: 'boolean' },
      'allowed-tools': {
        type: 'array',
        items: {
          type: 'string',
          pattern: ValidationConstraints.TOOL_NAME_PATTERN.source,
        },
      },
      'disallowed-tools': {
        type: 'array',
        items: {
          type: 'string',
          pattern: ValidationConstraints.TOOL_NAME_PATTERN.source,
        },
      },
      'mcp-allowed-tools': {
        type: 'array',
        items: {
          type: 'string',
          pattern: ValidationConstraints.TOOL_NAME_PATTERN.source,
        },
      },
      files: {
        type: 'array',
        items: {
          type: 'string',
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
        items: {
          type: 'object',
          required: ['role', 'content'],
          properties: {
            role: {
              type: 'string',
              enum: ['system', 'user', 'assistant'],
            },
            content: {
              oneOf: [
                {
                  type: 'string',
                  minLength: 1,
                },
                {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['type'],
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['text', 'image_url', 'file'],
                      },
                      text: {
                        type: 'string',
                      },
                      image_url: {
                        type: 'object',
                        required: ['url'],
                        properties: {
                          url: {
                            type: 'string',
                          },
                          detail: {
                            type: 'string',
                            enum: ['low', 'high', 'auto'],
                          },
                        },
                      },
                      file: {
                        type: 'object',
                        properties: {
                          file_id: {
                            type: 'string',
                          },
                          file_data: {
                            type: 'string',
                          },
                          filename: {
                            type: 'string',
                          },
                        },
                      },
                    },
                  },
                },
              ],
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
      files: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: {
              type: 'string',
            },
            name: {
              type: 'string',
            },
          },
        },
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
  const body = request.body as Record<string, unknown> | undefined;

  // Example: Check for conflicting tool permissions
  if (body && body['allowed-tools'] && body['disallowed-tools']) {
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

  // No size-based validation - let actual memory/processing limits handle large requests

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
 * Validation schema for file upload endpoint
 */
export const fileUploadValidationSchema: FastifySchema = {
  // Multipart form data validation is handled by Fastify multipart plugin
  // No additional schema needed here
};

/**
 * Validation schema for file metadata endpoint
 */
export const fileMetadataValidationSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['fileId'],
    properties: {
      fileId: {
        type: 'string',
        pattern: '^file-[a-f0-9]+$',
      },
    },
  },
};

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
