/**
 * Custom error classes with automatic HTTP status code assignment
 */

import {
  ErrorType,
  ErrorCode,
  ErrorContext,
  ValidationErrorDetail,
  SystemErrorDetail,
} from './types';

export abstract class BaseError extends Error {
  public readonly type: ErrorType;
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly context: ErrorContext;
  public readonly details: Record<string, unknown>;
  public readonly isOperational: boolean;
  public readonly timestamp: string;

  constructor(
    message: string,
    type: ErrorType,
    code: ErrorCode,
    statusCode: number,
    context: ErrorContext = {},
    details: Record<string, unknown> = {},
    isOperational = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.type = type;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    this.details = details;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();

    // Maintains proper stack trace for where error was thrown (V8 engines only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// 400 Bad Request errors
export class ValidationError extends BaseError {
  public readonly validationErrors: ValidationErrorDetail[];

  constructor(
    message: string,
    validationErrors: ValidationErrorDetail[] = [],
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.INVALID_REQUEST
  ) {
    super(message, ErrorType.VALIDATION_ERROR, code, 400, context, { validationErrors });
    this.validationErrors = validationErrors;
  }
}

export class InvalidRequestError extends BaseError {
  constructor(
    message: string,
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.INVALID_REQUEST
  ) {
    super(message, ErrorType.VALIDATION_ERROR, code, 400, context);
  }
}

// 401 Unauthorized errors
export class AuthenticationError extends BaseError {
  constructor(
    message = 'Authentication required',
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.MISSING_API_KEY
  ) {
    super(message, ErrorType.AUTHENTICATION_ERROR, code, 401, context);
  }
}

// 403 Forbidden errors
export class AuthorizationError extends BaseError {
  constructor(
    message = 'Insufficient permissions',
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.INSUFFICIENT_PERMISSIONS
  ) {
    super(message, ErrorType.AUTHORIZATION_ERROR, code, 403, context);
  }
}

// 404 Not Found errors
export class NotFoundError extends BaseError {
  constructor(
    message: string,
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.RESOURCE_NOT_FOUND
  ) {
    super(message, ErrorType.NOT_FOUND_ERROR, code, 404, context);
  }
}

export class WorkspaceNotFoundError extends NotFoundError {
  constructor(workspace: string, context: ErrorContext = {}) {
    super(
      `Workspace '${workspace}' not found`,
      { ...context, workspace },
      ErrorCode.WORKSPACE_NOT_FOUND
    );
  }
}

export class SessionNotFoundError extends NotFoundError {
  constructor(sessionId: string, context: ErrorContext = {}) {
    super(
      `Session '${sessionId}' not found`,
      { ...context, sessionId },
      ErrorCode.SESSION_NOT_FOUND
    );
  }
}

// 429 Too Many Requests errors
export class RateLimitError extends BaseError {
  constructor(message = 'Rate limit exceeded', context: ErrorContext = {}, retryAfter?: number) {
    super(
      message,
      ErrorType.RATE_LIMIT_ERROR,
      ErrorCode.RATE_LIMIT_EXCEEDED,
      429,
      context,
      retryAfter ? { retryAfter } : {}
    );
  }
}

// 500 Internal Server Error
export class SystemError extends BaseError {
  public readonly systemDetails: SystemErrorDetail;

  constructor(
    message: string,
    systemDetails: SystemErrorDetail,
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR
  ) {
    super(
      message,
      ErrorType.SYSTEM_ERROR,
      code,
      500,
      context,
      { systemDetails },
      false // System errors are not operational
    );
    this.systemDetails = systemDetails;
  }
}

// 503 Service Unavailable errors
export class ServiceUnavailableError extends BaseError {
  constructor(
    message = 'Service temporarily unavailable',
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.SERVICE_UNAVAILABLE
  ) {
    super(message, ErrorType.SYSTEM_ERROR, code, 503, context);
  }
}

// Claude CLI specific errors
export class ClaudeCliError extends BaseError {
  constructor(
    message: string,
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.CLAUDE_CLI_EXECUTION_FAILED
  ) {
    const statusCode = code === ErrorCode.CLAUDE_CLI_NOT_FOUND ? 503 : 500;
    super(message, ErrorType.CLAUDE_CLI_ERROR, code, statusCode, context);
  }
}

export class ClaudeCliNotFoundError extends ClaudeCliError {
  constructor(context: ErrorContext = {}) {
    super('Claude CLI not found or not accessible', context, ErrorCode.CLAUDE_CLI_NOT_FOUND);
  }
}

export class ClaudeCliTimeoutError extends ClaudeCliError {
  constructor(timeout: number, context: ErrorContext = {}) {
    super(
      `Claude CLI operation timed out after ${timeout}ms`,
      { ...context, timeout },
      ErrorCode.CLAUDE_CLI_TIMEOUT
    );
  }
}

// Workspace specific errors
export class WorkspaceError extends BaseError {
  constructor(
    message: string,
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.WORKSPACE_ACCESS_DENIED
  ) {
    const statusCode = code === ErrorCode.WORKSPACE_ACCESS_DENIED ? 403 : 500;
    super(message, ErrorType.WORKSPACE_ERROR, code, statusCode, context);
  }
}

export class WorkspaceAccessDeniedError extends WorkspaceError {
  constructor(workspace: string, context: ErrorContext = {}) {
    super(
      `Access denied to workspace '${workspace}'`,
      { ...context, workspace },
      ErrorCode.WORKSPACE_ACCESS_DENIED
    );
  }
}

// MCP specific errors
export class McpError extends BaseError {
  constructor(
    message: string,
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.MCP_CONFIG_INVALID
  ) {
    super(message, ErrorType.MCP_ERROR, code, 500, context);
  }
}

export class McpConfigInvalidError extends McpError {
  constructor(reason: string, context: ErrorContext = {}) {
    super(`MCP configuration is invalid: ${reason}`, context, ErrorCode.MCP_CONFIG_INVALID);
  }
}

export class McpToolNotFoundError extends McpError {
  constructor(toolName: string, context: ErrorContext = {}) {
    super(
      `MCP tool '${toolName}' not found`,
      { ...context, toolName },
      ErrorCode.MCP_TOOL_NOT_FOUND
    );
  }
}

// Stream specific errors
export class StreamError extends BaseError {
  constructor(
    message: string,
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.STREAM_WRITE_FAILED
  ) {
    super(message, ErrorType.STREAM_ERROR, code, 500, context);
  }
}

export class StreamInterruptedError extends StreamError {
  constructor(reason: string, context: ErrorContext = {}) {
    super(
      `Stream was interrupted: ${reason}`,
      { ...context, reason },
      ErrorCode.STREAM_INTERRUPTED
    );
  }
}

// Configuration errors
export class ConfigurationError extends BaseError {
  constructor(
    message: string,
    context: ErrorContext = {},
    code: ErrorCode = ErrorCode.INVALID_CONFIGURATION
  ) {
    super(message, ErrorType.CONFIGURATION_ERROR, code, 500, context);
  }
}

export class MissingConfigurationError extends ConfigurationError {
  constructor(configName: string, context: ErrorContext = {}) {
    super(
      `Missing required configuration: ${configName}`,
      { ...context, configName },
      ErrorCode.MISSING_CONFIGURATION
    );
  }
}

// Health check errors
export class HealthCheckError extends BaseError {
  constructor(message: string, component: string, context: ErrorContext = {}) {
    super(message, ErrorType.HEALTH_CHECK_ERROR, ErrorCode.HEALTH_CHECK_FAILED, 503, {
      ...context,
      component,
    });
  }
}
