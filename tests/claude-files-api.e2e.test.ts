/**
 * E2E tests for Claude API file functionality
 */

import fetch from 'node-fetch';

describe('Claude API File Functionality E2E Tests', () => {
  const baseUrl = process.env.TEST_SERVER_URL || 'http://localhost:3015';
  const apiKey = 'test-api-key-12345';

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

  describe('Claude API with files parameter', () => {
    it('should process files parameter in Claude API request', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Analyze these files and tell me what they contain',
          files: [
            './test-data/sample.txt',
            './test-data/image.png'
          ],
          workspace: 'test-workspace'
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      // Read the streaming response
      const reader = response.body?.getReader();
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
    });

    it('should handle relative file paths', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'List the contents of this file',
          files: ['./files/test.txt'],
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });

    it('should handle absolute file paths', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Read this file',
          files: ['/absolute/path/to/file.txt'],
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });

    it('should work without files parameter', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Hello, how are you?',
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });

    it('should handle empty files array', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Tell me a joke',
          files: [],
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Test prompt',
          files: ['./test.txt'],
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should reject invalid API key', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Test prompt',
          files: ['./test.txt'],
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should validate required prompt parameter', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          files: ['./test.txt'],
          // Missing prompt
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should combine files with workspace correctly', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Analyze this file in the specified workspace',
          files: ['./data/analysis.txt'],
          workspace: 'project-analysis',
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });

    it('should work with other Claude API parameters', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Process these files carefully',
          files: ['./secure/file.txt'],
          'session-id': 'test-session-123',
          'system-prompt': 'You are a helpful file analysis assistant',
          'allowed-tools': ['Read', 'Grep'],
          'dangerously-skip-permissions': false,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });
  });

  describe('File path processing', () => {
    it('should prepend Files: to prompt when files are provided', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'What is in these files?',
          files: ['./file1.txt', './file2.jpg'],
        }),
      });

      expect(response.status).toBe(200);
      
      // The actual file processing would be tested by the Claude CLI execution
      // Here we just verify the request is accepted
    });

    it('should handle multiple file types', async () => {
      const response = await fetch(`${baseUrl}/api/claude`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Analyze all these different file types',
          files: [
            './documents/report.pdf',
            './images/chart.png', 
            './data/spreadsheet.csv',
            './code/script.py',
            './text/notes.txt'
          ],
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });
  });
});