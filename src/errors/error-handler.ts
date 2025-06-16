/**
 * Centralized error handling middleware and utilities
 */

import { FastifyRequest, FastifyReply, FastifyError, FastifyBaseLogger } from 'fastify';
import { BaseError } from './custom-errors';
import { ErrorResponse, ErrorContext, ErrorType } from './types';

export interface ErrorHandlerConfig {
  includeStackTrace: boolean;
  includeRequestDetails: boolean;
  maskSensitiveData: boolean;
  logErrors: boolean;
}

export class ErrorHandler {
  private config: ErrorHandlerConfig;

  constructor(config: Partial<ErrorHandlerConfig> = {}) {
    const isDevelopment = process.env.NODE_ENV !== 'production';

    this.config = {
      includeStackTrace: config.includeStackTrace ?? isDevelopment,
      includeRequestDetails: config.includeRequestDetails ?? isDevelopment,
      maskSensitiveData: config.maskSensitiveData ?? !isDevelopment,
      logErrors: config.logErrors ?? true,
      ...config,
    };
  }

  /**
   * Main error handler for Fastify
   */
  public handleError = (
    error: Error | FastifyError,
    request: FastifyRequest,
    reply: FastifyReply
  ): void => {
    const requestLogger = request.log.child({ component: 'error-handler' });
    const context = this.extractRequestContext(request);

    // Check if it's our custom error
    if (error instanceof BaseError) {
      this.handleCustomError(error, context, requestLogger, reply);
    } else if (this.isFastifyError(error)) {
      this.handleFastifyError(error, context, requestLogger, reply);
    } else {
      this.handleUnknownError(error, context, requestLogger, reply);
    }
  };

  /**
   * Handle custom BaseError instances
   */
  private handleCustomError(
    error: BaseError,
    context: ErrorContext,
    logger: FastifyBaseLogger,
    reply: FastifyReply
  ): void {
    const errorResponse = this.createErrorResponse(error, context);

    if (this.config.logErrors) {
      this.logError(error, context, logger);
    }

    reply.status(error.statusCode).send(errorResponse);
  }

  /**
   * Handle Fastify-specific errors
   */
  private handleFastifyError(
    error: FastifyError,
    context: ErrorContext,
    logger: FastifyBaseLogger,
    reply: FastifyReply
  ): void {
    const statusCode = error.statusCode || 500;
    let errorType = 'api_error';
    let errorCode = 'unknown_error';

    // Map Fastify error types to our error system
    if (error.validation) {
      errorType = 'validation_error';
      errorCode = 'invalid_request';
    } else if (statusCode === 404) {
      errorType = 'not_found_error';
      errorCode = 'resource_not_found';
    } else if (statusCode >= 400 && statusCode < 500) {
      errorType = 'invalid_request_error';
      errorCode = 'bad_request';
    }

    const errorResponse: ErrorResponse = {
      error: {
        message: error.message || 'Request failed',
        type: errorType as ErrorType,
        code: errorCode,
        requestId: context.requestId,
        timestamp: new Date().toISOString(),
        ...(error.validation && { details: { validation: error.validation } }),
        ...(this.config.includeStackTrace && { stack: error.stack }),
      },
    };

    if (this.config.logErrors) {
      logger.error(
        {
          error: error.message,
          statusCode,
          validation: error.validation,
          type: 'fastify_error',
          context,
        },
        'Fastify error occurred'
      );
    }

    reply.status(statusCode).send(errorResponse);
  }

