/**
 * E2E tests for OpenAI Files API
 */

import FormData from 'form-data';
import fetch from 'node-fetch';

describe('OpenAI Files API E2E Tests', () => {
  const baseUrl = process.env.TEST_SERVER_URL || 'http://localhost:3015';
  const apiKey = 'test-api-key-12345';

  let uploadedFileId: string;

  beforeAll(async () => {
    // Wait for server to be ready
    let retries = 10;
    while (retries > 0) {
      try {
        const response = await fetch(`${baseUrl}/health`);
        if (response.ok) break;
      } catch (error) {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries--;
    }
    
    if (retries === 0) {
      throw new Error('Test server is not available');
    }
  });

  describe('File Upload', () => {
    it('should upload file successfully', async () => {
      const form = new FormData();
      const fileContent = Buffer.from('This is a test file content');
      form.append('file', fileContent, {
        filename: 'test.txt',
        contentType: 'text/plain',
      });
      form.append('purpose', 'assistants');

      const response = await fetch(`${baseUrl}/v1/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        body: form,
      });

      expect(response.status).toBe(200);
      
      const result = await response.json() as any;
      uploadedFileId = result.id;

      expect(result).toEqual({
        id: expect.stringMatching(/^file-[a-f0-9]+$/),
        object: 'file',
        bytes: fileContent.length,
        filename: 'test.txt',
        purpose: 'assistants',
        created_at: expect.any(Number),
      });
    });

    it('should upload image file successfully', async () => {
      const form = new FormData();
      // Create a minimal valid PNG image (1x1 pixel)
      const pngData = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
        0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0x00, 0x01, // width: 1
        0x00, 0x00, 0x00, 0x01, // height: 1
        0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
        0x90, 0x77, 0x53, 0xDE, // CRC
        0x00, 0x00, 0x00, 0x0C, // IDAT chunk length
        0x49, 0x44, 0x41, 0x54, // IDAT
        0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // compressed data
        0xE2, 0x21, 0xBC, 0x33, // CRC
        0x00, 0x00, 0x00, 0x00, // IEND chunk length
        0x49, 0x45, 0x4E, 0x44, // IEND
        0xAE, 0x42, 0x60, 0x82, // CRC
      ]);

      form.append('file', pngData, {
        filename: 'test-image.png',
        contentType: 'image/png',
      });
      form.append('purpose', 'assistants');

      const response = await fetch(`${baseUrl}/v1/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        body: form,
      });

      expect(response.status).toBe(200);
      
      const result = await response.json();

      expect(result).toEqual({
        id: expect.stringMatching(/^file-[a-f0-9]+$/),
        object: 'file',
        bytes: pngData.length,
        filename: 'test-image.png',
        purpose: 'assistants',
        created_at: expect.any(Number),
      });
    });

    it('should require authentication', async () => {
      const form = new FormData();
      form.append('file', Buffer.from('test'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      });

      const response = await fetch(`${baseUrl}/v1/files`, {
        method: 'POST',
        headers: form.getHeaders(),
        body: form,
      });

      expect(response.status).toBe(401);
    });

    it('should reject invalid API key', async () => {
      const form = new FormData();
      form.append('file', Buffer.from('test'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      });

      const response = await fetch(`${baseUrl}/v1/files`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-key',
          ...form.getHeaders(),
        },
        body: form,
      });

      expect(response.status).toBe(401);
    });

    it('should reject request without file', async () => {
      const form = new FormData();
      form.append('purpose', 'assistants');

      const response = await fetch(`${baseUrl}/v1/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        body: form,
      });

      expect(response.status).toBe(400);
    });
  });

  describe('File Metadata Retrieval', () => {
    it('should get file metadata successfully', async () => {
      const response = await fetch(`${baseUrl}/v1/files/${uploadedFileId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      expect(response.status).toBe(200);
      
      const result = await response.json();

      expect(result).toEqual({
        id: uploadedFileId,
        object: 'file',
        bytes: expect.any(Number),
        filename: 'test.txt',
        purpose: 'assistants',
        created_at: expect.any(Number),
      });
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/v1/files/${uploadedFileId}`);

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(`${baseUrl}/v1/files/file-nonexistent`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      expect(response.status).toBe(404);
    });
  });

  describe('File Content Retrieval', () => {
    it('should get file content successfully', async () => {
      const response = await fetch(`${baseUrl}/v1/files/${uploadedFileId}/content`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-disposition')).toContain('filename="test.txt"');
      
      const content = await response.text();
      expect(content).toBe('This is a test file content');
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/v1/files/${uploadedFileId}/content`);

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(`${baseUrl}/v1/files/file-nonexistent/content`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      expect(response.status).toBe(404);
    });
  });

  describe('Integration with Chat Completions', () => {
    it('should support files parameter in chat completions', async () => {
      // Upload a test file first
      const form = new FormData();
      const fileContent = Buffer.from('Test document content for analysis');
      form.append('file', fileContent, {
        filename: 'analysis.txt',
        contentType: 'text/plain',
      });
      form.append('purpose', 'assistants');

      const uploadResponse = await fetch(`${baseUrl}/v1/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        body: form,
      });

      expect(uploadResponse.status).toBe(200);
      const uploadResult = await uploadResponse.json() as any;

      // Use the file in chat completions with file_id in content
      const chatResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-code',
          messages: [
            { 
              role: 'user', 
              content: [
                { type: 'text', text: 'What is the content of this file?' },
                { type: 'file', file: { file_id: uploadResult.id } }
              ]
            }
          ],
          stream: true,
        }),
      });

      expect(chatResponse.status).toBe(200);
      expect(chatResponse.headers.get('content-type')).toContain('text/event-stream');

      // Read the streaming response
      const reader = (chatResponse.body as any)?.getReader();
      if (!reader) {
        throw new Error('No response body reader');
      }

      let receivedData = '';
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        const { done, value } = await reader.read();
        if (done) break;
        
        receivedData += new TextDecoder().decode(value);
        attempts++;
        
        // Stop early if we receive some data
        if (receivedData.includes('data:')) {
          break;
        }
      }

      reader.releaseLock();

      // Verify that we received streaming data
      expect(receivedData).toContain('data:');
      expect(receivedData).toMatch(/"object":"chat\.completion\.chunk"/);
    });

    it('should support image_url in messages', async () => {
      // Test with a data URI image
      const imageDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAGAWW0d3gAAAABJRU5ErkJggg==';

      const chatResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What do you see in this image?' },
                { type: 'image_url', image_url: { url: imageDataUri } }
              ]
            }
          ],
          stream: true,
        }),
      });

      expect(chatResponse.status).toBe(200);
      expect(chatResponse.headers.get('content-type')).toContain('text/event-stream');

      // Read some of the streaming response
      const reader = (chatResponse.body as any)?.getReader();
      if (!reader) {
        throw new Error('No response body reader');
      }

      let receivedData = '';
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        const { done, value } = await reader.read();
        if (done) break;
        
        receivedData += new TextDecoder().decode(value);
        attempts++;
        
        if (receivedData.includes('data:')) {
          break;
        }
      }

      reader.releaseLock();

      // Verify that we received streaming data
      expect(receivedData).toContain('data:');
      expect(receivedData).toMatch(/"object":"chat\.completion\.chunk"/);
    });
  });
});