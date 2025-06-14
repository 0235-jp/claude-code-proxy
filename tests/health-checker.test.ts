/**
 * Health checker tests
 */

import { jest } from '@jest/globals';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import {
  checkClaudeCli,
  checkWorkspace,
  checkMcpConfig,
  performHealthCheck,
  getUptime,
  getVersion
} from '../src/health-checker';
import * as mcpManager from '../src/mcp-manager';

// Mock dependencies
jest.mock('child_process');
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    mkdir: jest.fn(),
    rmdir: jest.fn(),
    readFile: jest.fn()
  }
}));
jest.mock('../src/mcp-manager');

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockFs = fs as jest.Mocked<typeof fs>;
const mockMcpManager = mcpManager as jest.Mocked<typeof mcpManager>;

describe('Health Checker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('checkClaudeCli', () => {
    it('should return healthy when Claude CLI is available', async () => {
      const mockProcess = {
        stdout: {
          on: jest.fn((event: string, callback: (data: Buffer) => void) => {
            if (event === 'data') {
              callback(Buffer.from('1.0.24 (Claude Code)\n'));
            }
          })
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn((event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            callback(0); // Exit code 0 for success
          }
        }),
        killed: false,
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const result = await checkClaudeCli();

      expect(result.status).toBe('healthy');
      expect(result.message).toBe('Claude CLI is available and responsive');
      expect(result.details).toMatchObject({
        version: '1.0.24 (Claude Code)',
        exitCode: 0
      });
      expect(result.timestamp).toBeDefined();
    });

    it('should return unhealthy when Claude CLI returns non-zero exit code', async () => {
      const mockProcess = {
        stdout: {
          on: jest.fn()
        },
        stderr: {
          on: jest.fn((event: string, callback: (data: Buffer) => void) => {
            if (event === 'data') {
              callback(Buffer.from('Command not found\n'));
            }
          })
        },
        on: jest.fn((event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            callback(1); // Exit code 1 for error
          }
        }),
        killed: false,
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const result = await checkClaudeCli();

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Claude CLI returned non-zero exit code');
      expect(result.details).toMatchObject({
        exitCode: 1,
        stderr: 'Command not found'
      });
    });

    it('should return unhealthy when Claude CLI process errors', async () => {
      const mockProcess = {
        stdout: {
          on: jest.fn()
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn((event: string, callback: (error: Error) => void) => {
          if (event === 'error') {
            callback(new Error('ENOENT: command not found'));
          }
        }),
        killed: false,
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const result = await checkClaudeCli();

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Claude CLI is not available or not working');
      expect(result.details).toMatchObject({
        error: 'ENOENT: command not found',
        name: 'Error'
      });
    });

    it('should handle timeout by killing process', async () => {
      const mockProcess = {
        stdout: {
          on: jest.fn()
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn(),
        killed: false,
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      // Start the check
      const resultPromise = checkClaudeCli();

      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(5000);

      const result = await resultPromise;

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Claude CLI check timed out');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('checkWorkspace', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return healthy when workspace is accessible and writable', async () => {
      const mockStats = { isDirectory: () => true };
      mockFs.stat.mockResolvedValue(mockStats as any);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.rmdir.mockResolvedValue(undefined);

      const result = await checkWorkspace();

      expect(result.status).toBe('healthy');
      expect(result.message).toBe('Workspace directory is accessible and writable');
      expect(result.details).toMatchObject({
        readable: true,
        writable: true
      });
    });

    it('should return unhealthy when workspace path is not a directory', async () => {
      const mockStats = { isDirectory: () => false };
      mockFs.stat.mockResolvedValue(mockStats as any);

      const result = await checkWorkspace();

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Workspace base path is not a directory');
      expect(result.details).toMatchObject({
        type: 'file'
      });
    });

    it('should return degraded when workspace is readable but not writable', async () => {
      const mockStats = { isDirectory: () => true };
      mockFs.stat.mockResolvedValue(mockStats as any);
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      const result = await checkWorkspace();

      expect(result.status).toBe('degraded');
      expect(result.message).toBe('Workspace directory is readable but not writable');
      expect(result.details).toMatchObject({
        readable: true,
        writable: false,
        writeError: 'Permission denied'
      });
    });

    it('should return unhealthy when workspace is not accessible', async () => {
      mockFs.stat.mockRejectedValue(new Error('No such file or directory'));

      const result = await checkWorkspace();

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Workspace directory is not accessible');
      expect(result.details).toMatchObject({
        error: 'No such file or directory'
      });
    });

    it('should use WORKSPACE_BASE_PATH environment variable', async () => {
      process.env.WORKSPACE_BASE_PATH = '/custom/workspace';
      const mockStats = { isDirectory: () => true };
      mockFs.stat.mockResolvedValue(mockStats as any);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.rmdir.mockResolvedValue(undefined);

      const result = await checkWorkspace();

      expect(mockFs.stat).toHaveBeenCalledWith('/custom/workspace');
      expect(result.status).toBe('healthy');
      expect(result.details?.path).toBe('/custom/workspace');
    });
  });

  describe('checkMcpConfig', () => {
    it('should return healthy when MCP is disabled', async () => {
      mockMcpManager.isMcpEnabled.mockReturnValue(false);

      const result = await checkMcpConfig();

      expect(result.status).toBe('healthy');
      expect(result.message).toBe('MCP is disabled (no configuration file found)');
      expect(result.details).toMatchObject({
        enabled: false
      });
    });

    it('should return degraded when MCP is enabled but no servers configured', async () => {
      mockMcpManager.isMcpEnabled.mockReturnValue(true);
      mockMcpManager.getMcpConfig.mockReturnValue({
        mcpServers: {}
      });

      const result = await checkMcpConfig();

      expect(result.status).toBe('degraded');
      expect(result.message).toBe('MCP is enabled but no servers configured');
      expect(result.details).toMatchObject({
        enabled: true,
        serverCount: 0
      });
    });

    it('should return healthy when MCP is enabled with servers configured', async () => {
      mockMcpManager.isMcpEnabled.mockReturnValue(true);
      mockMcpManager.getMcpConfig.mockReturnValue({
        mcpServers: {
          'github': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
          'deepwiki': { command: 'uv', args: ['--directory', 'servers/src/deepwiki', 'run', 'deepwiki'] }
        }
      });

      const result = await checkMcpConfig();

      expect(result.status).toBe('healthy');
      expect(result.message).toBe('MCP configuration is valid and servers are configured');
      expect(result.details).toMatchObject({
        enabled: true,
        serverCount: 2,
        servers: ['github', 'deepwiki']
      });
    });

    it('should return unhealthy when MCP configuration is invalid', async () => {
      mockMcpManager.isMcpEnabled.mockReturnValue(true);
      mockMcpManager.getMcpConfig.mockImplementation(() => {
        throw new Error('Invalid JSON');
      });

      const result = await checkMcpConfig();

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('MCP configuration is invalid or corrupted');
      expect(result.details).toMatchObject({
        enabled: true,
        error: 'Invalid JSON'
      });
    });

    it('should use MCP_CONFIG_PATH environment variable', async () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv, MCP_CONFIG_PATH: '/custom/mcp-config.json' };

      mockMcpManager.isMcpEnabled.mockReturnValue(false);

      const result = await checkMcpConfig();

      expect(result.details?.configPath).toBe('/custom/mcp-config.json');

      process.env = originalEnv;
    });
  });

  describe('getUptime', () => {
    it('should return process uptime', () => {
      const originalUptime = process.uptime;
      process.uptime = jest.fn(() => 123.456);

      const uptime = getUptime();

      expect(uptime).toBe(123.456);

      process.uptime = originalUptime;
    });
  });

  describe('getVersion', () => {
    it('should return version from package.json', async () => {
      mockFs.readFile.mockResolvedValue('{"version": "1.0.0"}');

      const version = await getVersion();

      expect(version).toBe('1.0.0');
      expect(mockFs.readFile).toHaveBeenCalledWith(
        expect.stringContaining('package.json'),
        'utf-8'
      );
    });

    it('should return "unknown" when package.json cannot be read', async () => {
      mockFs.readFile.mockRejectedValue(new Error('File not found'));

      const version = await getVersion();

      expect(version).toBe('unknown');
    });

    it('should return "unknown" when package.json has no version', async () => {
      mockFs.readFile.mockResolvedValue('{"name": "test"}');

      const version = await getVersion();

      expect(version).toBe('unknown');
    });
  });

  describe('performHealthCheck', () => {
    it('should return overall healthy status when all checks pass', async () => {
      // Mock spawn to return healthy CLI check
      const mockProcess = {
        stdout: { on: jest.fn((event: string, callback: (data: Buffer) => void) => {
          if (event === 'data') callback(Buffer.from('1.0.24 (Claude Code)\n'));
        }) },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, callback: (code: number) => void) => {
          if (event === 'close') callback(0);
        }),
        killed: false,
        kill: jest.fn()
      };
      mockSpawn.mockReturnValue(mockProcess as any);

      // Mock workspace as accessible
      const mockStats = { isDirectory: () => true };
      mockFs.stat.mockResolvedValue(mockStats as any);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.rmdir.mockResolvedValue(undefined);

      // Mock MCP as disabled
      mockMcpManager.isMcpEnabled.mockReturnValue(false);

      // Mock package.json reading
      mockFs.readFile.mockResolvedValue('{"version": "1.0.0"}');

      const result = await performHealthCheck();

      expect(result.status).toBe('healthy');
      expect(result.version).toBe('1.0.0');
      expect(result.checks).toHaveProperty('claudeCli');
      expect(result.checks).toHaveProperty('workspace');
      expect(result.checks).toHaveProperty('mcpConfig');
    });

    it('should return degraded status when workspace is degraded', async () => {
      // Mock spawn to return healthy CLI check
      const mockProcess = {
        stdout: { on: jest.fn((event: string, callback: (data: Buffer) => void) => {
          if (event === 'data') callback(Buffer.from('1.0.24 (Claude Code)\n'));
        }) },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, callback: (code: number) => void) => {
          if (event === 'close') callback(0);
        }),
        killed: false,
        kill: jest.fn()
      };
      mockSpawn.mockReturnValue(mockProcess as any);

      // Mock workspace as readable but not writable
      const mockStats = { isDirectory: () => true };
      mockFs.stat.mockResolvedValue(mockStats as any);
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      // Mock MCP as disabled
      mockMcpManager.isMcpEnabled.mockReturnValue(false);

      // Mock package.json reading
      mockFs.readFile.mockResolvedValue('{"version": "1.0.0"}');

      const result = await performHealthCheck();

      expect(result.status).toBe('degraded');
    });

    it('should return unhealthy status when CLI is unhealthy', async () => {
      // Mock spawn to return error
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, callback: (error: Error) => void) => {
          if (event === 'error') callback(new Error('Command not found'));
        }),
        killed: false,
        kill: jest.fn()
      };
      mockSpawn.mockReturnValue(mockProcess as any);

      // Mock workspace as accessible
      const mockStats = { isDirectory: () => true };
      mockFs.stat.mockResolvedValue(mockStats as any);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.rmdir.mockResolvedValue(undefined);

      // Mock MCP as disabled
      mockMcpManager.isMcpEnabled.mockReturnValue(false);

      // Mock package.json reading
      mockFs.readFile.mockResolvedValue('{"version": "1.0.0"}');

      const result = await performHealthCheck();

      expect(result.status).toBe('unhealthy');
    });
  });
});