  /**
   * Handle unknown/unexpected errors
   */
  private handleUnknownError(
    error: Error,
    context: ErrorContext,
    logger: FastifyBaseLogger,
    reply: FastifyReply
  ): void {
    const errorResponse: ErrorResponse = {
      error: {
        message: this.config.includeStackTrace ? error.message : 'An unexpected error occurred',
        type: ErrorType.SYSTEM_ERROR,
        code: 'internal_server_error',
        requestId: context.requestId,
        timestamp: new Date().toISOString(),
        ...(this.config.includeStackTrace && { stack: error.stack }),
      },
    };

    if (this.config.logErrors) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          type: 'unknown_error',
          context,
        },
        'Unknown error occurred'
      );
    }

    reply.status(500).send(errorResponse);
  }

  /**
   * Create standardized error response
   */
  private createErrorResponse(error: BaseError, context: ErrorContext): ErrorResponse {
    const response: ErrorResponse = {
      error: {
        message: error.message,
        type: error.type,
        code: error.code,
        requestId: context.requestId || error.context.requestId,
        timestamp: error.timestamp,
      },
    };

    // Add details if available and configuration allows
    if (Object.keys(error.details).length > 0) {
      response.error.details = this.config.maskSensitiveData
        ? this.maskSensitiveDetails(error.details)
        : error.details;
    }

    // Add stack trace in development
    if (this.config.includeStackTrace && error.stack) {
      response.error.details = {
        ...response.error.details,
        stack: error.stack,
      };
    }

    // Add request context in development
    if (this.config.includeRequestDetails) {
      response.error.details = {
        ...response.error.details,
        context: this.config.maskSensitiveData ? this.maskSensitiveContext(context) : context,
      };
    }

    return response;
  }

  /**
   * Extract request context for error reporting
   */
  private extractRequestContext(request: FastifyRequest): ErrorContext {
    return {
      requestId: request.id,
      endpoint: request.url,
      method: request.method,
      userAgent: request.headers['user-agent'],
      clientIp: request.ip,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Log error with appropriate level and context
   */
  private logError(error: BaseError, context: ErrorContext, logger: FastifyBaseLogger): void {
    const logLevel = error.statusCode >= 500 ? 'error' : 'warn';

    logger[logLevel](
      {
        error: error.message,
        type: error.type,
        code: error.code,
        statusCode: error.statusCode,
        isOperational: error.isOperational,
        context: this.config.maskSensitiveData ? this.maskSensitiveContext(context) : context,
        details: this.config.maskSensitiveData
          ? this.maskSensitiveDetails(error.details)
          : error.details,
        ...(this.config.includeStackTrace && { stack: error.stack }),
      },
      `${error.type}: ${error.message}`
    );
  }

  /**
   * Mask sensitive data in error details
   */
  private maskSensitiveDetails(details: Record<string, unknown>): Record<string, unknown> {
    const masked = { ...details };
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'authorization'];

    for (const [key, value] of Object.entries(masked)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        masked[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = this.maskSensitiveDetails(value as Record<string, unknown>);
      }
    }

    return masked;
  }

  /**
   * Mask sensitive data in request context
   */
  private maskSensitiveContext(context: ErrorContext): ErrorContext {
    const masked = { ...context };

    // Mask user agent details in production
    if (masked.userAgent && this.config.maskSensitiveData) {
      masked.userAgent = '[REDACTED]';
    }

    return masked;
  }

  /**
   * Check if error is a Fastify error
   */
  private isFastifyError(error: unknown): error is FastifyError {
    return !!(
      error &&
      typeof error === 'object' &&
      ('statusCode' in error ||
        'validation' in error ||
        ('name' in error && error.name === 'FastifyError'))
    );
  }

  /**
   * Create error response for streaming endpoints
   */
  public static createStreamErrorResponse(error: Error | BaseError, requestId?: string): string {
    const errorResponse = {
      type: 'error',
      error: {
        message: error.message,
        type: error instanceof BaseError ? error.type : 'system_error',
        code: error instanceof BaseError ? error.code : 'internal_server_error',
        timestamp: new Date().toISOString(),
        ...(requestId && { requestId }),
      },
    };

    return `data: ${JSON.stringify(errorResponse)}\n\n`;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ErrorHandlerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Export singleton instance
export const errorHandler = new ErrorHandler();
