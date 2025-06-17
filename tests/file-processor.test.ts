/**
 * Unit tests for FileProcessor class
 */

import { jest } from '@jest/globals';
import { FileProcessor } from '../src/file-processor';

// Mock logger
jest.mock('../src/logger', () => ({
  serverLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock global fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('FileProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isDataUri', () => {
    it('should return true for data URI', () => {
      expect(FileProcessor.isDataUri('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
      expect(FileProcessor.isDataUri('data:text/plain;charset=utf-8,Hello')).toBe(true);
    });

    it('should return false for non-data URI', () => {
      expect(FileProcessor.isDataUri('https://example.com/image.png')).toBe(false);
      expect(FileProcessor.isDataUri('http://example.com/file.txt')).toBe(false);
      expect(FileProcessor.isDataUri('/local/path/file.jpg')).toBe(false);
    });
  });

  describe('isHttpUrl', () => {
    it('should return true for HTTP/HTTPS URLs', () => {
      expect(FileProcessor.isHttpUrl('https://example.com/image.png')).toBe(true);
      expect(FileProcessor.isHttpUrl('http://example.com/file.txt')).toBe(true);
    });

    it('should return false for non-HTTP URLs', () => {
      expect(FileProcessor.isHttpUrl('data:image/png;base64,abc')).toBe(false);
      expect(FileProcessor.isHttpUrl('ftp://example.com/file.txt')).toBe(false);
      expect(FileProcessor.isHttpUrl('/local/path/file.jpg')).toBe(false);
    });
  });

  describe('extractContentTypeFromDataUri', () => {
    it('should extract content type from data URI', () => {
      expect(FileProcessor.extractContentTypeFromDataUri('data:image/png;base64,abc')).toBe('image/png');
      expect(FileProcessor.extractContentTypeFromDataUri('data:text/plain;charset=utf-8,hello')).toBe('text/plain');
      expect(FileProcessor.extractContentTypeFromDataUri('data:application/pdf;base64,JVBERi')).toBe('application/pdf');
    });

    it('should return default content type for invalid data URI', () => {
      expect(FileProcessor.extractContentTypeFromDataUri('invalid-uri')).toBe('application/octet-stream');
      expect(FileProcessor.extractContentTypeFromDataUri('data:;base64,abc')).toBe('application/octet-stream');
    });
  });

  describe('extractFilenameFromUrl', () => {
    it('should extract filename from URL', () => {
      expect(FileProcessor.extractFilenameFromUrl('https://example.com/path/image.png')).toBe('image.png');
      expect(FileProcessor.extractFilenameFromUrl('http://example.com/document.pdf')).toBe('document.pdf');
      expect(FileProcessor.extractFilenameFromUrl('https://example.com/path/to/file.txt')).toBe('file.txt');
    });

    it('should handle URLs without extension', () => {
      expect(FileProcessor.extractFilenameFromUrl('https://example.com/path/filename')).toBe('filename.bin');
      expect(FileProcessor.extractFilenameFromUrl('https://example.com/')).toBe('unknown.bin');
    });

    it('should handle invalid URLs', () => {
      expect(FileProcessor.extractFilenameFromUrl('invalid-url')).toBe('unknown.bin');
      expect(FileProcessor.extractFilenameFromUrl('')).toBe('unknown.bin');
    });
  });

  describe('generateFilenameFromContentType', () => {
    beforeEach(() => {
      // Mock Date.now() to return consistent timestamp
      jest.spyOn(Date, 'now').mockReturnValue(1640995200000); // 2022-01-01 00:00:00 UTC
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should generate filename with correct extension for known content types', () => {
      expect(FileProcessor.generateFilenameFromContentType('image/png')).toBe('file_1640995200000.png');
      expect(FileProcessor.generateFilenameFromContentType('image/jpeg')).toBe('file_1640995200000.jpg');
      expect(FileProcessor.generateFilenameFromContentType('application/pdf')).toBe('file_1640995200000.pdf');
      expect(FileProcessor.generateFilenameFromContentType('text/plain')).toBe('file_1640995200000.txt');
    });

    it('should use default extension for unknown content types', () => {
      expect(FileProcessor.generateFilenameFromContentType('unknown/type')).toBe('file_1640995200000.bin');
      expect(FileProcessor.generateFilenameFromContentType('')).toBe('file_1640995200000.bin');
    });
  });

  describe('processDataUri', () => {
    it('should process data URI successfully', () => {
      const dataUri = 'data:text/plain;base64,' + Buffer.from('Hello World').toString('base64');
      const result = FileProcessor.processDataUri(dataUri);

      expect(result).toEqual({
        file: Buffer.from('Hello World'),
        filename: expect.stringMatching(/^file_\d+\.txt$/),
        contentType: 'text/plain',
      });
    });

    it('should process image data URI', () => {
      const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAGAWW0d3gAAAABJRU5ErkJggg==';
      const dataUri = `data:image/png;base64,${imageData}`;
      const result = FileProcessor.processDataUri(dataUri);

      expect(result).toEqual({
        file: Buffer.from(imageData, 'base64'),
        filename: expect.stringMatching(/^file_\d+\.png$/),
        contentType: 'image/png',
      });
    });

    it('should throw error for invalid data URI', () => {
      expect(() => FileProcessor.processDataUri('data:text/plain;base64,')).toThrow('Failed to process data URI');
      expect(() => FileProcessor.processDataUri('invalid-data-uri')).toThrow('Failed to process data URI');
    });
  });

  describe('processUrl', () => {
    it('should download and process URL successfully', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: (jest.fn() as any).mockResolvedValue(new ArrayBuffer(12)),
        headers: {
          get: jest.fn().mockReturnValue('text/plain; charset=utf-8'),
        },
      } as any;
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await FileProcessor.processUrl('https://example.com/file.txt');

      expect(result).toEqual({
        file: expect.any(Buffer),
        filename: 'file.txt',
        contentType: 'text/plain',
      });
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/file.txt');
    });

    it('should handle different content types', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: (jest.fn() as any).mockResolvedValue(new ArrayBuffer(10)),
        headers: {
          get: jest.fn().mockReturnValue('image/jpeg'),
        },
      } as any;
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await FileProcessor.processUrl('https://example.com/image.jpg');

      expect(result.contentType).toBe('image/jpeg');
      expect(result.filename).toBe('image.jpg');
    });

    it('should throw error for HTTP errors', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as any;
      mockFetch.mockResolvedValue(mockResponse as any);

      await expect(FileProcessor.processUrl('https://example.com/notfound.txt')).rejects.toThrow(
        'Failed to download from URL: HTTP 404: Not Found'
      );
    });

    it('should throw error for network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(FileProcessor.processUrl('https://example.com/file.txt')).rejects.toThrow(
        'Failed to download from URL: Network error'
      );
    });
  });

  describe('processFileInput', () => {
    it('should return FileUploadRequest if already processed', async () => {
      const fileUpload = {
        file: Buffer.from('test'),
        filename: 'test.txt',
        contentType: 'text/plain',
        purpose: 'assistants',
      };

      const result = await FileProcessor.processFileInput(fileUpload);
      expect(result).toBe(fileUpload);
    });

    it('should process data URI', async () => {
      const dataUri = 'data:text/plain;base64,' + Buffer.from('Hello').toString('base64');
      const result = await FileProcessor.processFileInput(dataUri);

      expect(result.file).toEqual(Buffer.from('Hello'));
      expect(result.contentType).toBe('text/plain');
    });

    it('should process HTTP URL', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: (jest.fn() as any).mockResolvedValue(new ArrayBuffer(11)),
        headers: {
          get: jest.fn().mockReturnValue('text/plain'),
        },
      } as any;
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await FileProcessor.processFileInput('https://example.com/file.txt');

      expect(result.file).toEqual(expect.any(Buffer));
      expect(result.contentType).toBe('text/plain');
    });

    it('should throw error for unsupported input format', async () => {
      await expect(FileProcessor.processFileInput('/local/file/path')).rejects.toThrow(
        'Unsupported file input format'
      );
    });
  });

  describe('buildPromptWithFiles', () => {
    it('should return original prompt if no files', () => {
      const prompt = 'Tell me about this';
      const result = FileProcessor.buildPromptWithFiles(prompt, []);
      expect(result).toBe(prompt);
    });

    it('should prepend file list to prompt', () => {
      const prompt = 'Analyze these files';
      const files = ['./files/image.jpg', './files/document.pdf'];
      const result = FileProcessor.buildPromptWithFiles(prompt, files);
      
      expect(result).toBe('Files: ./files/image.jpg ./files/document.pdf\n\nAnalyze these files');
    });

    it('should handle single file', () => {
      const prompt = 'What is in this image?';
      const files = ['./files/photo.png'];
      const result = FileProcessor.buildPromptWithFiles(prompt, files);
      
      expect(result).toBe('Files: ./files/photo.png\n\nWhat is in this image?');
    });
  });

  describe('extractImageUrls', () => {
    it('should return empty array for string content', () => {
      const result = FileProcessor.extractImageUrls('text content');
      expect(result).toEqual([]);
    });

    it('should extract image URLs from message content', () => {
      const content = [
        { type: 'text', text: 'Look at this image:' },
        { type: 'image_url', image_url: { url: 'https://example.com/image1.jpg' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
        { type: 'text', text: 'And this text' },
      ];

      const result = FileProcessor.extractImageUrls(content);
      expect(result).toEqual([
        'https://example.com/image1.jpg',
        'data:image/png;base64,abc123'
      ]);
    });

    it('should handle content without image URLs', () => {
      const content = [
        { type: 'text', text: 'Just text content' },
        { type: 'text', text: 'More text' },
      ];

      const result = FileProcessor.extractImageUrls(content);
      expect(result).toEqual([]);
    });

    it('should handle malformed image_url entries', () => {
      const content = [
        { type: 'image_url' }, // Missing image_url property
        { type: 'image_url', image_url: { url: undefined } }, // Missing url property
        { type: 'image_url', image_url: { url: 'https://valid.com/image.jpg' } },
      ] as any;

      const result = FileProcessor.extractImageUrls(content);
      expect(result).toEqual(['https://valid.com/image.jpg']);
    });
  });

  describe('extractTextContent', () => {
    it('should return string content as-is', () => {
      const content = 'Simple text content';
      const result = FileProcessor.extractTextContent(content);
      expect(result).toBe(content);
    });

    it('should extract text from message content array', () => {
      const content = [
        { type: 'text', text: 'First part' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        { type: 'text', text: 'Second part' },
      ];

      const result = FileProcessor.extractTextContent(content);
      expect(result).toBe('First part\nSecond part');
    });

    it('should handle content with no text parts', () => {
      const content = [
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ];

      const result = FileProcessor.extractTextContent(content);
      expect(result).toBe('');
    });

    it('should handle malformed text entries', () => {
      const content = [
        { type: 'text', text: 'Valid text' },
        { type: 'text' }, // Missing text property
        { type: 'text', text: 'Another valid text' },
      ];

      const result = FileProcessor.extractTextContent(content);
      expect(result).toBe('Valid text\nAnother valid text');
    });
  });
});