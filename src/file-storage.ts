/**
 * File storage management for OpenAI File API compatibility
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { serverLogger } from './logger';

export interface FileMetadata {
  id: string;
  object: 'file';
  bytes: number;
  filename: string;
  purpose: string;
  created_at: number;
  filepath: string; // Full path to the file
}

class FileStorage {
  private fileMap: Map<string, FileMetadata> = new Map();
  private filesDirectory: string;

  constructor() {
    const workspaceBasePath = process.env.WORKSPACE_BASE_PATH || process.cwd();
    this.filesDirectory = path.join(workspaceBasePath, 'files');
  }

  /**
   * Initialize the file storage directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.filesDirectory, { recursive: true });
      serverLogger.info(
        {
          type: 'file_storage_initialized',
          filesDirectory: this.filesDirectory,
        },
        'File storage initialized'
      );
    } catch (error) {
      serverLogger.error(
        {
          type: 'file_storage_init_error',
          error: error instanceof Error ? error.message : 'Unknown error',
          filesDirectory: this.filesDirectory,
        },
        'Failed to initialize file storage'
      );
      throw error;
    }
  }

  /**
   * Save a file and return its metadata
   */
  async saveFile(
    fileData: Buffer,
    filename: string,
    purpose: string = 'assistants'
  ): Promise<FileMetadata> {
    const fileId = `file-${uuidv4().replace(/-/g, '')}`;
    const safeFilename = path.basename(filename); // Basic safety measure
    const filepath = path.join(this.filesDirectory, `${fileId}_${safeFilename}`);

    try {
      await fs.writeFile(filepath, fileData);

      const metadata: FileMetadata = {
        id: fileId,
        object: 'file',
        bytes: fileData.length,
        filename: safeFilename,
        purpose,
        created_at: Math.floor(Date.now() / 1000),
        filepath,
      };

      this.fileMap.set(fileId, metadata);

      serverLogger.info(
        {
          type: 'file_saved',
          fileId,
          filename: safeFilename,
          bytes: fileData.length,
          purpose,
        },
        `File saved: ${fileId}`
      );

      return metadata;
    } catch (error) {
      serverLogger.error(
        {
          type: 'file_save_error',
          error: error instanceof Error ? error.message : 'Unknown error',
          filename,
        },
        'Failed to save file'
      );
      throw error;
    }
  }

  /**
   * Get file metadata by ID
   */
  async getFileMetadata(fileId: string): Promise<FileMetadata | null> {
    const metadata = this.fileMap.get(fileId);
    if (!metadata) {
      return null;
    }

    // Verify file still exists
    try {
      await fs.access(metadata.filepath);
      return metadata;
    } catch {
      // File no longer exists, remove from map
      this.fileMap.delete(fileId);
      return null;
    }
  }

  /**
   * Get file path by ID
   */
  async getFilePath(fileId: string): Promise<string | null> {
    const metadata = await this.getFileMetadata(fileId);
    return metadata ? metadata.filepath : null;
  }

  /**
   * Get file content by ID
   */
  async getFileContent(fileId: string): Promise<Buffer | null> {
    const metadata = await this.getFileMetadata(fileId);
    if (!metadata) {
      return null;
    }

    try {
      return await fs.readFile(metadata.filepath);
    } catch (error) {
      serverLogger.error(
        {
          type: 'file_read_error',
          error: error instanceof Error ? error.message : 'Unknown error',
          fileId,
        },
        'Failed to read file'
      );
      return null;
    }
  }

  /**
   * Convert metadata to OpenAI API response format
   */
  toApiResponse(metadata: FileMetadata): Omit<FileMetadata, 'filepath'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    const { filepath, ...response } = metadata;
    return response;
  }
}

// Export singleton instance
export const fileStorage = new FileStorage();