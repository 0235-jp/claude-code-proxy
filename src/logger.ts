/**
 * Unified logging system for Claude Code Server
 * Provides structured logging with consistent formatting and levels
 */

import pino from 'pino';
import { randomUUID } from 'crypto';

// Log level configuration
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug'; // Default to debug for personal use
const NODE_ENV = process.env.NODE_ENV || 'development';

// Pretty print configuration for development (only if pino-pretty is available)
let prettyPrint = null;
if (NODE_ENV === 'development') {
  try {
    require.resolve('pino-pretty');
    prettyPrint = {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
      messageFormat: '[{component}] {msg}',
      singleLine: false,
    };
  } catch {
    // pino-pretty not available, fall back to regular logging
    prettyPrint = null;
  }
}

// Base logger configuration
const logger = pino(
  {
    level: LOG_LEVEL,
    ...(prettyPrint && NODE_ENV !== 'test'
      ? {
          transport: {
            target: 'pino-pretty',
            options: prettyPrint,
          },
        }
      : {}),
    formatters: {
      level: label => ({ level: label }),
      log: object => {
        // Add consistent timestamp and format
        return {
          ...object,
          timestamp: new Date().toISOString(),
          environment: NODE_ENV,
        };
      },
    },
    serializers: {
      // Custom serializers for common objects
      error: pino.stdSerializers.err,
      request: (req: any) => ({
        method: req.method,
        url: req.url,
        headers: req.headers,
        remoteAddress: req.remoteAddress,
        remotePort: req.remotePort,
      }),
      response: (res: any) => ({
        statusCode: res.statusCode,
        headers: res.headers,
      }),
    },
  },
  // In test environment, use a silent stream to avoid file system issues
  NODE_ENV === 'test' ? require('stream').Writable({ write() {} }) : undefined
);

/**
 * Create a child logger with component context
 */
export function createLogger(component: string, additionalContext?: Record<string, any>) {
  return logger.child({
    component,
    ...additionalContext,
  });
}

/**
 * Create a request-scoped logger with correlation ID
 */
export function createRequestLogger(component: string, requestId?: string) {
  const correlationId = requestId || randomUUID();
  return logger.child({
    component,
    correlationId,
    requestScope: true,
  });
}

/**
 * Performance timing logger utility
 */
export class PerformanceLogger {
  private startTime: number;
  private logger: pino.Logger;
  private operation: string;

  constructor(logger: pino.Logger, operation: string) {
    this.logger = logger;
    this.operation = operation;
    this.startTime = Date.now();

    this.logger.debug(
      {
        operation,
        phase: 'start',
        timestamp: new Date().toISOString(),
      },
      `Starting operation: ${operation}`
    );
  }

  finish(result?: 'success' | 'error', additionalData?: Record<string, any>) {
    const duration = Date.now() - this.startTime;
    const logData = {
      operation: this.operation,
      phase: 'finish',
      duration: `${duration}ms`,
      result: result || 'success',
      ...additionalData,
    };

    if (result === 'error') {
      this.logger.warn(
        logData,
        `Operation completed with error: ${this.operation} (${duration}ms)`
      );
    } else {
      this.logger.info(logData, `Operation completed: ${this.operation} (${duration}ms)`);
    }
  }
}

/**
 * Security logging utilities for sensitive operations
 */
export class SecurityLogger {
  private logger: pino.Logger;

  constructor(component: string) {
    this.logger = createLogger(`security:${component}`);
  }

  logAuthentication(userId: string, success: boolean, additionalData?: Record<string, any>) {
    const logData = {
      userId: this.maskUserId(userId),
      success,
      type: 'authentication',
      ...additionalData,
    };

    if (success) {
      this.logger.info(logData, 'Authentication successful');
    } else {
      this.logger.warn(logData, 'Authentication failed');
    }
  }

  logPermissionCheck(operation: string, allowed: boolean, context?: Record<string, any>) {
    this.logger.info(
      {
        operation,
        allowed,
        type: 'permission_check',
        ...context,
      },
      `Permission check: ${operation} - ${allowed ? 'ALLOWED' : 'DENIED'}`
    );
  }

  logSensitiveOperation(operation: string, details?: Record<string, any>) {
    this.logger.warn(
      {
        operation,
        type: 'sensitive_operation',
        ...details,
      },
      `Sensitive operation performed: ${operation}`
    );
  }

  private maskUserId(userId: string): string {
    if (userId.length <= 4) return '***';
    return (
      userId.substring(0, 2) + '*'.repeat(userId.length - 4) + userId.substring(userId.length - 2)
    );
  }
}

/**
 * Health check logging utilities
 */
export function logHealthCheck(
  component: string,
  status: 'healthy' | 'degraded' | 'unhealthy',
  details?: Record<string, any>
) {
  const healthLogger = createLogger(`health:${component}`);

  const logData = {
    status,
    type: 'health_check',
    ...details,
  };

  switch (status) {
    case 'healthy':
      healthLogger.info(logData, `Health check passed: ${component}`);
      break;
    case 'degraded':
      healthLogger.warn(logData, `Health check degraded: ${component}`);
      break;
    case 'unhealthy':
      healthLogger.error(logData, `Health check failed: ${component}`);
      break;
  }
}

/**
 * Process lifecycle logging
 */
export function logProcessEvent(
  event: 'spawn' | 'exit' | 'error' | 'timeout' | 'signal',
  processInfo: {
    pid?: number;
    command?: string;
    exitCode?: number;
    signal?: string;
    error?: Error;
  },
  additionalContext?: Record<string, any>
) {
  const processLogger = createLogger('process');

  const logData = {
    event,
    ...processInfo,
    type: 'process_lifecycle',
    ...additionalContext,
  };

  switch (event) {
    case 'spawn':
      processLogger.info(
        logData,
        `Process spawned: ${processInfo.command} (PID: ${processInfo.pid})`
      );
      break;
    case 'exit':
      processLogger.info(
        logData,
        `Process exited: PID ${processInfo.pid} with code ${processInfo.exitCode}`
      );
      break;
    case 'error':
      processLogger.error(logData, `Process error: ${processInfo.error?.message}`);
      break;
    case 'timeout':
      processLogger.warn(logData, `Process timeout: PID ${processInfo.pid}`);
      break;
    case 'signal':
      processLogger.info(
        logData,
        `Process signal: ${processInfo.signal} to PID ${processInfo.pid}`
      );
      break;
  }
}

/**
 * Configuration logging
 */
export function logConfiguration(
  component: string,
  config: Record<string, any>,
  maskSensitive = true
) {
  const configLogger = createLogger(`config:${component}`);

  const maskedConfig = maskSensitive ? maskSensitiveValues(config) : config;

  configLogger.info(
    {
      type: 'configuration',
      config: maskedConfig,
    },
    `Configuration loaded for ${component}`
  );
}

/**
 * Utility to mask sensitive configuration values
 */
function maskSensitiveValues(obj: Record<string, any>): Record<string, any> {
  const sensitiveKeys = ['password', 'secret', 'key', 'token', 'auth', 'credential'];
  const masked: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      masked[key] = '***masked***';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveValues(value);
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

// Export the base logger for direct use if needed
export { logger as baseLogger };

// Default component loggers for common modules
export const serverLogger = createLogger('server');
export const executorLogger = createLogger('executor');
export const mcpLogger = createLogger('mcp');
export const healthLogger = createLogger('health');
export const sessionLogger = createLogger('session');
