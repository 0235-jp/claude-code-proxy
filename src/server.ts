/**
 * Main Fastify server with dual API endpoints for Claude Code
 */

import fastify from 'fastify';
import cors from '@fastify/cors';
import { executeClaudeAndStream } from './claude-executor';
import { loadMcpConfig } from './mcp-manager';
import { performHealthCheck } from './health-checker';
import { ClaudeApiRequest, OpenAIRequest, StreamJsonData } from './types';
import { serverLogger, createRequestLogger, PerformanceLogger } from './logger';
import { authenticateRequest, getAuthStatus } from './auth';

// Configure Fastify with custom logger
const server = fastify({
  logger: serverLogger,
  genReqId: () => require('crypto').randomUUID(),
  requestIdHeader: 'x-request-id',
});

/**
 * Initialize and start the Fastify server with API routes
 */
async function startServer(): Promise<void> {
  // Log server startup with authentication status
  const authStatus = getAuthStatus();
  serverLogger.info(
    {
      type: 'server_startup',
      environment: process.env.NODE_ENV || 'development',
      logLevel: process.env.LOG_LEVEL || 'debug',
      authentication: {
        enabled: authStatus.enabled,
        keyCount: authStatus.keyCount,
      },
    },
    'Starting Claude Code Server'
  );

  // Log authentication configuration
  if (authStatus.enabled) {
    serverLogger.info(
      {
        type: 'auth_config',
        keyCount: authStatus.keyCount,
      },
      `Authentication enabled with ${authStatus.keyCount} API key(s)`
    );
  } else {
    serverLogger.warn(
      {
        type: 'auth_config',
        sampleKey: authStatus.sampleKey,
      },
      'Authentication disabled - API accessible without authentication'
    );
  }

  await server.register(cors);

  // Load MCP configuration on startup
  await loadMcpConfig();

  // Health check endpoint
  server.get('/health', async (_request, reply) => {
    try {
      const healthStatus = await performHealthCheck();

      // Set appropriate HTTP status code based on health
      let statusCode = 200;
      if (healthStatus.status === 'degraded') {
        statusCode = 200; // Still operational but with issues
      } else if (healthStatus.status === 'unhealthy') {
        statusCode = 503; // Service unavailable
      }

      reply.code(statusCode).send(healthStatus);
    } catch (error) {
      reply.code(500).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        uptime: process.uptime(),
        version: 'unknown',
        checks: {
          claudeCli: {
            status: 'unhealthy',
            message: 'Health check failed',
            timestamp: new Date().toISOString(),
          },
          workspace: {
            status: 'unhealthy',
            message: 'Health check failed',
            timestamp: new Date().toISOString(),
          },
          mcpConfig: {
            status: 'unhealthy',
            message: 'Health check failed',
            timestamp: new Date().toISOString(),
          },
        },
      });
    }
  });

  server.post<{ Body: ClaudeApiRequest }>(
    '/api/claude',
    {
      preHandler: authenticateRequest,
      schema: {
        body: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
            'session-id': { type: 'string' },
            workspace: { type: 'string' },
            'system-prompt': { type: 'string' },
            'dangerously-skip-permissions': { type: 'boolean' },
            'allowed-tools': { type: 'array', items: { type: 'string' } },
            'disallowed-tools': { type: 'array', items: { type: 'string' } },
            'mcp-allowed-tools': { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { prompt, workspace } = request.body;
      const sessionId = request.body['session-id'];
      const systemPrompt = request.body['system-prompt'];
      const allowedTools = request.body['allowed-tools'];
      const disallowedTools = request.body['disallowed-tools'];
      const mcpAllowedTools = request.body['mcp-allowed-tools'];
      const dangerouslySkipPermissions = request.body['dangerously-skip-permissions'];

      // Create request-scoped logger
      const requestLogger = createRequestLogger('claude-api', request.id);
      const perfLogger = new PerformanceLogger(requestLogger, 'claude-api-request');

      // Log incoming request details with structured logging
      requestLogger.info(
        {
          endpoint: '/api/claude',
          requestData: {
            promptLength: prompt?.length || 0,
            sessionId: sessionId || null,
            workspace: workspace || 'default',
            systemPromptLength: systemPrompt?.length || 0,
            dangerouslySkipPermissions: dangerouslySkipPermissions || false,
            allowedToolsCount: allowedTools?.length || 0,
            disallowedToolsCount: disallowedTools?.length || 0,
            mcpAllowedToolsCount: mcpAllowedTools?.length || 0,
            allowedTools: allowedTools || [],
            disallowedTools: disallowedTools || [],
            mcpAllowedTools: mcpAllowedTools || [],
          },
          type: 'api_request',
        },
        'Claude API request received'
      );

      reply
        .type('text/event-stream')
        .header('Cache-Control', 'no-cache')
        .header('Connection', 'keep-alive')
        .header('Access-Control-Allow-Origin', '*');

      reply.hijack();

      try {
        await executeClaudeAndStream(
          prompt,
          sessionId || null,
          {
            ...(workspace && { workspace }),
            ...(systemPrompt && { systemPrompt }),
            ...(dangerouslySkipPermissions !== undefined && { dangerouslySkipPermissions }),
            ...(allowedTools && { allowedTools }),
            ...(disallowedTools && { disallowedTools }),
            ...(mcpAllowedTools && { mcpAllowedTools }),
          },
          reply
        );
        perfLogger.finish('success');
      } catch (error) {
        requestLogger.error(
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            type: 'api_error',
          },
          'Claude API request failed'
        );
        perfLogger.finish('error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        // Since we hijacked the reply, we need to send a proper error response
        try {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorData = {
            type: 'error',
            error: {
              message: errorMessage,
              type: 'api_error',
            },
          };
          reply.raw.write(`data: ${JSON.stringify(errorData)}\n\n`);
          reply.raw.end();
        } catch (endError) {
          requestLogger.error(
            {
              error: endError instanceof Error ? endError.message : 'Unknown error',
              type: 'error_response_failed',
            },
            'Failed to send error response for Claude API'
          );
          // Force close the connection if we can't send a proper error response
          reply.raw.destroy();
        }
      }
    }
  );

  // OpenAI Chat API compatible endpoint
  server.post<{ Body: OpenAIRequest }>(
    '/v1/chat/completions',
    {
      preHandler: authenticateRequest,
      schema: {
        body: {
          type: 'object',
          required: ['messages'],
          properties: {
            model: { type: 'string' },
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
            stream: { type: 'boolean' },
            temperature: { type: 'number' },
            max_tokens: { type: 'number' },
          },
        },
      },
    },
    async (request, reply) => {
      const { messages, stream = true } = request.body;

      if (!stream) {
        reply.code(400).send({ error: 'Only streaming is supported' });
        return;
      }

      // Extract system prompt if the first message has role "system"
      let systemPrompt: string | null = null;
      let messageStartIndex = 0;
      if (messages.length > 0 && messages[0].role === 'system') {
        systemPrompt = messages[0].content;
        messageStartIndex = 1;
      }

      // Get the latest user message
      const userMessage = messages[messages.length - 1]?.content || '';

      // Extract session_id and workspace from previous assistant messages
      let session_id: string | null = null;
      let workspace: string | null = null;
      let prev_dangerously_skip_permissions: boolean | null = null;
      let prev_allowedTools: string[] | null = null;
      let prev_disallowedTools: string[] | null = null;
      let prev_mcpAllowedTools: string[] | null = null;

      for (let i = messages.length - 2; i >= messageStartIndex; i--) {
        if (messages[i].role === 'assistant') {
          const content = messages[i].content || '';

          const sessionMatch = content.match(/session-id=([a-f0-9-]+)/);
          if (sessionMatch) session_id = sessionMatch[1];

          const workspaceMatch = content.match(/workspace=([^\s\n]+)/);
          if (workspaceMatch) workspace = workspaceMatch[1];

          const dangerMatch = content.match(/dangerously-skip-permissions=(\w+)/);
          if (dangerMatch)
            prev_dangerously_skip_permissions = dangerMatch[1].toLowerCase() === 'true';

          const allowedMatch = content.match(/allowed-tools=\[([^\]]+)\]/);
          if (allowedMatch) {
            prev_allowedTools = allowedMatch[1]
              .split(',')
              .map(tool => tool.trim().replace(/['"]/g, ''));
          }

          const disallowedMatch = content.match(/disallowed-tools=\[([^\]]+)\]/);
          if (disallowedMatch) {
            prev_disallowedTools = disallowedMatch[1]
              .split(',')
              .map(tool => tool.trim().replace(/['"]/g, ''));
          }

          const mcpAllowedMatch = content.match(/mcp-allowed-tools=\[([^\]]+)\]/);
          if (mcpAllowedMatch) {
            prev_mcpAllowedTools = mcpAllowedMatch[1]
              .split(',')
              .map(tool => tool.trim().replace(/['"]/g, ''));
          }
          break;
        }
      }

      // Parse current message settings
      const currentWorkspaceMatch = userMessage.match(/workspace=([^\s\n]+)/);
      if (currentWorkspaceMatch) workspace = currentWorkspaceMatch[1];

      const dangerMatch = userMessage.match(/dangerously-skip-permissions=(\w+)/);
      const dangerouslySkipPermissions = dangerMatch
        ? dangerMatch[1].toLowerCase() === 'true'
        : prev_dangerously_skip_permissions;

      const allowedMatch = userMessage.match(/allowed-tools=\[([^\]]+)\]/);
      const allowedTools = allowedMatch
        ? allowedMatch[1].split(',').map(tool => tool.trim().replace(/['"]/g, ''))
        : prev_allowedTools;

      const disallowedMatch = userMessage.match(/disallowed-tools=\[([^\]]+)\]/);
      const disallowedTools = disallowedMatch
        ? disallowedMatch[1].split(',').map(tool => tool.trim().replace(/['"]/g, ''))
        : prev_disallowedTools;

      const mcpAllowedMatch = userMessage.match(/mcp-allowed-tools=\[([^\]]+)\]/);
      const mcpAllowedTools = mcpAllowedMatch
        ? mcpAllowedMatch[1].split(',').map(tool => tool.trim().replace(/['"]/g, ''))
        : prev_mcpAllowedTools;

      // Extract prompt
      const promptMatch = userMessage.match(/prompt="([^"]+)"/);
      let prompt: string;
      if (promptMatch) {
        prompt = promptMatch[1];
      } else {
        // Remove settings from message
        prompt = userMessage
          .replace(
            /(workspace=[^\s\n]+|dangerously-skip-permissions=\w+|allowed-tools=\[[^\]]+\]|disallowed-tools=\[[^\]]+\]|mcp-allowed-tools=\[[^\]]+\]|prompt="[^"]+"|prompt=)(\s*)/g,
            ''
          )
          .trim();
        if (!prompt) prompt = userMessage;
      }

      // Create request-scoped logger for OpenAI API
      const requestLogger = createRequestLogger('openai-api', request.id);
      const perfLogger = new PerformanceLogger(requestLogger, 'openai-api-request');

      // Log incoming request details with structured logging
      requestLogger.info(
        {
          endpoint: '/v1/chat/completions',
          requestData: {
            promptLength: prompt?.length || 0,
            sessionId: session_id || null,
            workspace: workspace || 'default',
            systemPromptLength: systemPrompt?.length || 0,
            dangerouslySkipPermissions: dangerouslySkipPermissions || false,
            allowedToolsCount: allowedTools?.length || 0,
            disallowedToolsCount: disallowedTools?.length || 0,
            mcpAllowedToolsCount: mcpAllowedTools?.length || 0,
            messagesCount: messages?.length || 0,
            allowedTools: allowedTools || [],
            disallowedTools: disallowedTools || [],
            mcpAllowedTools: mcpAllowedTools || [],
          },
          type: 'api_request',
        },
        'OpenAI API request received'
      );

      reply.hijack();

      try {
        // Manually write headers after hijacking
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
      } catch (headerError) {
        requestLogger.error(
          {
            error: headerError instanceof Error ? headerError.message : 'Unknown error',
            type: 'header_write_error',
          },
          'Failed to write response headers'
        );
        reply.raw.destroy();
        return;
      }

      // Create a custom stream handler for OpenAI format
      const originalWrite = reply.raw.write;
      const originalEnd = reply.raw.end;

      let inThinking = false;
      let sessionPrinted = false;
      const messageId = 'chatcmpl-' + Date.now();
      const systemFingerprint = 'fp_' + Date.now().toString(36);

      // Helper function to split text into chunks
      function splitIntoChunks(text: string, chunkSize = 100): string[] {
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += chunkSize) {
          chunks.push(text.slice(i, i + chunkSize));
        }
        return chunks;
      }

      // Helper function to send a chunk
      function sendChunk(content: string, finishReason: string | null = null): void {
        try {
          const chunk = {
            id: messageId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'claude-code',
            system_fingerprint: systemFingerprint,
            choices: [
              {
                index: 0,
                delta: { content },
                logprobs: null,
                finish_reason: finishReason,
              },
            ],
          };
          (originalWrite as (chunk: Buffer | string) => boolean).call(
            reply.raw,
            `data: ${JSON.stringify(chunk)}\n\n`
          );
        } catch (writeError) {
          requestLogger.error(
            {
              error: writeError instanceof Error ? writeError.message : 'Unknown error',
              type: 'chunk_write_error',
            },
            'Failed to write chunk to stream'
          );
          // Don't throw here as it would break the entire stream
        }
      }

      reply.raw.write = function (chunk: Buffer | string): boolean {
        if (chunk.toString().startsWith('data: ')) {
          try {
            const jsonStr = chunk.toString().replace('data: ', '').trim();
            if (!jsonStr) return true;

            const buffer = jsonStr;
            const jsonData: StreamJsonData = JSON.parse(buffer);

            if (jsonData.type === 'system' && jsonData.subtype === 'init') {
              const sessionId = jsonData.session_id;
              if (sessionId && !sessionPrinted) {
                sessionPrinted = true;

                // Build session info content
                let sessionInfo = `session-id=${sessionId}\n`;
                if (workspace) {
                  sessionInfo += `workspace=${workspace}\n`;
                }
                if (dangerouslySkipPermissions !== null) {
                  sessionInfo += `dangerously-skip-permissions=${dangerouslySkipPermissions}\n`;
                }
                if (allowedTools) {
                  const toolsStr = allowedTools.map(tool => `"${tool}"`).join(',');
                  sessionInfo += `allowed-tools=[${toolsStr}]\n`;
                }
                if (disallowedTools) {
                  const toolsStr = disallowedTools.map(tool => `"${tool}"`).join(',');
                  sessionInfo += `disallowed-tools=[${toolsStr}]\n`;
                }
                if (mcpAllowedTools) {
                  const toolsStr = mcpAllowedTools.map(tool => `"${tool}"`).join(',');
                  sessionInfo += `mcp-allowed-tools=[${toolsStr}]\n`;
                }
                sessionInfo += '<thinking>\n';
                inThinking = true;

                // Send initial chunk with role
                const roleChunk = {
                  id: messageId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: 'claude-code',
                  system_fingerprint: systemFingerprint,
                  choices: [
                    {
                      index: 0,
                      delta: { role: 'assistant' },
                      logprobs: null,
                      finish_reason: null,
                    },
                  ],
                };
                (originalWrite as (chunk: Buffer | string) => boolean).call(
                  reply.raw,
                  `data: ${JSON.stringify(roleChunk)}\n\n`
                );

                // Send session info in chunks (only once)
                const chunks = splitIntoChunks(sessionInfo);
                for (const chunk of chunks) {
                  sendChunk(chunk);
                }
              }
            } else if (jsonData.type === 'assistant') {
              const message = jsonData.message || {};
              const content = message.content || [];
              const stopReason = message.stop_reason;
              const isFinalResponse = stopReason === 'end_turn';

              for (const item of content) {
                if (item.type === 'text') {
                  // Close thinking when text content arrives
                  if (inThinking) {
                    sendChunk('\n</thinking>\n');
                    inThinking = false;
                  }

                  const textContent = item.text || '';
                  const fullText = `\n${textContent}`;
                  const chunks = splitIntoChunks(fullText);
                  for (let i = 0; i < chunks.length; i++) {
                    sendChunk(
                      chunks[i],
                      i === chunks.length - 1 && isFinalResponse ? 'stop' : null
                    );
                  }
                } else if (item.type === 'thinking') {
                  // Reopen thinking if it was closed by text
                  if (!inThinking) {
                    sendChunk('\n<thinking>\n');
                    inThinking = true;
                  }

                  // Thinking content stays within thinking tags
                  const thinkingContent = item.thinking || '';
                  const fullText = `\n🤖< ${thinkingContent}`;
                  const chunks = splitIntoChunks(fullText);
                  for (const chunk of chunks) {
                    sendChunk(chunk);
                  }
                } else if (item.type === 'tool_use') {
                  // Reopen thinking if it was closed by text
                  if (!inThinking) {
                    sendChunk('\n<thinking>\n');
                    inThinking = true;
                  }

                  // Tool use stays within thinking tags
                  const toolName = item.name || 'Unknown';
                  const toolInput = JSON.stringify(item.input || {});
                  const fullText = `\n🔧 Using ${toolName}: ${toolInput}\n`;
                  const chunks = splitIntoChunks(fullText);
                  for (const chunk of chunks) {
                    sendChunk(chunk);
                  }
                }
              }

              // Close thinking if still open at end of final response
              if (isFinalResponse && inThinking) {
                sendChunk('\n</thinking>\n');
                inThinking = false;
              }

              // Send empty delta with finish_reason for final response (if text didn't already send it)
              if (isFinalResponse && content.every(item => item.type !== 'text')) {
                const finalChunk = {
                  id: messageId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: 'claude-code',
                  system_fingerprint: systemFingerprint,
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      logprobs: null,
                      finish_reason: 'stop',
                    },
                  ],
                };
                (originalWrite as (chunk: Buffer | string) => boolean).call(
                  reply.raw,
                  `data: ${JSON.stringify(finalChunk)}\n\n`
                );
              }
            } else if (jsonData.type === 'user') {
              const message = jsonData.message || {};
              const content = message.content || [];

              for (const item of content) {
                if (item.type === 'tool_result') {
                  // Reopen thinking if it was closed by text
                  if (!inThinking) {
                    sendChunk('\n<thinking>\n');
                    inThinking = true;
                  }

                  const toolContent = item.content || '';
                  const isError = item.is_error || false;

                  const prefix = isError ? '\n❌ Tool Error: ' : '\n✅ Tool Result: ';
                  const fullText = prefix + toolContent + '\n';
                  const chunks = splitIntoChunks(fullText);
                  for (const chunk of chunks) {
                    sendChunk(chunk);
                  }
                }
              }
            } else if (jsonData.type === 'result' && jsonData.subtype === 'success') {
              // Close thinking block if still open
              if (inThinking) {
                sendChunk('\n</thinking>\n');
                inThinking = false;
              }

              // Send final chunk with stop reason to properly end the stream
              const finalChunk = {
                id: messageId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'claude-code',
                system_fingerprint: systemFingerprint,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    logprobs: null,
                    finish_reason: 'stop',
                  },
                ],
              };
              (originalWrite as (chunk: Buffer | string) => boolean).call(
                reply.raw,
                `data: ${JSON.stringify(finalChunk)}\n\n`
              );

              // End the stream
              (originalWrite as (chunk: Buffer | string) => boolean).call(
                reply.raw,
                'data: [DONE]\n\n'
              );
              reply.raw.end();
              return true;
            } else if (jsonData.type === 'error') {
              if (inThinking) {
                sendChunk('\n</thinking>\n');
              }

              const errorMessage =
                typeof jsonData.error === 'string'
                  ? jsonData.error
                  : jsonData.error?.message || JSON.stringify(jsonData.error) || 'Unknown error';

              const fullText = `⚠️ ${errorMessage}\n`;
              const chunks = splitIntoChunks(fullText);
              for (let i = 0; i < chunks.length; i++) {
                sendChunk(chunks[i], i === chunks.length - 1 ? 'stop' : null);
              }
            } else {
              // Handle unknown JSON data types
              requestLogger.warn(
                {
                  unknownType: jsonData.type,
                  data: jsonData,
                  type: 'unknown_json_type',
                },
                `Received unknown JSON data type: ${jsonData.type}`
              );

              // Show unknown data in thinking block for debugging
              if (!inThinking) {
                sendChunk('\n<thinking>\n');
                inThinking = true;
              }

              const unknownText = `\n🔍 Unknown data type '${jsonData.type}': ${JSON.stringify(jsonData, null, 2)}\n`;
              const chunks = splitIntoChunks(unknownText);
              for (const chunk of chunks) {
                sendChunk(chunk);
              }
            }
          } catch (e) {
            requestLogger.error(
              {
                error: e instanceof Error ? e.message : 'Unknown error',
                type: 'stream_processing_error',
              },
              'Error processing chunk in OpenAI stream'
            );
            // Close thinking block if it was open before sending error
            if (inThinking) {
              sendChunk('\n</thinking>\n');
              inThinking = false;
            }
            // Send error to client in proper format
            const errorText = `\n⚠️ Stream processing error: ${(e as Error).message}\n`;
            const chunks = splitIntoChunks(errorText);
            for (let i = 0; i < chunks.length; i++) {
              sendChunk(chunks[i], i === chunks.length - 1 ? 'stop' : null);
            }
          }
        }
        return true;
      };

      (reply.raw as unknown as { end: (...args: unknown[]) => unknown }).end = function (
        ...args: unknown[]
      ): unknown {
        // Close thinking block if still open when stream ends
        if (inThinking) {
          sendChunk('\n</thinking>\n');
          inThinking = false;
          // Send a message explaining the unexpected termination
          const terminationText = '\n⚠️ Connection terminated unexpectedly\n';
          const chunks = splitIntoChunks(terminationText);
          for (let i = 0; i < chunks.length; i++) {
            sendChunk(chunks[i], i === chunks.length - 1 ? 'stop' : null);
          }
        } else if (!sessionPrinted) {
          // If no session was printed (no data received at all), send a minimal response
          const roleChunk = {
            id: messageId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'claude-code',
            system_fingerprint: systemFingerprint,
            choices: [
              {
                index: 0,
                delta: { role: 'assistant' },
                logprobs: null,
                finish_reason: null,
              },
            ],
          };
          (originalWrite as (chunk: Buffer | string) => boolean).call(
            reply.raw,
            `data: ${JSON.stringify(roleChunk)}\n\n`
          );
          sendChunk('\n⚠️ No response received from Claude\n', 'stop');
        }
        (originalWrite as (chunk: Buffer | string) => boolean).call(reply.raw, 'data: [DONE]\n\n');
        return (originalEnd as (...args: unknown[]) => unknown).call(reply.raw, ...args);
      };

      try {
        await executeClaudeAndStream(
          prompt,
          session_id,
          {
            ...(workspace && { workspace }),
            ...(systemPrompt && { systemPrompt }),
            ...(dangerouslySkipPermissions !== null && { dangerouslySkipPermissions }),
            ...(allowedTools && { allowedTools }),
            ...(disallowedTools && { disallowedTools }),
            ...(mcpAllowedTools && { mcpAllowedTools }),
          },
          reply
        );
        perfLogger.finish('success');
      } catch (error) {
        requestLogger.error(
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            type: 'api_error',
          },
          'OpenAI API request failed'
        );
        perfLogger.finish('error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        // Since we hijacked the reply, we need to send a proper error response
        try {
          // Close thinking block if it was open
          if (inThinking) {
            sendChunk('\n</thinking>\n');
            inThinking = false;
          }

          // Send error message in OpenAI format
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorText = `\n❌ Error: ${errorMessage}\n`;
          const chunks = splitIntoChunks(errorText);
          for (let i = 0; i < chunks.length; i++) {
            sendChunk(chunks[i], i === chunks.length - 1 ? 'stop' : null);
          }

          // Send final [DONE] to properly close the stream
          (originalWrite as (chunk: Buffer | string) => boolean).call(
            reply.raw,
            'data: [DONE]\n\n'
          );
          reply.raw.end();
        } catch (endError) {
          requestLogger.error(
            {
              error: endError instanceof Error ? endError.message : 'Unknown error',
              type: 'error_response_failed',
            },
            'Failed to send error response'
          );
          // Force close the connection if we can't send a proper error response
          reply.raw.destroy();
        }
      }
    }
  );

  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await server.listen({ port, host });

    serverLogger.info(
      {
        type: 'server_ready',
        serverConfig: {
          port,
          host,
          environment: process.env.NODE_ENV || 'development',
        },
      },
      `Claude Code Server listening on http://${host}:${port}`
    );
  } catch (err) {
    serverLogger.error(
      {
        error: err instanceof Error ? err.message : 'Unknown error',
        type: 'server_startup_error',
      },
      'Failed to start Claude Code Server'
    );
    process.exit(1);
  }
}

// Export for testing, only start if not imported
if (require.main === module) {
  startServer();
}

export { server, startServer };
