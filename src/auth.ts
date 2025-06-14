/**
 * Authentication middleware for Claude Code Server
 * Provides Bearer token authentication compatible with OpenAI API format
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { SecurityLogger } from './logger';

const securityLogger = new SecurityLogger('auth');

// Load API keys from environment variables (dynamic)
const getValidApiKeys = (): Set<string> => {
  const keys = new Set<string>();

  // Single API key
  if (process.env.API_KEY) {
    keys.add(process.env.API_KEY);
  }

  // Multiple API keys (comma-separated)
  if (process.env.API_KEYS) {
    process.env.API_KEYS.split(',').forEach(key => {
      const trimmedKey = key.trim();
      if (trimmedKey) {
        keys.add(trimmedKey);
      }
    });
  }

  return keys;
};

/**
 * Check if authentication is enabled
 * Authentication is disabled if no API keys are configured
 */
export function isAuthEnabled(): boolean {
  return getValidApiKeys().size > 0;
}

/**
 * Extract Bearer token from Authorization header
 * Supports OpenAI-compatible format: "Bearer sk-..."
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return bearerMatch ? bearerMatch[1].trim() : null;
}

/**
 * Validate API key against configured keys
 */
function validateApiKey(apiKey: string): boolean {
  return getValidApiKeys().has(apiKey);
}

/**
 * Authentication middleware for Fastify
 * Verifies Bearer token in Authorization header
 */
export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip authentication if not enabled
  if (!isAuthEnabled()) {
    securityLogger.logPermissionCheck('api_access', true, {
      reason: 'authentication_disabled',
      endpoint: request.url,
      method: request.method,
    });
    return;
  }

  const authHeader = request.headers.authorization;
  const apiKey = extractBearerToken(authHeader);

  // Log authentication attempt
  const requestContext = {
    endpoint: request.url,
    method: request.method,
    userAgent: request.headers['user-agent'],
    remoteAddress: request.ip,
    hasAuthHeader: !!authHeader,
    hasValidFormat: !!apiKey,
  };

  if (!apiKey) {
    securityLogger.logAuthentication('anonymous', false, {
      ...requestContext,
      reason: 'missing_or_invalid_bearer_token',
    });

    reply.code(401).send({
      error: {
        message: 'Invalid authentication credentials',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
    return;
  }

  if (!validateApiKey(apiKey)) {
    securityLogger.logAuthentication(apiKey.substring(0, 8) + '...', false, {
      ...requestContext,
      reason: 'invalid_api_key',
    });

    reply.code(401).send({
      error: {
        message: 'Invalid authentication credentials',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
    return;
  }

  // Authentication successful
  securityLogger.logAuthentication(apiKey.substring(0, 8) + '...', true, {
    ...requestContext,
    keyPrefix: apiKey.substring(0, 8),
  });

  securityLogger.logPermissionCheck('api_access', true, {
    endpoint: request.url,
    method: request.method,
    authenticatedKey: apiKey.substring(0, 8) + '...',
  });
}

/**
 * Generate a sample API key for documentation/setup
 * Format follows OpenAI convention: sk-...
 */
export function generateSampleApiKey(): string {
  const randomBytes = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');

  return `sk-${randomBytes}`;
}

/**
 * Get authentication status and configuration info
 */
export function getAuthStatus(): { enabled: boolean; keyCount: number; sampleKey?: string } {
  const validApiKeys = getValidApiKeys();
  const enabled = validApiKeys.size > 0;
  const result: { enabled: boolean; keyCount: number; sampleKey?: string } = {
    enabled,
    keyCount: validApiKeys.size,
  };

  if (!enabled) {
    result.sampleKey = generateSampleApiKey();
  }

  return result;
}
