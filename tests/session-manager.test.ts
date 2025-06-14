/**
 * Tests for session-manager module
 */

import { createWorkspace } from '../src/session-manager';
import { promises as fs } from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
  },
}));

// Mock path module
jest.mock('path');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;

describe('session-manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variables
    delete process.env.WORKSPACE_BASE_PATH;
  });

  describe('createWorkspace', () => {
    it('should create shared workspace when no name provided', async () => {
      const expectedPath = '/test/shared_workspace';
      mockPath.join.mockReturnValue(expectedPath);
      mockFs.mkdir.mockResolvedValue(undefined);

      const result = await createWorkspace();

      expect(mockFs.mkdir).toHaveBeenCalledWith(expectedPath, { recursive: true });
      expect(result).toBe(expectedPath);
    });

    it('should create named workspace when name provided', async () => {
      const workspaceName = 'test-project';
      const expectedPath = '/test/workspace/test-project';
      mockPath.join.mockReturnValue(expectedPath);
      mockFs.mkdir.mockResolvedValue(undefined);

      const result = await createWorkspace(workspaceName);

      expect(mockFs.mkdir).toHaveBeenCalledWith(expectedPath, { recursive: true });
      expect(result).toBe(expectedPath);
    });

    it('should use WORKSPACE_BASE_PATH environment variable when set', async () => {
      process.env.WORKSPACE_BASE_PATH = '/custom/base/path';
      const expectedPath = '/custom/base/path/shared_workspace';
      mockPath.join.mockReturnValue(expectedPath);
      mockFs.mkdir.mockResolvedValue(undefined);

      const result = await createWorkspace();

      expect(mockPath.join).toHaveBeenCalledWith('/custom/base/path', 'shared_workspace');
      expect(result).toBe(expectedPath);
    });

    it('should handle EEXIST error and return path', async () => {
      const expectedPath = '/test/shared_workspace';
      mockPath.join.mockReturnValue(expectedPath);
      const existsError = new Error('Directory exists') as any;
      existsError.code = 'EEXIST';
      mockFs.mkdir.mockRejectedValue(existsError);

      const result = await createWorkspace();

      expect(result).toBe(expectedPath);
    });

    it('should throw permission error for EACCES', async () => {
      const expectedPath = '/test/shared_workspace';
      mockPath.join.mockReturnValue(expectedPath);
      const permissionError = new Error('Permission denied') as any;
      permissionError.code = 'EACCES';
      mockFs.mkdir.mockRejectedValue(permissionError);

      await expect(createWorkspace()).rejects.toThrow(
        'Permission denied: Cannot create workspace directory at /test/shared_workspace. Check filesystem permissions.'
      );
    });

    it('should throw invalid path error for ENOTDIR', async () => {
      const expectedPath = '/test/shared_workspace';
      mockPath.join.mockReturnValue(expectedPath);
      const notDirError = new Error('Not a directory') as any;
      notDirError.code = 'ENOTDIR';
      mockFs.mkdir.mockRejectedValue(notDirError);

      await expect(createWorkspace()).rejects.toThrow(
        'Invalid path: Parent of /test/shared_workspace is not a directory.'
      );
    });

    it('should throw disk space error for ENOSPC', async () => {
      const expectedPath = '/test/shared_workspace';
      mockPath.join.mockReturnValue(expectedPath);
      const noSpaceError = new Error('No space left') as any;
      noSpaceError.code = 'ENOSPC';
      mockFs.mkdir.mockRejectedValue(noSpaceError);

      await expect(createWorkspace()).rejects.toThrow(
        'Insufficient disk space: Cannot create workspace directory at /test/shared_workspace.'
      );
    });

    it('should throw generic error for other filesystem errors', async () => {
      const expectedPath = '/test/shared_workspace';
      mockPath.join.mockReturnValue(expectedPath);
      const genericError = new Error('Generic filesystem error') as any;
      genericError.code = 'EOTHER';
      mockFs.mkdir.mockRejectedValue(genericError);

      await expect(createWorkspace()).rejects.toThrow(
        'Failed to create workspace directory at /test/shared_workspace: Generic filesystem error'
      );
    });
  });
});