/**
 * File processing utilities for URL/Data URI handling
 */

import { serverLogger } from './logger';

interface ProcessedFile {
  file: Buffer;
  filename: string;
  contentType: string;
}

/**
 * File processor for handling various file input formats
 */
export class FileProcessor {
  /**
   * Check if string is a data URI
   */
  static isDataUri(url: string): boolean {
    return url.startsWith('data:');
  }

  /**
   * Check if string is a HTTP/HTTPS URL
   */
  static isHttpUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
  }

  /**
   * Extract content type from data URI
   */
  static extractContentTypeFromDataUri(dataUri: string): string {
    const match = dataUri.match(/^data:([^;]+);/);
    return match ? match[1] : 'application/octet-stream';
  }

  /**
   * Extract filename from URL
   */
  static extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || 'unknown';
      return filename.includes('.') ? filename : `${filename}.bin`;
    } catch {
      return 'unknown.bin';
    }
  }

  /**
   * Generate filename from content type
   */
  static generateFilenameFromContentType(contentType: string): string {
    const extensionMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/avif': 'avif',
      'text/plain': 'txt',
      'application/pdf': 'pdf',
      'application/json': 'json',
      'text/csv': 'csv',
      'application/octet-stream': 'bin',
    };

    const extension = extensionMap[contentType] || 'bin';
    const timestamp = Date.now();
    return `file_${timestamp}.${extension}`;
  }

  /**
   * Process data URI and convert to processed file
   */
  static processDataUri(dataUri: string): ProcessedFile {
    serverLogger.debug(
      {
        type: 'data_uri_processing',
        dataUriPrefix: dataUri.substring(0, 50) + '...',
      },
      'Processing data URI'
    );

    try {
      // Extract content type
      const contentType = this.extractContentTypeFromDataUri(dataUri);

      // Extract base64 data
      const base64Data = dataUri.split(',')[1];
      if (!base64Data) {
        throw new Error('Invalid data URI format');
      }

      // Decode base64
      const buffer = Buffer.from(base64Data, 'base64');

      // Generate filename
      const filename = this.generateFilenameFromContentType(contentType);

      const result: ProcessedFile = {
        file: buffer,
        filename,
        contentType,
      };

      serverLogger.info(
        {
          type: 'data_uri_processed',
          filename,
          contentType,
          size: buffer.length,
        },
        `Data URI processed: ${filename}`
      );

      return result;
    } catch (error) {
      serverLogger.error(
        {
          type: 'data_uri_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to process data URI'
      );
      throw new Error(
        `Failed to process data URI: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Download file from URL and convert to processed file
   */
  static async processUrl(url: string): Promise<ProcessedFile> {
    serverLogger.debug(
      {
        type: 'url_processing',
        url,
      },
      'Processing URL'
    );

    try {
      // Use dynamic import for fetch (Node.js 18+)
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get content
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Extract content type from response headers
      let contentType = response.headers.get('content-type') || 'application/octet-stream';
      // Remove charset if present
      contentType = contentType.split(';')[0];

      // Extract filename from URL
      const filename = this.extractFilenameFromUrl(url);

      const result: ProcessedFile = {
        file: buffer,
        filename,
        contentType,
      };

      serverLogger.info(
        {
          type: 'url_processed',
          url,
          filename,
          contentType,
          size: buffer.length,
        },
        `URL processed: ${filename}`
      );

      return result;
    } catch (error) {
      serverLogger.error(
        {
          type: 'url_error',
          url,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to process URL'
      );
      throw new Error(
        `Failed to download from URL: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Process any file input (data URI, URL, or already processed file)
   */
  static async processFileInput(input: string | ProcessedFile): Promise<ProcessedFile> {
    if (typeof input === 'object') {
      // Already a ProcessedFile
      return input;
    }

    if (this.isDataUri(input)) {
      return this.processDataUri(input);
    }

    if (this.isHttpUrl(input)) {
      return await this.processUrl(input);
    }

    throw new Error(`Unsupported file input format: ${input.substring(0, 100)}`);
  }

  /**
   * Build Claude CLI prompt with file paths
   */
  static buildPromptWithFiles(userPrompt: string, filePaths: string[]): string {
    if (filePaths.length === 0) {
      return userPrompt;
    }

    const fileList = filePaths.join(' ');
    return `Files: ${fileList}\n\n${userPrompt}`;
  }

  /**
   * Extract image URLs from OpenAI message content
   */
  static extractImageUrls(
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  ): string[] {
    if (typeof content === 'string') {
      return [];
    }

    const imageUrls: string[] = [];
    for (const item of content) {
      if (item.type === 'image_url' && item.image_url?.url) {
        imageUrls.push(item.image_url.url);
      }
    }

    return imageUrls;
  }

  /**
   * Extract text content from OpenAI message content
   */
  static extractTextContent(
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  ): string {
    if (typeof content === 'string') {
      return content;
    }

    const textParts: string[] = [];
    for (const item of content) {
      if (item.type === 'text' && item.text) {
        textParts.push(item.text);
      }
    }

    return textParts.join('\n');
  }
}

// Export for convenience
export const fileProcessor = FileProcessor;
