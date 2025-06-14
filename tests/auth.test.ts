/**
 * Authentication tests
 */

import { jest } from '@jest/globals';
import { FastifyRequest, FastifyReply } from 'fastify';
import {
  authenticateRequest,
  isAuthEnabled,
  generateSampleApiKey,
  getAuthStatus
} from '../src/auth';

// Mock the logger
jest.mock('../src/logger', () => ({
  SecurityLogger: jest.fn().mockImplementation(() => ({
    logAuthentication: jest.fn(),
    logPermissionCheck: jest.fn()
  }))
}));

describe('Authentication', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variables
    process.env = { ...originalEnv };
    delete process.env.API_KEY;
    delete process.env.API_KEYS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isAuthEnabled', () => {
    it('should return false when no API keys are configured', () => {
      expect(isAuthEnabled()).toBe(false);
    });

    it('should return true when API_KEY is configured', () => {
      process.env.API_KEY = 'sk-test-key';
      expect(isAuthEnabled()).toBe(true);
    });

    it('should return true when API_KEYS is configured', () => {
      process.env.API_KEYS = 'sk-key1,sk-key2';
      expect(isAuthEnabled()).toBe(true);
    });

    it('should return true when both API_KEY and API_KEYS are configured', () => {
      process.env.API_KEY = 'sk-test-key';
      process.env.API_KEYS = 'sk-key1,sk-key2';
      expect(isAuthEnabled()).toBe(true);
    });
  });

  describe('generateSampleApiKey', () => {
    it('should generate a key with sk- prefix', () => {
      const key = generateSampleApiKey();
      expect(key).toMatch(/^sk-[a-f0-9]{32}$/);
    });

    it('should generate different keys on each call', () => {
      const key1 = generateSampleApiKey();
      const key2 = generateSampleApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('getAuthStatus', () => {
    it('should return disabled status when no keys are configured', () => {
      const status = getAuthStatus();
      expect(status.enabled).toBe(false);
      expect(status.keyCount).toBe(0);
      expect(status.sampleKey).toMatch(/^sk-[a-f0-9]{32}$/);
    });

    it('should return enabled status with single API key', () => {
      process.env.API_KEY = 'sk-test-key';
      const status = getAuthStatus();
      expect(status.enabled).toBe(true);
      expect(status.keyCount).toBe(1);
      expect(status.sampleKey).toBeUndefined();
    });

    it('should return enabled status with multiple API keys', () => {
      process.env.API_KEYS = 'sk-key1,sk-key2,sk-key3';
      const status = getAuthStatus();
      expect(status.enabled).toBe(true);
      expect(status.keyCount).toBe(3);
      expect(status.sampleKey).toBeUndefined();
    });

    it('should handle whitespace in API_KEYS', () => {
      process.env.API_KEYS = ' sk-key1 , sk-key2 , sk-key3 ';
      const status = getAuthStatus();
      expect(status.enabled).toBe(true);
      expect(status.keyCount).toBe(3);
    });

    it('should ignore empty strings in API_KEYS', () => {
      process.env.API_KEYS = 'sk-key1,,sk-key2, ,sk-key3';
      const status = getAuthStatus();
      expect(status.enabled).toBe(true);
      expect(status.keyCount).toBe(3);
    });

    it('should combine API_KEY and API_KEYS', () => {
      process.env.API_KEY = 'sk-single-key';
      process.env.API_KEYS = 'sk-key1,sk-key2';
      const status = getAuthStatus();
      expect(status.enabled).toBe(true);
      expect(status.keyCount).toBe(3);
    });

    it('should deduplicate identical keys', () => {
      process.env.API_KEY = 'sk-duplicate-key';
      process.env.API_KEYS = 'sk-duplicate-key,sk-key2';
      const status = getAuthStatus();
      expect(status.enabled).toBe(true);
      expect(status.keyCount).toBe(2);
    });
  });

  describe('authenticateRequest', () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
      mockRequest = {
        url: '/api/claude',
        method: 'POST',
        headers: {},
        ip: '127.0.0.1'
      };
      mockReply = {
        code: jest.fn().mockReturnThis() as any,
        send: jest.fn() as any
      };
    });

    it('should pass when authentication is disabled', async () => {
      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
    });

    it('should reject when authentication is enabled but no authorization header', async () => {
      process.env.API_KEY = 'sk-test-key';

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: {
          message: 'Invalid authentication credentials',
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
    });

    it('should reject when authorization header has wrong format', async () => {
      process.env.API_KEY = 'sk-test-key';
      mockRequest.headers = {
        authorization: 'Basic dXNlcjpwYXNz'
      };

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: {
          message: 'Invalid authentication credentials',
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
    });

    it('should reject when Bearer token is invalid', async () => {
      process.env.API_KEY = 'sk-valid-key';
      mockRequest.headers = {
        authorization: 'Bearer sk-invalid-key'
      };

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: {
          message: 'Invalid authentication credentials',
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
    });

    it('should pass when Bearer token matches API_KEY', async () => {
      process.env.API_KEY = 'sk-valid-key';
      mockRequest.headers = {
        authorization: 'Bearer sk-valid-key'
      };

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
    });

    it('should pass when Bearer token matches one of API_KEYS', async () => {
      process.env.API_KEYS = 'sk-key1,sk-valid-key,sk-key3';
      mockRequest.headers = {
        authorization: 'Bearer sk-valid-key'
      };

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
    });

    it('should handle case-insensitive Bearer prefix', async () => {
      process.env.API_KEY = 'sk-valid-key';
      mockRequest.headers = {
        authorization: 'bearer sk-valid-key'
      };

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
    });

    it('should handle Bearer token with extra whitespace', async () => {
      process.env.API_KEY = 'sk-valid-key';
      mockRequest.headers = {
        authorization: 'Bearer   sk-valid-key   '
      };

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
    });

    it('should work with combined API_KEY and API_KEYS', async () => {
      process.env.API_KEY = 'sk-single-key';
      process.env.API_KEYS = 'sk-key1,sk-key2';
      mockRequest.headers = {
        authorization: 'Bearer sk-key2'
      };

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
    });

    it('should reject empty Bearer token', async () => {
      process.env.API_KEY = 'sk-valid-key';
      mockRequest.headers = {
        authorization: 'Bearer '
      };

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: {
          message: 'Invalid authentication credentials',
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
    });

    it('should handle missing user-agent header', async () => {
      process.env.API_KEY = 'sk-valid-key';
      mockRequest.headers = {
        authorization: 'Bearer sk-valid-key'
      };
      // user-agent is undefined by default

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
    });

    it('should handle various request context properties', async () => {
      process.env.API_KEY = 'sk-valid-key';
      mockRequest = {
        url: '/v1/chat/completions',
        method: 'POST',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'user-agent': 'test-client/1.0'
        },
        ip: '192.168.1.100'
      };

      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });
});