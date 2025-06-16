/**
 * E2E tests simulating Node.js OpenAI client library usage
 */

import { spawn, ChildProcess } from 'child_process';
import supertest from 'supertest';
import { promises as fs } from 'fs';
import * as path from 'path';

describe('Node.js OpenAI Client Integration E2E Tests', () => {
  let serverProcess: ChildProcess;
  let serverReady = false;
  const serverPort = 3004;
  const serverUrl = `http://localhost:${serverPort}`;
  
  beforeAll(async () => {
    // Mock Claude CLI
    const mockClaudeScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: 'nodejs-test-' + Date.now()
}));

setTimeout(() => {
  console.log(JSON.stringify({
    type: 'assistant',
    message: {
      content: [{
        type: 'text',
        text: 'Hello from Claude Code Server via Node.js!'
      }],
      stop_reason: 'end_turn'
    }
  }));
}, 100);
`;

    const mockClaudePath = path.join(__dirname, '..', 'mock-claude-nodejs');
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
          API_KEY: 'sk-nodejs123456789012345678901234567890123456',
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
    const mockClaudePath = path.join(__dirname, '..', 'mock-claude-nodejs');
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

  describe('Node.js OpenAI SDK Compatibility', () => {
    it('should handle Node.js client.chat.completions.create() equivalent', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate Node.js: await client.chat.completions.create({...})
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .set('User-Agent', 'OpenAI/NodeJS/4.20.1')
        .set('Accept', 'text/event-stream')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Create a Node.js Express server with middleware'
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

    it('should support Node.js streaming with for await...of pattern', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate Node.js: for await (const chunk of stream) pattern
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .set('User-Agent', 'OpenAI/NodeJS/4.20.1')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'system',
              content: 'You are a Node.js and JavaScript expert.'
            },
            {
              role: 'user',
              content: 'Write a TypeScript REST API with proper error handling'
            }
          ],
          stream: true,
          temperature: 0.5,
          max_tokens: 1500
        })
        .expect(200);

      // Parse streaming response like Node.js would
      const lines = response.text.split('\n');
      const chunks = lines
        .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
        .map(line => {
          const data = line.substring(6).trim();
          return data ? JSON.parse(data) : null;
        })
        .filter(chunk => chunk !== null);

      // Reconstruct content like Node.js for await would
      let fullContent = '';
      let toolCalls: any[] = [];
      
      chunks.forEach(chunk => {
        if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
          const delta = chunk.choices[0].delta;
          if (delta.content) {
            fullContent += delta.content;
          }
          if (delta.tool_calls) {
            toolCalls.push(...delta.tool_calls);
          }
        }
      });

      expect(fullContent.length).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);
    }, 15000);

    it('should handle Node.js error scenarios with proper error objects', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate Node.js client error handling
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .set('User-Agent', 'OpenAI/NodeJS/4.20.1')
        .send({
          model: 'claude-code',
          // Missing messages - should trigger validation error
          stream: true
        })
        .expect(400);

      // Should return OpenAI-compatible error format for Node.js client
      expect(response.body).toMatchObject({
        error: {
          message: expect.any(String),
          type: expect.any(String),
          code: expect.any(String)
        }
      });
    }, 10000);

    it('should support Node.js client headers and package info', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .set('User-Agent', 'OpenAI/NodeJS/4.20.1')
        .set('X-Stainless-Lang', 'js')
        .set('X-Stainless-Package-Version', '4.20.1')
        .set('X-Stainless-Runtime', 'node')
        .set('X-Stainless-Runtime-Version', '18.17.0')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Help me debug this Node.js application'
            }
          ],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 10000);
  });

  describe('Node.js-specific Use Cases', () => {
    it('should handle Express.js and web framework queries', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Create an Express.js middleware for rate limiting with Redis'
            }
          ],
          stream: true,
          temperature: 0.3
        })
        .expect(200);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    }, 15000);

    it('should handle Node.js package management and build tools', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'workspace=my-nodejs-project'
            },
            {
              role: 'user',
              content: 'Set up webpack configuration with TypeScript and hot reload'
            }
          ],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 15000);

    it('should handle React/Next.js development queries', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'system',
              content: 'You are a React and Next.js expert developer.'
            },
            {
              role: 'user',
              content: 'Create a Next.js API route with TypeScript and data validation'
            }
          ],
          stream: true,
          max_tokens: 2000
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 15000);

    it('should handle Node.js testing with Jest/Mocha scenarios', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Write comprehensive Jest tests for an async Node.js service class'
            }
          ],
          stream: true,
          temperature: 0.4
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 15000);
  });

  describe('Node.js Client Library Features', () => {
    it('should support async/await streaming pattern', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Node.js async/await with streaming
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Create an async function that processes streaming data'
            }
          ],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
      
      // Verify we can parse the streaming chunks
      const chunks = response.text.split('\n')
        .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'));
      
      expect(chunks.length).toBeGreaterThan(0);
      
      // Each chunk should be valid JSON
      chunks.forEach(line => {
        const data = line.substring(6).trim();
        if (data) {
          expect(() => JSON.parse(data)).not.toThrow();
        }
      });
    }, 15000);

    it('should handle Node.js client configuration options', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate Node.js client with various configuration options
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .set('X-Stainless-Base-URL', serverUrl)
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Test config'
            }
          ],
          stream: true,
          max_tokens: 100
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 20000);

    it('should support Node.js client request patterns', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate Node.js client with headers
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .set('X-Stainless-Request-ID', 'req_nodejs_' + Date.now())
        .send({
          model: 'claude-code',
          messages: [
            {
              role: 'user',
              content: 'Test'
            }
          ],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 20000);
  });

  describe('Node.js TypeScript Integration', () => {
    it('should work with TypeScript and ES modules', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate TypeScript-style usage with proper typing
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-nodejs123456789012345678901234567890123456')
        .set('Content-Type', 'application/json')
        .send({
          model: 'claude-code' as const,
          messages: [
            {
              role: 'user' as const,
              content: 'Create a TypeScript utility type for Node.js'
            }
          ],
          stream: true as const
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 15000);
  });
});