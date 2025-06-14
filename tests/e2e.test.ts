/**
 * End-to-end tests for the Claude Code Server
 */

import { spawn, ChildProcess } from 'child_process';
import supertest from 'supertest';
import { promises as fs } from 'fs';
import * as path from 'path';

describe('E2E Tests', () => {
  let serverProcess: ChildProcess;
  let serverReady = false;
  const serverPort = 3001; // Use different port to avoid conflicts
  
  beforeAll(async () => {
    // Mock Claude CLI by creating a mock script
    const mockClaudeScript = `#!/usr/bin/env node
const args = process.argv.slice(2);
console.log(JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: 'mock-session-' + Date.now()
}));

// Mock a simple text response
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'assistant',
    message: {
      content: [{
        type: 'text',
        text: 'This is a mock response from Claude CLI'
      }],
      stop_reason: 'end_turn'
    }
  }));
}, 100);
`;

    // Create mock claude executable
    const mockClaudePath = path.join(__dirname, 'mock-claude');
    await fs.writeFile(mockClaudePath, mockClaudeScript);
    await fs.chmod(mockClaudePath, '755');

    // Add mock claude to PATH for this test
    process.env.PATH = `${path.dirname(mockClaudePath)}:${process.env.PATH}`;
    
    // Start the server
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server failed to start within timeout'));
      }, 10000);

      serverProcess = spawn('node', ['-r', 'ts-node/register', 'src/server.ts'], {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          PORT: serverPort.toString(),
          NODE_ENV: 'test',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      serverProcess.stdout?.on('data', (data) => {
        output += data.toString();
        // Look for indication that server is ready
        if (output.includes(`listening on`) || output.includes(`Server listening`)) {
          clearTimeout(timeout);
          serverReady = true;
          resolve();
        }
      });

      serverProcess.stderr?.on('data', (data) => {
        console.error('Server stderr:', data.toString());
      });

      serverProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      serverProcess.on('exit', (code) => {
        if (code !== 0 && !serverReady) {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      // Give server time to start
      setTimeout(() => {
        if (!serverReady) {
          // Assume server is ready if it hasn't crashed
          serverReady = true;
          clearTimeout(timeout);
          resolve();
        }
      }, 3000);
    });
  }, 15000);

  afterAll(async () => {
    // Clean up mock claude
    const mockClaudePath = path.join(__dirname, 'mock-claude');
    try {
      await fs.unlink(mockClaudePath);
    } catch (error) {
      // Ignore if file doesn't exist
    }

    // Kill server process
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (!serverProcess.killed) {
            serverProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        serverProcess.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }, 10000);

  describe('Claude API Endpoint (/api/claude)', () => {
    it('should handle basic request and return streaming response', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(`http://localhost:${serverPort}`)
        .post('/api/claude')
        .send({ prompt: 'Hello world' })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
      expect(response.text).toContain('data:');
    }, 10000);

    it('should handle request with workspace parameter', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(`http://localhost:${serverPort}`)
        .post('/api/claude')
        .send({ 
          prompt: 'List files in workspace',
          workspace: 'test-workspace'
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
    }, 10000);

    it('should handle request with system prompt', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(`http://localhost:${serverPort}`)
        .post('/api/claude')
        .send({ 
          prompt: 'Help me code',
          'system-prompt': 'You are a helpful coding assistant'
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
    }, 10000);
  });

  describe('OpenAI Compatible Endpoint (/v1/chat/completions)', () => {
    it('should handle OpenAI format request', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(`http://localhost:${serverPort}`)
        .post('/v1/chat/completions')
        .send({
          model: 'claude-code',
          messages: [
            { role: 'user', content: 'Hello from OpenAI format' }
          ],
          stream: true
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
      expect(response.text).toContain('data:');
    }, 10000);

    it('should handle system message in OpenAI format', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(`http://localhost:${serverPort}`)
        .post('/v1/chat/completions')
        .send({
          messages: [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'Help me with coding' }
          ],
          stream: true
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
    }, 10000);

    it('should reject non-streaming requests', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      await supertest(`http://localhost:${serverPort}`)
        .post('/v1/chat/completions')
        .send({
          messages: [
            { role: 'user', content: 'Hello' }
          ],
          stream: false
        })
        .expect(400);
    }, 10000);
  });

  describe('Error Handling', () => {
    it('should return 400 for invalid requests to /api/claude', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      await supertest(`http://localhost:${serverPort}`)
        .post('/api/claude')
        .send({}) // Missing required prompt
        .expect(400);
    }, 10000);

    it('should return 400 for invalid requests to /v1/chat/completions', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      await supertest(`http://localhost:${serverPort}`)
        .post('/v1/chat/completions')
        .send({}) // Missing required messages
        .expect(400);
    }, 10000);

    it('should return 404 for non-existent endpoints', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      await supertest(`http://localhost:${serverPort}`)
        .get('/non-existent')
        .expect(404);
    }, 10000);
  });

  describe('CORS Support', () => {
    it('should handle CORS preflight requests', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      await supertest(`http://localhost:${serverPort}`)
        .options('/api/claude')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
    }, 10000);

    it('should include CORS headers in API responses', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(`http://localhost:${serverPort}`)
        .post('/api/claude')
        .set('Origin', 'http://localhost:3000')
        .send({ prompt: 'Test CORS' });

      expect(response.headers['access-control-allow-origin']).toBe('*');
    }, 10000);
  });

  describe('Health Check', () => {
    it('should respond to basic GET request on root', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // The server might not have a root endpoint, so we expect 404
      // This test mainly verifies the server is running and responsive
      const response = await supertest(`http://localhost:${serverPort}`)
        .get('/')
        .timeout(5000);

      // Should get some response (404 is fine, it means server is running)
      expect([200, 404]).toContain(response.status);
    }, 10000);
  });
});