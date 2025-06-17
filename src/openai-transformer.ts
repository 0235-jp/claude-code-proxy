/**
 * OpenAI to Claude API transformation utilities
 */

import { OpenAIMessage, OpenAIRequest, SessionInfo } from './types';
import { fileProcessor } from './file-processor';
import { createWorkspace } from './session-manager';
import { serverLogger } from './logger';
import { fileStorage } from './file-storage';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Handles transformation between OpenAI and Claude API formats
 */
export class OpenAITransformer {
  /**
   * Extract session information from OpenAI messages
   */
  static extractSessionInfo(messages: OpenAIMessage[]): SessionInfo | null {
    const result: Partial<SessionInfo> = {};
    let foundSession = false;

    // Start from the end and work backwards to find the most recent assistant message
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const messageContent = messages[i].content;
        if (typeof messageContent !== 'string') {
          continue; // Skip non-string content
        }
        const content = messageContent;

        const sessionMatch = content.match(/(?:^|\s)session-id=([a-f0-9-]+)/m);
        if (sessionMatch) {
          result.session_id = sessionMatch[1];
          foundSession = true;
        }

        const workspaceMatch = content.match(/(?:^|\s)workspace=([^\s\n]+)/m);
        if (workspaceMatch) {
          result.workspace = workspaceMatch[1];
        }

        const dangerMatch = content.match(/(?:^|\s)dangerously-skip-permissions=(\w+)/m);
        if (dangerMatch) {
          result.dangerouslySkipPermissions = dangerMatch[1].toLowerCase() === 'true';
        }

        const allowedMatch = content.match(/(?:^|\s)allowed-tools=\[([^\]]*)\]/m);
        if (allowedMatch) {
          const matchContent = allowedMatch[1].trim();
          if (matchContent) {
            result.allowedTools = matchContent
              .split(',')
              .map(tool => tool.trim().replace(/['"]/g, ''))
              .filter(tool => tool.length > 0);
          } else {
            result.allowedTools = [];
          }
        }

        const disallowedMatch = content.match(/(?:^|\s)disallowed-tools=\[([^\]]*)\]/m);
        if (disallowedMatch) {
          const matchContent = disallowedMatch[1].trim();
          if (matchContent) {
            result.disallowedTools = matchContent
              .split(',')
              .map(tool => tool.trim().replace(/['"]/g, ''))
              .filter(tool => tool.length > 0);
          } else {
            result.disallowedTools = [];
          }
        }

        const mcpAllowedMatch = content.match(/(?:^|\s)mcp-allowed-tools=\[([^\]]*)\]/m);
        if (mcpAllowedMatch) {
          const matchContent = mcpAllowedMatch[1].trim();
          if (matchContent) {
            result.mcpAllowedTools = matchContent
              .split(',')
              .map(tool => tool.trim().replace(/['"]/g, ''))
              .filter(tool => tool.length > 0);
          } else {
            result.mcpAllowedTools = [];
          }
        }

        // Stop at the first assistant message with session info
        if (foundSession) break;
      }
    }

    return foundSession ? (result as SessionInfo) : null;
  }

  /**
   * Extract configuration from user message
   */
  static extractMessageConfig(userMessage: string): {
    config: Partial<SessionInfo>;
    cleanedPrompt: string;
  } {
    const config: Partial<SessionInfo> = {};

    const workspaceMatch = userMessage.match(/(?:^|\s)workspace=([^\s\n]+)/m);
    if (workspaceMatch) {
      config.workspace = workspaceMatch[1];
    }

    const dangerMatch = userMessage.match(/(?:^|\s)dangerously-skip-permissions=(\w+)/m);
    if (dangerMatch) {
      config.dangerouslySkipPermissions = dangerMatch[1].toLowerCase() === 'true';
    }

    const allowedMatch = userMessage.match(/(?:^|\s)allowed-tools=\[([^\]]*)\]/m);
    if (allowedMatch) {
      const content = allowedMatch[1].trim();
      if (content) {
        config.allowedTools = content
          .split(',')
          .map(tool => tool.trim().replace(/['"]/g, ''))
          .filter(tool => tool.length > 0);
      } else {
        config.allowedTools = [];
      }
    }

    const disallowedMatch = userMessage.match(/(?:^|\s)disallowed-tools=\[([^\]]*)\]/m);
    if (disallowedMatch) {
      const content = disallowedMatch[1].trim();
      if (content) {
        config.disallowedTools = content
          .split(',')
          .map(tool => tool.trim().replace(/['"]/g, ''))
          .filter(tool => tool.length > 0);
      } else {
        config.disallowedTools = [];
      }
    }

    const mcpAllowedMatch = userMessage.match(/(?:^|\s)mcp-allowed-tools=\[([^\]]*)\]/m);
    if (mcpAllowedMatch) {
      const content = mcpAllowedMatch[1].trim();
      if (content) {
        config.mcpAllowedTools = content
          .split(',')
          .map(tool => tool.trim().replace(/['"]/g, ''))
          .filter(tool => tool.length > 0);
      } else {
        config.mcpAllowedTools = [];
      }
    }

    // Extract prompt
    const promptMatch = userMessage.match(/(?:^|\s)prompt="([^"]+)"/m);
    let cleanedPrompt: string;
    if (promptMatch) {
      cleanedPrompt = promptMatch[1];
    } else {
      // Remove settings from message
      cleanedPrompt = userMessage
        .replace(/(?:^|\s)workspace=[^\s\n]+/gm, '')
        .replace(/(?:^|\s)dangerously-skip-permissions=\w+/gm, '')
        .replace(/(?:^|\s)allowed-tools=\[[^\]]*\]/gm, '')
        .replace(/(?:^|\s)disallowed-tools=\[[^\]]*\]/gm, '')
        .replace(/(?:^|\s)mcp-allowed-tools=\[[^\]]*\]/gm, '')
        .replace(/(?:^|\s)prompt="[^"]+"/gm, '')
        .replace(/(?:^|\s)prompt=/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanedPrompt) cleanedPrompt = userMessage;
    }

    return { config, cleanedPrompt };
  }

  /**
   * Process files from OpenAI request and convert to file paths
   */
  static async processFiles(
    openAIRequest: OpenAIRequest,
    workspacePath: string
  ): Promise<string[]> {
    const filePaths: string[] = [];

    try {
      // Process message content for files and images
      for (const message of openAIRequest.messages) {
        if (message.role === 'user' && Array.isArray(message.content)) {
          for (const contentPart of message.content) {
            if (contentPart.type === 'image_url' && contentPart.image_url) {
              // Process image_url (existing functionality)
              const fileUpload = await fileProcessor.processFileInput(contentPart.image_url.url);
              const fileId = uuidv4();
              const filename = `image_${fileId}.${this.getImageExtension(contentPart.image_url.url)}`;
              const filePath = path.join(workspacePath, filename);

              await fs.writeFile(filePath, fileUpload.file);
              filePaths.push(filePath);

              serverLogger.info(
                {
                  type: 'image_processed',
                  filename,
                  source: 'image_url',
                  size: fileUpload.file.length,
                },
                `Image processed from image_url: ${filename}`
              );
            } else if (contentPart.type === 'file' && contentPart.file) {
              // Process file content part
              const { file_id, file_data, filename } = contentPart.file;

              if (file_id) {
                // Handle file_id - get full path from file storage
                const fullPath = await fileStorage.getFilePath(file_id);
                if (fullPath) {
                  filePaths.push(fullPath); // Use full path directly
                  
                  serverLogger.info(
                    {
                      type: 'file_processed',
                      file_id,
                      source: 'file_id',
                      fullPath,
                    },
                    `File processed from file_id: ${file_id}`
                  );
                } else {
                  serverLogger.warn(
                    {
                      type: 'file_not_found',
                      file_id,
                    },
                    `File not found for file_id: ${file_id}`
                  );
                }
              } else if (file_data) {
                // Handle file_data - existing functionality
                try {
                  // Decode base64 file data
                  const fileBuffer = Buffer.from(file_data, 'base64');
                  const fileId = uuidv4();
                  const safeFilename = filename || `file_${fileId}`;
                  const filePath = path.join(workspacePath, safeFilename);

                  await fs.writeFile(filePath, fileBuffer);
                  filePaths.push(filePath);

                  serverLogger.info(
                    {
                      type: 'file_processed',
                      filename: safeFilename,
                      source: 'file_data',
                      size: fileBuffer.length,
                    },
                    `File processed from file_data: ${safeFilename}`
                  );
                } catch (error) {
                  serverLogger.error(
                    {
                      type: 'file_data_decode_error',
                      filename,
                      error: error instanceof Error ? error.message : 'Unknown error',
                    },
                    `Failed to decode file_data for: ${filename}`
                  );
                }
              } else {
                serverLogger.warn(
                  {
                    type: 'file_missing_data',
                    filename,
                  },
                  'File content part missing both file_id and file_data'
                );
              }
            }
          }
        }
      }
    } catch (error) {
      serverLogger.error(
        {
          type: 'file_processing_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to process files from OpenAI request'
      );
      throw error;
    }

    return filePaths;
  }

  /**
   * Get file extension from image URL or data URL
   */
  private static getImageExtension(url: string): string {
    if (url.startsWith('data:image/')) {
      const match = url.match(/data:image\/([^;]+)/);
      return match ? match[1] : 'png';
    }

    const extension = path.extname(url).slice(1).toLowerCase();
    return extension || 'png';
  }

  /**
   * Convert OpenAI request to Claude API parameters
   */
  static async convertRequest(openAIRequest: OpenAIRequest): Promise<{
    prompt: string;
    systemPrompt: string | null;
    sessionInfo: Partial<SessionInfo>;
    filePaths: string[];
  }> {
    const { messages } = openAIRequest;

    // Extract system prompt
    let systemPrompt: string | null = null;
    let messageStartIndex = 0;
    if (messages.length > 0 && messages[0].role === 'system') {
      systemPrompt =
        typeof messages[0].content === 'string'
          ? messages[0].content
          : fileProcessor.extractTextContent(messages[0].content);
      messageStartIndex = 1;
    }

    // Get the latest user message and extract text content
    const lastMessage = messages[messages.length - 1];
    const userMessage =
      lastMessage?.role === 'user'
        ? typeof lastMessage.content === 'string'
          ? lastMessage.content
          : fileProcessor.extractTextContent(lastMessage.content)
        : '';

    // Extract session info from previous messages
    const previousSessionInfo = this.extractSessionInfo(messages.slice(messageStartIndex));

    // Extract config from current message
    const { config: currentConfig, cleanedPrompt } = this.extractMessageConfig(userMessage);

    // Merge session info (current config takes precedence)
    const sessionInfo: Partial<SessionInfo> = {
      ...previousSessionInfo,
      ...currentConfig,
    };

    // Create workspace for file processing
    const workspacePath = await createWorkspace(sessionInfo.workspace || null);

    // Process files from the request
    const filePaths = await this.processFiles(openAIRequest, workspacePath);

    // Build final prompt with file paths
    const finalPrompt = fileProcessor.buildPromptWithFiles(cleanedPrompt, filePaths);

    return {
      prompt: finalPrompt,
      systemPrompt,
      sessionInfo,
      filePaths,
    };
  }

  /**
   * Format session information for the thinking block
   */
  static formatSessionInfo(sessionInfo: Partial<SessionInfo>): string {
    let info = '';

    if (sessionInfo.session_id) {
      info += `session-id=${sessionInfo.session_id}\n`;
    }
    if (sessionInfo.workspace) {
      info += `workspace=${sessionInfo.workspace}\n`;
    }
    if (
      sessionInfo.dangerouslySkipPermissions !== null &&
      sessionInfo.dangerouslySkipPermissions !== undefined
    ) {
      info += `dangerously-skip-permissions=${sessionInfo.dangerouslySkipPermissions}\n`;
    }
    if (sessionInfo.allowedTools) {
      const toolsStr = sessionInfo.allowedTools.map(tool => `"${tool}"`).join(',');
      info += `allowed-tools=[${toolsStr}]\n`;
    }
    if (sessionInfo.disallowedTools) {
      const toolsStr = sessionInfo.disallowedTools.map(tool => `"${tool}"`).join(',');
      info += `disallowed-tools=[${toolsStr}]\n`;
    }
    if (sessionInfo.mcpAllowedTools) {
      const toolsStr = sessionInfo.mcpAllowedTools.map(tool => `"${tool}"`).join(',');
      info += `mcp-allowed-tools=[${toolsStr}]\n`;
    }

    return info;
  }

  /**
   * Create an OpenAI chunk object
   */
  static createChunk(
    messageId: string,
    content?: string,
    finishReason?: string | null,
    role?: string
  ): object {
    const delta: Record<string, unknown> = {};

    if (role) {
      delta.role = role;
    }
    if (content !== undefined) {
      delta.content = content;
    }

    const chunk = {
      id: messageId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'claude-code',
      system_fingerprint: `fp_${Date.now().toString(36)}`,
      choices: [
        {
          index: 0,
          delta,
          logprobs: null,
          finish_reason: finishReason || null,
        },
      ],
    };

    return chunk;
  }
}
