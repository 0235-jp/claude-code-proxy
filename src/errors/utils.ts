/**
 * Utility functions for common error scenarios and environment-specific error control
 */

import { FastifyRequest } from 'fastify';
import { ValidationError, AuthenticationError, SystemError, BaseError } from './custom-errors';
import { ErrorCode, ErrorContext, ValidationErrorDetail, SystemErrorDetail } from './types';

/**
 * Environment-specific error configuration
 */
export interface EnvironmentErrorConfig {
  isDevelopment: boolean;
  includeStackTrace: boolean;
  includeInternalDetails: boolean;
  maskSensitiveData: boolean;
  verboseLogging: boolean;
}

/**
 * Get environment-specific error configuration
 */
export function getEnvironmentErrorConfig(): EnvironmentErrorConfig {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  return {
    isDevelopment,
    includeStackTrace: isDevelopment || process.env.INCLUDE_STACK_TRACE === 'true',
    includeInternalDetails: isDevelopment || process.env.INCLUDE_INTERNAL_DETAILS === 'true',
    maskSensitiveData: !isDevelopment && process.env.MASK_SENSITIVE_DATA !== 'false',
    verboseLogging: isDevelopment || process.env.VERBOSE_ERROR_LOGGING === 'true',
  };
}

/**
 * Create a validation error with multiple field errors
 */
export function createValidationError(
  message: string,
  fields: Array<{ field: string; value: unknown; message: string; code?: string }>,
  context: ErrorContext = {}
): ValidationError {
  const validationErrors: ValidationErrorDetail[] = fields.map(field => ({
    field: field.field,
    value: field.value,
    message: field.message,
    code: field.code || 'invalid_value',
  }));

  return new ValidationError(message, validationErrors, context);
}

/**
 * Create an authentication error with appropriate context
 */
export function createAuthenticationError(
  reason: 'missing_key' | 'invalid_key' | 'expired_key' | 'malformed_key' = 'missing_key',
  context: ErrorContext = {}
): AuthenticationError {
  const messages = {
    missing_key: 'API key is required',
    invalid_key: 'Invalid API key provided',
    expired_key: 'API key has expired',
    malformed_key: 'API key format is invalid',
  };

  const codes = {
    missing_key: ErrorCode.MISSING_API_KEY,
    invalid_key: ErrorCode.INVALID_API_KEY,
    expired_key: ErrorCode.INVALID_API_KEY,
    malformed_key: ErrorCode.INVALID_API_KEY,
  };

  return new AuthenticationError(messages[reason], context, codes[reason]);
}

/**
 * Create a system error with component details
 */
export function createSystemError(
  message: string,
  component: string,
  operation: string,
  originalError?: Error,
  context: ErrorContext = {}
): SystemError {
  const systemDetails: SystemErrorDetail = {
    component,
    operation,
    originalError: originalError?.message,
    stackTrace: originalError?.stack,
  };

  return new SystemError(message, systemDetails, context);
}

/**
 * Sanitize error message for production
 */
export function sanitizeErrorMessage(message: string, isDevelopment: boolean): string {
  if (isDevelopment) {
    return message;
  }

  // In production, sanitize potentially sensitive information
  const sensitivePatterns = [
    /[/][a-zA-Z0-9/-_]+/g, // File paths
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, // IP addresses
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Email addresses
    /(?:password|token|key|secret)[:=]\s*\S+/gi, // Credentials
  ];

  let sanitized = message;
  sensitivePatterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  });

  return sanitized;
}

/**
 * Format error for client response based on environment
 */
export function formatErrorForClient(
  error: BaseError,
  config: EnvironmentErrorConfig = getEnvironmentErrorConfig()
): Record<string, unknown> {
  const baseError: Record<string, unknown> = {
    message: sanitizeErrorMessage(error.message, config.isDevelopment),
    type: error.type,
    code: error.code,
    timestamp: error.timestamp,
  };

  // Add request ID if available
  if (error.context.requestId) {
    baseError.requestId = error.context.requestId;
  }

  // Add additional details based on environment
  if (config.includeInternalDetails && Object.keys(error.details).length > 0) {
    baseError.details = config.maskSensitiveData ? maskSensitiveData(error.details) : error.details;
  }

  // Add stack trace in development
  if (config.includeStackTrace && error.stack) {
    baseError.stack = error.stack;
  }

  // Add context in development
  if (config.isDevelopment && Object.keys(error.context).length > 0) {
    baseError.context = config.maskSensitiveData ? maskSensitiveData(error.context) : error.context;
  }

  return baseError;
}

/**
 * Mask sensitive data in objects
 */
export function maskSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = [
    'password',
    'token',
    'key',
    'secret',
    'authorization',
    'auth',
    'api_key',
    'apikey',
    'access_token',
    'refresh_token',
    'session',
    'cookie',
    'credentials',
    'private',
    'confidential',
  ];

  const masked = { ...data };

  Object.keys(masked).forEach(key => {
    const lowerKey = key.toLowerCase();

    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      masked[key] = '[REDACTED]';
    } else if (
      typeof masked[key] === 'object' &&
      masked[key] !== null &&
      !Array.isArray(masked[key])
    ) {
      masked[key] = maskSensitiveData(masked[key] as Record<string, unknown>);
    }
  });

  return masked;
}

/**
 * Check if error should be logged based on environment and error type
 */
export function shouldLogError(
  error: BaseError,
  config: EnvironmentErrorConfig = getEnvironmentErrorConfig()
): boolean {
  // Always log system errors
  if (!error.isOperational) {
    return true;
  }

  // In development, log everything
  if (config.isDevelopment) {
    return true;
  }

  // In production, only log 5xx errors and authentication failures
  return error.statusCode >= 500 || error.statusCode === 401;
}

/**
 * Get appropriate log level for error
 */
export function getLogLevel(error: BaseError): 'error' | 'warn' | 'info' {
  if (!error.isOperational || error.statusCode >= 500) {
    return 'error';
  }

  if (error.statusCode === 401 || error.statusCode === 403) {
    return 'warn';
  }

  return 'info';
}

/**
 * Extract useful error context from request
 */
export function extractErrorContext(request: FastifyRequest): ErrorContext {
  return {
    requestId: request.id,
    endpoint: request.url,
    method: request.method,
    userAgent: request.headers?.['user-agent'],
    clientIp: request.ip,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create error for OpenAI-compatible streaming response
 */
export function createStreamingError(error: BaseError | Error, requestId?: string): string {
  let formattedError: Record<string, unknown>;

  if (error instanceof BaseError) {
    formattedError = formatErrorForClient(error);
  } else {
    formattedError = {
      message: error.message,
      type: 'system_error',
      code: 'internal_server_error',
      timestamp: new Date().toISOString(),
    };
  }

  if (requestId) {
    formattedError.requestId = requestId;
  }

  const errorData = {
    type: 'error',
    error: formattedError,
  };

  return `data: ${JSON.stringify(errorData)}\n\n`;
}
