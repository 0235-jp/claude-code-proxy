/**
 * File management system for Claude Code Server
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { FileRecord, OpenAIFile, FileUploadRequest } from './types';
import { serverLogger } from './logger';

/**
 * In-memory file storage for simplicity
 */
class FileStore {
  private files = new Map<string, FileRecord>();

  set(id: string, record: FileRecord): void {
    this.files.set(id, record);
  }

  get(id: string): FileRecord | undefined {
    return this.files.get(id);
  }

  delete(id: string): boolean {
    return this.files.delete(id);
  }

  list(): FileRecord[] {
    return Array.from(this.files.values());
  }
}

/**
 * File manager for handling file operations
 */
export class FileManager {
  private static instance: FileManager;
  private fileStore = new FileStore();

  private constructor() {}

  static getInstance(): FileManager {
    if (!FileManager.instance) {
      FileManager.instance = new FileManager();
    }
    return FileManager.instance;
  }

  /**
   * Generate a unique file ID in OpenAI format
   */
  generateFileId(): string {
    return `file-${randomUUID().replace(/-/g, '')}`;
  }

  /**
   * Generate filename with unique ID prefix
   */
  generateFileName(fileId: string, originalName: string): string {
    return `${fileId}_${originalName}`;
  }

  /**
   * Get workspace files directory path
   */
  getFilesDirectory(workspacePath: string): string {
    return path.join(workspacePath, 'files');
  }

  /**
   * Ensure files directory exists
   */
  async ensureFilesDirectory(workspacePath: string): Promise<string> {
    const filesDir = this.getFilesDirectory(workspacePath);

    try {
      await fs.mkdir(filesDir, { recursive: true });
      serverLogger.debug(
        {
          type: 'files_directory_created',
          filesDir,
        },
        `Files directory created: ${filesDir}`
      );
      return filesDir;
    } catch (error) {
      serverLogger.error(
        {
          type: 'files_directory_error',
          filesDir,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to create files directory'
      );
      throw new Error(`Failed to create files directory: ${filesDir}`);
    }
  }

  /**
   * Save file to workspace
   */
  async saveFile(workspacePath: string, fileData: FileUploadRequest): Promise<FileRecord> {
    const fileId = this.generateFileId();
    const fileName = this.generateFileName(fileId, fileData.filename);
    const filesDir = await this.ensureFilesDirectory(workspacePath);
    const filePath = path.join(filesDir, fileName);

    try {
      // Write file to disk
      await fs.writeFile(filePath, fileData.file);

      // Create file record
      const fileRecord: FileRecord = {
        id: fileId,
        filename: fileData.filename,
        path: filePath,
        contentType: fileData.contentType,
        size: fileData.file.length,
        uploadedAt: new Date(),
      };

      // Store in memory
      this.fileStore.set(fileId, fileRecord);

      serverLogger.info(
        {
          type: 'file_saved',
          fileId,
          filename: fileData.filename,
          size: fileData.file.length,
          contentType: fileData.contentType,
          path: filePath,
        },
        `File saved: ${fileName}`
      );

      return fileRecord;
    } catch (error) {
      serverLogger.error(
        {
          type: 'file_save_error',
          fileId,
          filename: fileData.filename,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to save file'
      );
      throw new Error(`Failed to save file: ${fileData.filename}`);
    }
  }

  /**
   * Get file record by ID
   */
  getFile(fileId: string): FileRecord | undefined {
    return this.fileStore.get(fileId);
  }

  /**
   * Get file content as buffer
   */
  async getFileContent(fileId: string): Promise<Buffer | null> {
    const fileRecord = this.getFile(fileId);
    if (!fileRecord) {
      return null;
    }

    try {
      const content = await fs.readFile(fileRecord.path);
      serverLogger.debug(
        {
          type: 'file_content_read',
          fileId,
          size: content.length,
        },
        `File content read: ${fileRecord.filename}`
      );
      return content;
    } catch (error) {
      serverLogger.error(
        {
          type: 'file_content_error',
          fileId,
          path: fileRecord.path,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to read file content'
      );
      return null;
    }
  }

  /**
   * Convert file record to OpenAI file format
   */
  toOpenAIFile(fileRecord: FileRecord, purpose: string = 'assistants'): OpenAIFile {
    return {
      id: fileRecord.id,
      object: 'file',
      bytes: fileRecord.size,
      filename: fileRecord.filename,
      purpose,
      created_at: Math.floor(fileRecord.uploadedAt.getTime() / 1000),
    };
  }

  /**
   * Get relative file path for Claude CLI
   */
  getRelativeFilePath(fileRecord: FileRecord, workspacePath: string): string {
    const relativePath = path.relative(workspacePath, fileRecord.path);
    return `./${relativePath}`;
  }

  /**
   * List all files
   */
  listFiles(): FileRecord[] {
    return this.fileStore.list();
  }

  /**
   * Delete file
   */
  async deleteFile(fileId: string): Promise<boolean> {
    const fileRecord = this.getFile(fileId);
    if (!fileRecord) {
      return false;
    }

    try {
      // Delete from disk
      await fs.unlink(fileRecord.path);

      // Remove from memory
      this.fileStore.delete(fileId);

      serverLogger.info(
        {
          type: 'file_deleted',
          fileId,
          filename: fileRecord.filename,
        },
        `File deleted: ${fileRecord.filename}`
      );

      return true;
    } catch (error) {
      serverLogger.error(
        {
          type: 'file_delete_error',
          fileId,
          path: fileRecord.path,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to delete file'
      );
      return false;
    }
  }
}

// Export singleton instance
export const fileManager = FileManager.getInstance();
