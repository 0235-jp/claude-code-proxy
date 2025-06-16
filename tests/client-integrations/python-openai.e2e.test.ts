/**
 * E2E tests simulating Python OpenAI client library usage
 */

import { spawn, ChildProcess } from 'child_process';
import supertest from 'supertest';
import { promises as fs } from 'fs';
import * as path from 'path';

describe('Python OpenAI Client Integration E2E Tests', () => {
  let serverProcess: ChildProcess;
  let serverReady = false;
  const serverPort = 3003 + Math.floor(Math.random() * 100);
  const serverUrl = `http://localhost:${serverPort}`;
  
  beforeAll(async () => {
    // Mock Claude CLI
    const mockClaudeScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: 'python-test-' + Date.now()
}));

setTimeout(() => {
  console.log(JSON.stringify({
    type: 'assistant',
    message: {
      content: [{
        type: 'text',
        text: 'Hello from Claude Code Server!'
      }],
      stop_reason: 'end_turn'
    }
  }));
}, 100);
`;

    const mockClaudePath = path.join(__dirname, '..', 'mock-claude-python');
    await fs.writeFile(mockClaudePath, mockClaudeScript);
    await fs.chmod(mockClaudePath, '755');

    // Add mock claude to PATH - rename to 'claude' for CI compatibility
    const standardClaudePath = path.join(path.dirname(mockClaudePath), 'claude');
    await fs.copyFile(mockClaudePath, standardClaudePath);
    await fs.chmod(standardClaudePath, '755');
    process.env.PATH = `${path.dirname(standardClaudePath)}:${process.env.PATH}`;
    
    // Start server
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server failed to start within timeout'));
      }, 15000);

      serverProcess = spawn('node', ['-r', 'ts-node/register', 'src/server.ts'], {
        cwd: path.join(__dirname, '..', '..'),
        env: {
          ...process.env,
          PORT: serverPort.toString(),
          NODE_ENV: 'test',
          API_KEY: 'sk-python123456789012345678901234567890123456',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      serverProcess.stdout?.on('data', (data) => {
        output += data.toString();
        console.log('Server stdout:', data.toString());
        if (output.includes(`listening`) || output.includes(`Server`) || output.includes(`port`)) {
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
        console.error('Server process error:', error);
        reject(error);
      });

      // Wait for server to be ready, then test connectivity
      setTimeout(async () => {
        if (!serverReady) {
          console.log('Server not ready after 3 seconds, testing connectivity...');
          try {
            const testResponse = await fetch(`http://localhost:${serverPort}/health`);
            if (testResponse.ok) {
              console.log('Server is responding to health check');
              serverReady = true;
              clearTimeout(timeout);
              resolve();
            } else {
              console.log('Server health check failed:', testResponse.status);
            }
          } catch (error) {
            console.log('Server connectivity test failed:', error);
          }
          
          if (!serverReady) {
            serverReady = true;
            clearTimeout(timeout);
            resolve();
          }
        }
      }, 3000);
    });
  }, 20000);

  afterAll(async () => {
    const mockClaudePath = path.join(__dirname, '..', 'mock-claude-python');
    const standardClaudePath = path.join(path.dirname(mockClaudePath), 'claude');
    try {
      await fs.unlink(mockClaudePath);
    } catch (error) {
      // Ignore
    }
    try {
      await fs.unlink(standardClaudePath);
    } catch (error) {
      // Ignore
    }

    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
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

  describe('Python OpenAI SDK Compatibility', () => {
    it('should handle Python OpenAI client.chat.completions.create() equivalent', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate Python: client.chat.completions.create(model="claude-code", messages=[...], stream=True)
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-python123456789012345678901234567890123456')
        .set('User-Agent', 'OpenAI/Python 1.3.8')
        .set('Accept', 'text/event-stream')
        .set('Cache-Control', 'no-cache')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Write a Python function to calculate factorial'
            }
          ],
          stream: true,
          max_tokens: 1000,
          temperature: 0.7
        })
        .expect(200);

      expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      
      // Verify streaming chunks format
      const chunks = response.text.split('\n')
        .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
        .map(line => {
          const data = line.substring(6).trim();
          return data ? JSON.parse(data) : null;
        })
        .filter(chunk => chunk !== null);

      expect(chunks.length).toBeGreaterThan(0);
      
      chunks.forEach(chunk => {
        expect(chunk).toMatchObject({
          id: expect.any(String),
          object: 'chat.completion.chunk',
          created: expect.any(Number),
          model: 'claude-code',
          choices: expect.arrayContaining([
            expect.objectContaining({
              index: 0,
              delta: expect.any(Object)
            })
          ])
        });
      });
    }, 15000);

    it('should support Python async streaming pattern', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate Python async for chunk in stream pattern
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-python123456789012345678901234567890123456')
        .set('User-Agent', 'OpenAI/Python 1.3.8')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful Python programming assistant.'
            },
            {
              role: 'user',
              content: 'Create a simple web scraper using requests and BeautifulSoup'
            }
          ],
          stream: true,
          temperature: 0.5,
          max_tokens: 1500
        })
        .expect(200);

      // Parse streaming response
      const lines = response.text.split('\n');
      const chunks = lines
        .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
        .map(line => {
          const data = line.substring(6).trim();
          return data ? JSON.parse(data) : null;
        })
        .filter(chunk => chunk !== null);

      // Reconstruct content like Python would
      let fullContent = '';
      chunks.forEach(chunk => {
        if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
          fullContent += chunk.choices[0].delta.content;
        }
      });

      expect(fullContent.length).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);
    }, 15000);

    it('should handle Python error scenarios gracefully', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate Python client error handling
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-python123456789012345678901234567890123456')
        .set('User-Agent', 'OpenAI/Python 1.3.8')
        .send({
          model: 'claude-code',
          messages: [], // Invalid: empty messages
          stream: true
        })
        .expect(400);

      // Should return OpenAI-compatible error format for Python client
      expect(response.body).toMatchObject({
        error: {
          message: expect.any(String),
          type: expect.any(String),
          code: expect.any(String)
        }
      });
    }, 10000);

    it('should support Python client headers and metadata', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-python123456789012345678901234567890123456')
        .set('User-Agent', 'OpenAI/Python 1.3.8')
        .set('X-Stainless-Lang', 'python')
        .set('X-Stainless-Package-Version', '1.3.8')
        .set('X-Stainless-Runtime', 'CPython')
        .set('X-Stainless-Runtime-Version', '3.11.0')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Help me optimize this Python code for performance'
            }
          ],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 10000);
  });

  describe('Python-specific Use Cases', () => {
    it('should handle data science and ML queries', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-python123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Create a pandas DataFrame analysis script with matplotlib visualization'
            }
          ],
          stream: true,
          temperature: 0.3
        })
        .expect(200);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    }, 15000);

    it('should handle Django/Flask web development queries', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-python123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'workspace=django-project'
            },
            {
              role: 'user',
              content: 'Create a Django REST API endpoint with authentication'
            }
          ],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 15000);

    it('should handle Python testing and debugging scenarios', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-python123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'system',
              content: 'You are a Python testing expert using pytest and unittest.'
            },
            {
              role: 'user',
              content: 'Write comprehensive unit tests for a calculator class with edge cases'
            }
          ],
          stream: true,
          max_tokens: 2000
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 15000);
  });

  describe('Python Client Library Features', () => {
    it('should support function calling (tools) equivalent', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Python OpenAI client supports function calling via tools parameter
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-python123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Use tools to read and analyze a Python file'
            }
          ],
          stream: true,
          tools: [
            {
              type: 'function',
              function: {
                name: 'read_file',
                description: 'Read a file from the filesystem',
                parameters: {
                  type: 'object',
                  properties: {
                    file_path: {
                      type: 'string',
                      description: 'Path to the file to read'
                    }
                  },
                  required: ['file_path']
                }
              }
            }
          ]
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 15000);

    it('should handle Python client retry mechanisms', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate retry with backoff (Python client feature)
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-python123456789012345678901234567890123456')
        .set('X-Stainless-Retry-Count', '2')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Test retry mechanism'
            }
          ],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 10000);

    it('should support Python client timeout handling', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Python client sets request timeout
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-python123456789012345678901234567890123456')
        .timeout(30000) // 30 second timeout like Python client
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Process this complex request that might take time'
            }
          ],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 35000);
  });
});