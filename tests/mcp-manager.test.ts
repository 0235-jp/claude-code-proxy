/**
 * Tests for mcp-manager module
 */

import { loadMcpConfig, getMcpConfig, isMcpEnabled, validateMcpTools } from '../src/mcp-manager';
import { promises as fs } from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

// Mock path module
jest.mock('path');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;

describe('mcp-manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset internal state
    jest.resetModules();
  });

  describe('loadMcpConfig', () => {
    it('should load valid MCP configuration', async () => {
      const mockConfig = {
        mcpServers: {
          github: { command: 'node', args: ['github-server.js'] },
          filesystem: { command: 'node', args: ['fs-server.js'] },
        },
      };

      mockPath.join.mockReturnValue('/test/mcp-config.json');
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      const result = await loadMcpConfig();

      expect(mockFs.readFile).toHaveBeenCalledWith('/test/mcp-config.json', 'utf8');
      expect(result).toEqual(mockConfig);
    });

    it('should handle missing config file (ENOENT)', async () => {
      const fileNotFoundError = new Error('File not found') as any;
      fileNotFoundError.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(fileNotFoundError);

      const result = await loadMcpConfig();

      expect(result).toBeNull();
    });

    it('should handle JSON parse errors', async () => {
      mockFs.readFile.mockResolvedValue('invalid json {');

      const result = await loadMcpConfig();

      expect(result).toBeNull();
    });

    it('should handle other file system errors', async () => {
      const permissionError = new Error('Permission denied') as any;
      permissionError.code = 'EACCES';
      mockFs.readFile.mockRejectedValue(permissionError);

      const result = await loadMcpConfig();

      expect(result).toBeNull();
    });
  });

  describe('getMcpConfig', () => {
    it('should return null initially', () => {
      const result = getMcpConfig();
      expect(result).toBeNull();
    });

    it('should return loaded config after loadMcpConfig is called', async () => {
      const mockConfig = {
        mcpServers: {
          github: { command: 'node', args: ['github-server.js'] },
        },
      };

      mockPath.join.mockReturnValue('/test/mcp-config.json');
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      await loadMcpConfig();
      const result = getMcpConfig();

      expect(result).toEqual(mockConfig);
    });
  });

  describe('isMcpEnabled', () => {
    it('should return false when config is null', async () => {
      // Ensure config is null by simulating file not found
      const fileNotFoundError = new Error('File not found') as any;
      fileNotFoundError.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(fileNotFoundError);
      
      await loadMcpConfig(); // This should set config to null
      const result = isMcpEnabled();
      expect(result).toBe(false);
    });

    it('should return false when no servers configured', async () => {
      const mockConfig = { mcpServers: {} };

      mockPath.join.mockReturnValue('/test/mcp-config.json');
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      await loadMcpConfig();
      const result = isMcpEnabled();

      expect(result).toBe(false);
    });

    it('should return true when servers are configured', async () => {
      const mockConfig = {
        mcpServers: {
          github: { command: 'node', args: ['github-server.js'] },
        },
      };

      mockPath.join.mockReturnValue('/test/mcp-config.json');
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      await loadMcpConfig();
      const result = isMcpEnabled();

      expect(result).toBe(true);
    });
  });

  describe('validateMcpTools', () => {
    beforeEach(async () => {
      const mockConfig = {
        mcpServers: {
          github: { command: 'node', args: ['github-server.js'] },
          filesystem: { command: 'node', args: ['fs-server.js'] },
        },
      };

      mockPath.join.mockReturnValue('/test/mcp-config.json');
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      await loadMcpConfig();
    });

    it('should return empty array when MCP is not enabled', async () => {
      // Reset to null config
      const fileNotFoundError = new Error('File not found') as any;
      fileNotFoundError.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(fileNotFoundError);
      await loadMcpConfig(); // This will set config to null
      
      const result = validateMcpTools(['mcp__github__listRepos']);
      expect(result).toEqual([]);
    });

    it('should return empty array for null/undefined tools', () => {
      expect(validateMcpTools(null as any)).toEqual([]);
      expect(validateMcpTools(undefined as any)).toEqual([]);
      expect(validateMcpTools('not-array' as any)).toEqual([]);
    });

    it('should filter valid MCP tools', () => {
      const requestedTools = [
        'mcp__github__listRepos',
        'mcp__filesystem__readFile',
        'mcp__unknown__someMethod',
        'regularTool',
      ];

      const result = validateMcpTools(requestedTools);

      expect(result).toEqual([
        'mcp__github__listRepos',
        'mcp__filesystem__readFile',
      ]);
    });

    it('should return empty array when no valid tools found', () => {
      const requestedTools = [
        'mcp__unknown__someMethod',
        'regularTool',
        'anotherTool',
      ];

      const result = validateMcpTools(requestedTools);

      expect(result).toEqual([]);
    });

    it('should handle empty tools array', () => {
      const result = validateMcpTools([]);
      expect(result).toEqual([]);
    });
  });
});