/**
 * Main Fastify server with dual API endpoints for Claude Code
 */

import fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import * as path from 'path';
import { executeClaudeAndStream } from './claude-executor';
import { loadMcpConfig } from './mcp-manager';
import { performHealthCheck } from './health-checker';
import { createWorkspace } from './session-manager';
import { ClaudeApiRequest, OpenAIRequest, FileUploadRequest } from './types';
import { serverLogger, createRequestLogger, PerformanceLogger } from './logger';
import { authenticateRequest, getAuthStatus } from './auth';
import { OpenAITransformer } from './openai-transformer';
import { StreamProcessor } from './stream-processor';
import { fileManager } from './file-manager';
import { fileProcessor } from './file-processor';
import { errorHandler, InvalidRequestError, createStreamingError, ErrorCode } from './errors';
import {
  claudeApiValidationSchema,
  openAIApiValidationSchema,
  createValidationPreHandler,
} from './middleware/request-validator';

// Configure Fastify with custom logger and validation
const server = fastify({
  logger: serverLogger,
  genReqId: () => require('crypto').randomUUID(),
  requestIdHeader: 'x-request-id',
  bodyLimit: 1048576 * 1000 * 1000 * 1000, // ~1000TB limit for personal use
  ajv: {
    customOptions: {
      removeAdditional: false, // Keep additional properties
      useDefaults: true, // Apply default values
      coerceTypes: false, // Don't coerce types
      allErrors: true, // Collect all validation errors
    },
  },
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
  await server.register(multipart, {
    limits: {
      fieldNameSize: 1000000, // 1M characters
      fieldSize: 1048576 * 1000 * 1000 * 1000, // ~1000TB
      fields: 100000, // 100k fields
      fileSize: 1048576 * 1000 * 1000 * 1000, // ~1000TB
      files: 100000, // 100k files
      headerPairs: 1000000, // 1M header pairs
    },
  });

  // Use centralized error handler
  server.setErrorHandler(errorHandler.handleError);

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

  // OpenAI Files API - Upload file
  server.post(
    '/v1/files',
    {
      preHandler: [authenticateRequest],
    },
    async (request, reply) => {
      const requestLogger = createRequestLogger('files-api', request.id);

      try {
        // Get multipart data
        const data = await request.file();
        if (!data) {
          throw new InvalidRequestError(
            'No file provided',
            { requestId: request.id },
            ErrorCode.INVALID_REQUEST
          );
        }

        // Read file buffer
        const buffer = await data.toBuffer();
        const purposeField = data.fields.purpose;
        let purpose = 'assistants';

        if (purposeField && typeof purposeField === 'string') {
          purpose = purposeField;
        } else if (
          Array.isArray(purposeField) &&
          purposeField.length > 0 &&
          typeof purposeField[0] === 'string'
        ) {
          purpose = purposeField[0];
        }

        const fileUpload: FileUploadRequest = {
          file: buffer,
          filename: data.filename,
          contentType: data.mimetype,
          purpose,
        };

        // Create default workspace if needed
        const workspacePath = await createWorkspace(null);

        // Save file
        const fileRecord = await fileManager.saveFile(workspacePath, fileUpload);
        const openAIFile = fileManager.toOpenAIFile(fileRecord, purpose);

        requestLogger.info(
          {
            type: 'file_uploaded',
            fileId: fileRecord.id,
            filename: fileRecord.filename,
            size: fileRecord.size,
          },
          `File uploaded: ${fileRecord.filename}`
        );

        reply.send(openAIFile);
      } catch (error) {
        requestLogger.error(
          {
            type: 'file_upload_error',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'Failed to upload file'
        );

        if (error instanceof InvalidRequestError) {
          throw error;
        }

        throw new InvalidRequestError(
          'File upload failed',
          { requestId: request.id },
          ErrorCode.INTERNAL_SERVER_ERROR
        );
      }
    }
  );

  // OpenAI Files API - Get file metadata
  server.get<{ Params: { file_id: string } }>(
    '/v1/files/:file_id',
    {
      preHandler: [authenticateRequest],
    },
    async (request, reply) => {
      const { file_id } = request.params;
      const requestLogger = createRequestLogger('files-api', request.id);

      const fileRecord = fileManager.getFile(file_id);
      if (!fileRecord) {
        throw new InvalidRequestError(
          'File not found',
          { requestId: request.id, fileId: file_id },
          ErrorCode.RESOURCE_NOT_FOUND
        );
      }

      const openAIFile = fileManager.toOpenAIFile(fileRecord);

      requestLogger.debug(
        {
          type: 'file_metadata_retrieved',
          fileId: file_id,
        },
        `File metadata retrieved: ${file_id}`
      );

      reply.send(openAIFile);
    }
  );

  // OpenAI Files API - Get file content
  server.get<{ Params: { file_id: string } }>(
    '/v1/files/:file_id/content',
    {
      preHandler: [authenticateRequest],
    },
    async (request, reply) => {
      const { file_id } = request.params;
      const requestLogger = createRequestLogger('files-api', request.id);

      const fileRecord = fileManager.getFile(file_id);
      if (!fileRecord) {
        throw new InvalidRequestError(
          'File not found',
          { requestId: request.id, fileId: file_id },
          ErrorCode.RESOURCE_NOT_FOUND
        );
      }

      const content = await fileManager.getFileContent(file_id);
      if (!content) {
        throw new InvalidRequestError(
          'File content not accessible',
          { requestId: request.id, fileId: file_id },
          ErrorCode.INTERNAL_SERVER_ERROR
        );
      }

      requestLogger.debug(
        {
          type: 'file_content_retrieved',
          fileId: file_id,
          size: content.length,
        },
        `File content retrieved: ${file_id}`
      );

      reply
        .type(fileRecord.contentType)
        .header('Content-Disposition', `inline; filename="${fileRecord.filename}"`)
        .send(content);
    }
  );

  server.post<{ Body: ClaudeApiRequest }>(
    '/api/claude',
    {
      preHandler: [authenticateRequest, createValidationPreHandler()],
      schema: claudeApiValidationSchema,
    },
    async (request, reply) => {
      const { prompt, workspace, files } = request.body;
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
        .type('text/event-stream; charset=utf-8')
        .header('Cache-Control', 'no-cache')
        .header('Connection', 'keep-alive')
        .header('Access-Control-Allow-Origin', '*');

      reply.hijack();

      try {
        // Process files if provided
        let finalPrompt = prompt;
        if (files && files.length > 0) {
          const workspacePath = await createWorkspace(workspace || null);
          const processedFiles: string[] = [];

          for (const filePath of files) {
            // Convert absolute paths to relative paths if needed
            let relativePath = filePath;
            if (path.isAbsolute(filePath)) {
              relativePath = path.relative(workspacePath, filePath);
              if (!relativePath.startsWith('.')) {
                relativePath = `./${relativePath}`;
              }
            }
            processedFiles.push(relativePath);
          }

          // Build prompt with files
          finalPrompt = fileProcessor.buildPromptWithFiles(prompt, processedFiles);

          requestLogger.info(
            {
              type: 'files_processed',
              fileCount: files.length,
              files: processedFiles,
            },
            `Files processed for Claude API: ${processedFiles.length} files`
          );
        }

        await executeClaudeAndStream(
          finalPrompt,
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
          const errorToStream = error instanceof Error ? error : new Error('Unknown error');
          const streamError = createStreamingError(errorToStream, request.id);
          reply.raw.write(streamError);
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
      preHandler: [authenticateRequest, createValidationPreHandler()],
      schema: openAIApiValidationSchema,
    },
    async (request, reply) => {
      const { messages, stream = true } = request.body;

      if (!stream) {
        throw new InvalidRequestError(
          'Only streaming is supported',
          { requestId: request.id, endpoint: '/v1/chat/completions' },
          ErrorCode.INVALID_REQUEST
        );
      }

      // Convert OpenAI request to Claude API parameters
      const { prompt, systemPrompt, sessionInfo, filePaths } =
        await OpenAITransformer.convertRequest(request.body);
      const {
        session_id,
        workspace,
        dangerouslySkipPermissions,
        allowedTools,
        disallowedTools,
        mcpAllowedTools,
      } = sessionInfo;

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
            fileCount: filePaths?.length || 0,
            allowedTools: allowedTools || [],
            disallowedTools: disallowedTools || [],
            mcpAllowedTools: mcpAllowedTools || [],
            files: filePaths || [],
          },
          type: 'api_request',
        },
        'OpenAI API request received'
      );

      reply.hijack();

      try {
        // Manually write headers after hijacking
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
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

      // Create stream processor
      const streamProcessor = new StreamProcessor();
      const originalWrite = reply.raw.write;
      const originalEnd = reply.raw.end;

      // Set the original write method in the processor to avoid infinite loops
      streamProcessor.setOriginalWrite(originalWrite);

      // Override write to process chunks from Claude CLI only
      reply.raw.write = function (chunk: Buffer | string): boolean {
        // Only process chunks that come from Claude CLI (start with "data: ")
        const chunkStr = chunk.toString();
        if (chunkStr.startsWith('data: ')) {
          const continueProcessing = streamProcessor.processChunk(chunk, reply, sessionInfo);
          if (!continueProcessing) {
            return false;
          }
          return true;
        } else {
          // For OpenAI chunks (from StreamProcessor), write directly
          return (originalWrite as Function).call(this, chunk);
        }
      };

      // Override end to clean up when stream ends
      (reply.raw as unknown as { end: (...args: unknown[]) => unknown }).end = function (
        ...args: unknown[]
      ): unknown {
        streamProcessor.cleanup(reply);
        reply.raw.write('data: [DONE]\n\n');
        return (originalEnd as (...args: unknown[]) => unknown).call(reply.raw, ...args);
      };

      try {
        await executeClaudeAndStream(
          prompt,
          session_id || null,
          {
            ...(workspace && { workspace }),
            ...(systemPrompt && { systemPrompt }),
            ...(dangerouslySkipPermissions !== null &&
              dangerouslySkipPermissions !== undefined && { dangerouslySkipPermissions }),
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

        // Try to send error in OpenAI format
        try {
          streamProcessor.cleanup(reply);
          const errorChunk = OpenAITransformer.createChunk(
            `chatcmpl-${Date.now()}`,
            `\n⚠️ Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
            'stop'
          );
          reply.raw.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
        } catch (writeError) {
          requestLogger.error(
            {
              originalError: error instanceof Error ? error.message : 'Unknown error',
              writeError: writeError instanceof Error ? writeError.message : 'Unknown write error',
              type: 'error_write_failure',
            },
            'Failed to write error response'
          );
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
