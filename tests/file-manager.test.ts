/**
 * Unit tests for FileManager class
 */

import { jest } from '@jest/globals';
import { promises as fs } from 'fs';
import * as path from 'path';
import { FileManager, fileManager } from '../src/file-manager';
import { FileUploadRequest } from '../src/types';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
  },
}));

// Mock path module for tests
jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  relative: jest.fn((_from: string, to: string) => `relative/${to}`),
}));

// Mock crypto module
jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-1234-5678-9abc'),
}));

// Mock logger
jest.mock('../src/logger', () => ({
  serverLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

describe('FileManager', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockPath = path as jest.Mocked<typeof path>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton instance for each test
    (fileManager as any).fileStore = new (fileManager as any).fileStore.constructor();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = FileManager.getInstance();
      const instance2 = FileManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('generateFileId', () => {
    it('should generate file ID in OpenAI format', () => {
      const fileId = fileManager.generateFileId();
      expect(fileId).toBe('file-testuuid123456789abc');
    });
  });

  describe('generateFileName', () => {
    it('should generate filename with ID prefix', () => {
      const fileName = fileManager.generateFileName('file-123', 'test.jpg');
      expect(fileName).toBe('file-123_test.jpg');
    });
  });

  describe('getFilesDirectory', () => {
    it('should return correct files directory path', () => {
      mockPath.join.mockReturnValue('/workspace/files');
      const filesDir = fileManager.getFilesDirectory('/workspace');
      expect(filesDir).toBe('/workspace/files');
      expect(mockPath.join).toHaveBeenCalledWith('/workspace', 'files');
    });
  });

  describe('ensureFilesDirectory', () => {
    it('should create files directory successfully', async () => {
      mockPath.join.mockReturnValue('/workspace/files');
      mockFs.mkdir.mockResolvedValue(undefined);

      const filesDir = await fileManager.ensureFilesDirectory('/workspace');
      
      expect(filesDir).toBe('/workspace/files');
      expect(mockFs.mkdir).toHaveBeenCalledWith('/workspace/files', { recursive: true });
    });

    it('should throw error if directory creation fails', async () => {
      mockPath.join.mockReturnValue('/workspace/files');
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      await expect(fileManager.ensureFilesDirectory('/workspace')).rejects.toThrow(
        'Failed to create files directory: /workspace/files'
      );
    });
  });

  describe('saveFile', () => {
    const mockFileData: FileUploadRequest = {
      file: Buffer.from('test content'),
      filename: 'test.txt',
      contentType: 'text/plain',
      purpose: 'assistants',
    };

    beforeEach(() => {
      mockPath.join
        .mockReturnValueOnce('/workspace/files') // for ensureFilesDirectory
        .mockReturnValueOnce('/workspace/files/file-testuuid123456789abc_test.txt'); // for filePath
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
    });

    it('should save file successfully', async () => {
      const fileRecord = await fileManager.saveFile('/workspace', mockFileData);

      expect(fileRecord).toEqual({
        id: 'file-testuuid123456789abc',
        filename: 'test.txt',
        path: '/workspace/files/file-testuuid123456789abc_test.txt',
        contentType: 'text/plain',
        size: 12,
        uploadedAt: expect.any(Date),
      });
      
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/workspace/files/file-testuuid123456789abc_test.txt',
        mockFileData.file
      );
    });

    it('should throw error if file write fails', async () => {
      mockFs.writeFile.mockRejectedValue(new Error('Disk full'));

      await expect(fileManager.saveFile('/workspace', mockFileData)).rejects.toThrow(
        'Failed to save file: test.txt'
      );
    });
  });

  describe('getFile', () => {
    it('should return file record if exists', async () => {
      const mockFileData: FileUploadRequest = {
        file: Buffer.from('test'),
        filename: 'test.txt',
        contentType: 'text/plain',
        purpose: 'assistants',
      };

      // Setup mocks for saveFile
      mockPath.join
        .mockReturnValueOnce('/workspace/files')
        .mockReturnValueOnce('/workspace/files/file-testuuid123456789abc_test.txt');
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const savedFile = await fileManager.saveFile('/workspace', mockFileData);
      const retrievedFile = fileManager.getFile(savedFile.id);

      expect(retrievedFile).toEqual(savedFile);
    });

    it('should return undefined if file does not exist', () => {
      const result = fileManager.getFile('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getFileContent', () => {
    it('should return file content successfully', async () => {
      const mockContent = Buffer.from('file content');
      mockFs.readFile.mockResolvedValue(mockContent);

      // First save a file
      const mockFileData: FileUploadRequest = {
        file: Buffer.from('test'),
        filename: 'test.txt',
        contentType: 'text/plain',
        purpose: 'assistants',
      };

      mockPath.join
        .mockReturnValueOnce('/workspace/files')
        .mockReturnValueOnce('/workspace/files/file-testuuid123456789abc_test.txt');
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const savedFile = await fileManager.saveFile('/workspace', mockFileData);
      const content = await fileManager.getFileContent(savedFile.id);

      expect(content).toBe(mockContent);
      expect(mockFs.readFile).toHaveBeenCalledWith(savedFile.path);
    });

    it('should return null if file not found', async () => {
      const content = await fileManager.getFileContent('non-existent-id');
      expect(content).toBeNull();
    });

    it('should return null if file read fails', async () => {
      mockFs.readFile.mockRejectedValue(new Error('File not accessible'));

      // Save a file first
      const mockFileData: FileUploadRequest = {
        file: Buffer.from('test'),
        filename: 'test.txt',
        contentType: 'text/plain',
        purpose: 'assistants',
      };

      mockPath.join
        .mockReturnValueOnce('/workspace/files')
        .mockReturnValueOnce('/workspace/files/file-testuuid123456789abc_test.txt');
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const savedFile = await fileManager.saveFile('/workspace', mockFileData);
      const content = await fileManager.getFileContent(savedFile.id);

      expect(content).toBeNull();
    });
  });

  describe('toOpenAIFile', () => {
    it('should convert file record to OpenAI format', () => {
      const fileRecord = {
        id: 'file-123',
        filename: 'test.txt',
        path: '/workspace/files/file-123_test.txt',
        contentType: 'text/plain',
        size: 100,
        uploadedAt: new Date('2023-01-01T00:00:00Z'),
      };

      const openAIFile = fileManager.toOpenAIFile(fileRecord, 'assistants');

      expect(openAIFile).toEqual({
        id: 'file-123',
        object: 'file',
        bytes: 100,
        filename: 'test.txt',
        purpose: 'assistants',
        created_at: 1672531200, // Unix timestamp for 2023-01-01
      });
    });

    it('should use default purpose if not provided', () => {
      const fileRecord = {
        id: 'file-123',
        filename: 'test.txt',
        path: '/workspace/files/file-123_test.txt',
        contentType: 'text/plain',
        size: 100,
        uploadedAt: new Date('2023-01-01T00:00:00Z'),
      };

      const openAIFile = fileManager.toOpenAIFile(fileRecord);

      expect(openAIFile.purpose).toBe('assistants');
    });
  });

  describe('getRelativeFilePath', () => {
    it('should return relative file path for Claude CLI', () => {
      mockPath.relative.mockReturnValue('files/test.txt');
      
      const fileRecord = {
        id: 'file-123',
        filename: 'test.txt',
        path: '/workspace/files/test.txt',
        contentType: 'text/plain',
        size: 100,
        uploadedAt: new Date(),
      };

      const relativePath = fileManager.getRelativeFilePath(fileRecord, '/workspace');

      expect(relativePath).toBe('./files/test.txt');
      expect(mockPath.relative).toHaveBeenCalledWith('/workspace', '/workspace/files/test.txt');
    });
  });

  describe('deleteFile', () => {
    it('should delete file successfully', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      // Save a file first
      const mockFileData: FileUploadRequest = {
        file: Buffer.from('test'),
        filename: 'test.txt',
        contentType: 'text/plain',
        purpose: 'assistants',
      };

      mockPath.join
        .mockReturnValueOnce('/workspace/files')
        .mockReturnValueOnce('/workspace/files/file-testuuid123456789abc_test.txt');
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const savedFile = await fileManager.saveFile('/workspace', mockFileData);
      const result = await fileManager.deleteFile(savedFile.id);

      expect(result).toBe(true);
      expect(mockFs.unlink).toHaveBeenCalledWith(savedFile.path);
      expect(fileManager.getFile(savedFile.id)).toBeUndefined();
    });

    it('should return false if file does not exist', async () => {
      const result = await fileManager.deleteFile('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return false if file deletion fails', async () => {
      mockFs.unlink.mockRejectedValue(new Error('Permission denied'));

      // Save a file first
      const mockFileData: FileUploadRequest = {
        file: Buffer.from('test'),
        filename: 'test.txt',
        contentType: 'text/plain',
        purpose: 'assistants',
      };

      mockPath.join
        .mockReturnValueOnce('/workspace/files')
        .mockReturnValueOnce('/workspace/files/file-testuuid123456789abc_test.txt');
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const savedFile = await fileManager.saveFile('/workspace', mockFileData);
      const result = await fileManager.deleteFile(savedFile.id);

      expect(result).toBe(false);
    });
  });
});