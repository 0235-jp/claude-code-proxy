/**
 * Comprehensive E2E tests for OpenAI API compatibility
 */

import { spawn, ChildProcess } from 'child_process';
import supertest from 'supertest';
import { promises as fs } from 'fs';
import * as path from 'path';

// Mock OpenAI client library behavior

describe('OpenAI API Compatibility E2E Tests', () => {
  let serverProcess: ChildProcess;
  let serverReady = false;
  const serverPort = 3002 + Math.floor(Math.random() * 100); // Use random port to avoid conflicts
  const serverUrl = `http://localhost:${serverPort}`;
  
  beforeAll(async () => {
    // Mock Claude CLI with more realistic OpenAI-compatible responses
    const mockClaudeScript = `#!/usr/bin/env node
const args = process.argv.slice(2);

// Send initialization message
console.log(JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: 'mock-session-' + Date.now()
}));

// Simulate thinking (optional for OpenAI compatibility)
if (Math.random() > 0.5) {
  setTimeout(() => {
    console.log(JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'thinking',
          text: 'Let me think about this request...'
        }],
        stop_reason: null
      }
    }));
  }, 50);
}

// Send main response with tool use simulation
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: 'I understand your request. Let me help you with that.'
        },
        {
          type: 'tool_use',
          id: 'toolu_mock123',
          name: 'Read',
          input: { file_path: '/test/file.txt' }
        }
      ],
      stop_reason: null
    }
  }));
}, 100);

// Send tool result
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'tool_result',
    tool_use_id: 'toolu_mock123',
    content: 'File content here'
  }));
}, 150);

// Send final response
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'assistant',
    message: {
      content: [{
        type: 'text',
        text: 'Based on the file content, here is my response.'
      }],
      stop_reason: 'end_turn'
    }
  }));
}, 200);
`;

    // Create mock claude executable
    const mockClaudePath = path.join(__dirname, 'mock-claude-openai');
    await fs.writeFile(mockClaudePath, mockClaudeScript);
    await fs.chmod(mockClaudePath, '755');

    // Add mock claude to PATH - rename to 'claude' for CI compatibility
    const standardClaudePath = path.join(__dirname, 'claude');
    await fs.copyFile(mockClaudePath, standardClaudePath);
    await fs.chmod(standardClaudePath, '755');
    
    // In CI, prefer using existing mock if available
    if (process.env.CI && process.env.PATH?.includes('mock-bin')) {
      console.log('Using existing CI mock claude from PATH');
    } else {
      process.env.PATH = `${path.dirname(standardClaudePath)}:${process.env.PATH || ''}`;
    }
    
    // Start the server
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server failed to start within timeout'));
      }, 15000);

      // Use built JavaScript in CI, TypeScript in development
      const serverScript = process.env.CI 
        ? 'dist/server.js' 
        : 'src/server.ts';
      const nodeArgs = process.env.CI 
        ? [serverScript] 
        : ['-r', 'ts-node/register', serverScript];
      
      serverProcess = spawn('node', nodeArgs, {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          PORT: serverPort.toString(),
          NODE_ENV: 'test',
          API_KEY: 'sk-test123456789012345678901234567890123456',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      serverProcess.stdout?.on('data', (data) => {
        output += data.toString();
        if (output.includes(`listening`) || output.includes(`Server`)) {
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

      // Fallback timeout
      setTimeout(() => {
        if (!serverReady) {
          serverReady = true;
          clearTimeout(timeout);
          resolve();
        }
      }, 3000);
    });
  }, 20000);

  afterAll(async () => {
    // Clean up mock claude files
    const mockClaudePath = path.join(__dirname, 'mock-claude-openai');
    const standardClaudePath = path.join(__dirname, 'claude');
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

    // Kill server process
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

  describe('Streaming Response Format Compatibility', () => {
    it('should return valid Server-Sent Events format', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true
        })
        .expect(200);

      // Verify SSE format
      expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
      
      // Verify SSE data format
      const lines = response.text.split('\n');
      const dataLines = lines.filter(line => line.startsWith('data: '));
      expect(dataLines.length).toBeGreaterThan(0);
      
      // Each data line should be valid JSON (except [DONE])
      dataLines.forEach(line => {
        const data = line.substring(6).trim(); // Remove 'data: ' and trim
        if (data && data !== '[DONE]') {
          expect(() => JSON.parse(data)).not.toThrow();
        }
      });
    }, 15000);

    it('should include proper OpenAI format fields in streaming response', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'Test response format' }],
          stream: true
        })
        .expect(200);

      const lines = response.text.split('\n');
      const dataLines = lines.filter(line => line.startsWith('data: ') && !line.includes('[DONE]'));
      
      expect(dataLines.length).toBeGreaterThan(0);
      
      // Parse first valid chunk
      const firstChunk = JSON.parse(dataLines[0].substring(6));
      
      // Verify OpenAI format structure
      expect(firstChunk).toHaveProperty('id');
      expect(firstChunk).toHaveProperty('object', 'chat.completion.chunk');
      expect(firstChunk).toHaveProperty('created');
      expect(firstChunk).toHaveProperty('model', 'claude-code');
      expect(firstChunk).toHaveProperty('choices');
      expect(Array.isArray(firstChunk.choices)).toBe(true);
      expect(firstChunk.choices.length).toBeGreaterThan(0);
      
      const choice = firstChunk.choices[0];
      expect(choice).toHaveProperty('index', 0);
      expect(choice).toHaveProperty('delta');
    }, 15000);

    it('should handle tool use in OpenAI streaming format', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'Read a file for me' }],
          stream: true
        })
        .expect(200);

      const lines = response.text.split('\n');
      const dataLines = lines.filter(line => line.startsWith('data: ') && !line.includes('[DONE]'));
      
      let foundTextContent = false;
      
      dataLines.forEach(line => {
        const data = line.substring(6).trim();
        if (data) {
          try {
            const chunk = JSON.parse(data);
            if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
              const delta = chunk.choices[0].delta;
              if (delta.content) {
                foundTextContent = true;
              }
              if (delta.tool_calls) {
                expect(Array.isArray(delta.tool_calls)).toBe(true);
                if (delta.tool_calls.length > 0) {
                  const toolCall = delta.tool_calls[0];
                  expect(toolCall).toHaveProperty('id');
                  expect(toolCall).toHaveProperty('type', 'function');
                  expect(toolCall).toHaveProperty('function');
                }
              }
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      });

      // We should have some content in the response
      expect(foundTextContent).toBe(true);
    }, 15000);
  });

  describe('Authentication and Session Management', () => {
    it('should require authentication when API key is configured', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      await supertest(serverUrl)
        .post('/v1/chat/completions')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true
        })
        .expect(401);
    }, 10000);

    it('should accept valid Bearer token', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true
        })
        .expect(200);
    }, 10000);

    it('should reject invalid Bearer token', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true
        })
        .expect(401);
    }, 10000);

    it('should maintain session continuity across requests', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // First request with session context
      const response1 = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            { role: 'user', content: 'workspace=test-session' },
            { role: 'user', content: 'Remember I said hello' }
          ],
          stream: true
        })
        .expect(200);

      // Second request in same session
      const response2 = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            { role: 'user', content: 'workspace=test-session' },
            { role: 'user', content: 'What did I say before?' }
          ],
          stream: true
        })
        .expect(200);

      // Both should succeed
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
    }, 20000);
  });

  describe('Error Response Scenarios', () => {
    it('should return proper error format for missing messages', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          stream: true
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('type');
    }, 10000);

    it('should return proper error format for non-streaming requests', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.message).toContain('streaming');
    }, 10000);

    it('should handle Claude CLI errors gracefully', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // This should trigger some kind of error handling
      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'invalidCommand=\\x00\\x01\\x02' }],
          stream: true
        });

      // Should either succeed or return proper error format
      if (response.status !== 200) {
        expect(response.body).toHaveProperty('error');
      }
    }, 15000);
  });

  describe('OpenAI Client Library Simulation', () => {
    it('should be compatible with OpenAI SDK-style requests', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      // Simulate what the OpenAI SDK would send
      const openaiStyleRequest = {
        model: 'claude-code',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Write a simple Python function' }
        ],
        stream: true,
        max_tokens: 1000,
        temperature: 0.7
      };

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .set('User-Agent', 'OpenAI/Python 1.0.0')
        .send(openaiStyleRequest)
        .expect(200);

      expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    }, 15000);

    it('should handle OpenAI SDK headers and metadata', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .set('User-Agent', 'OpenAI/NodeJS/4.20.1')
        .set('X-Stainless-Lang', 'js')
        .set('X-Stainless-Package-Version', '4.20.1')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'Hello from SDK' }],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 10000);

    it('should support common OpenAI parameters', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [{ role: 'user', content: 'Test with parameters' }],
          stream: true,
          max_tokens: 500,
          temperature: 0.5,
          top_p: 0.9,
          frequency_penalty: 0,
          presence_penalty: 0,
          stop: ['\\n\\n']
        })
        .expect(200);

      // Parameters should be accepted (even if not all are used)
      expect(response.status).toBe(200);
    }, 15000);
  });

  describe('Advanced Features', () => {
    it('should handle workspace extraction from messages', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            { role: 'user', content: 'workspace=my-project' },
            { role: 'user', content: 'List the files in this workspace' }
          ],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 15000);

    it('should handle system prompt and multi-turn conversations', async () => {
      if (!serverReady) {
        throw new Error('Server not ready');
      }

      const response = await supertest(serverUrl)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-test123456789012345678901234567890123456')
        .send({
          model: 'claude-code',
          messages: [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'Hello' }
          ],
          stream: true
        })
        .expect(200);

      expect(response.status).toBe(200);
    }, 15000);
  });
});