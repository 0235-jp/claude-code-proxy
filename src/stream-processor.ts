/**
 * Stream processing utilities for OpenAI-compatible streaming
 */

import { FastifyReply } from 'fastify';
import { StreamJsonData, SessionInfo } from './types';
import { OpenAITransformer } from './openai-transformer';
import { createLogger } from './logger';

const logger = createLogger('stream-processor');

/**
 * Handles Claude CLI stream processing and conversion to OpenAI format
 */
export class StreamProcessor {
  private inThinking = false;
  private sessionPrinted = false;
  private readonly messageId: string;
  private readonly chunkSize: number;
  private originalWrite: Function | null = null;
  private showThinking = true;

  constructor(chunkSize = 100, showThinking = false) {
    this.messageId = `chatcmpl-${Date.now()}`;
    this.chunkSize = chunkSize;
    this.showThinking = showThinking;
  }

  /**
   * Set the original write method to avoid infinite loops
   */
  setOriginalWrite(originalWrite: Function): void {
    this.originalWrite = originalWrite;
  }

  /**
   * Split text into chunks for streaming
   */
  private splitIntoChunks(text: string): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += this.chunkSize) {
      chunks.push(text.slice(i, i + this.chunkSize));
    }
    return chunks;
  }

  /**
   * Send a chunk to the stream
   */
  private sendChunk(
    reply: FastifyReply,
    content?: string,
    finishReason: string | null = null,
    role?: string
  ): void {
    try {
      const chunk = OpenAITransformer.createChunk(this.messageId, content, finishReason, role);
      // Use original write method to avoid infinite loop
      if (this.originalWrite) {
        this.originalWrite.call(reply.raw, `data: ${JSON.stringify(chunk)}\n\n`);
      } else {
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          type: 'chunk_write_error',
        },
        'Failed to write chunk to stream'
      );
    }
  }

  /**
   * Process system initialization message
   */
  private processSystemInit(
    jsonData: StreamJsonData,
    sessionInfo: Partial<SessionInfo>,
    reply: FastifyReply
  ): void {
    const sessionId = jsonData.session_id;
    if (sessionId && !this.sessionPrinted) {
      this.sessionPrinted = true;

      // Build session info content
      const formattedSessionInfo = OpenAITransformer.formatSessionInfo({
        ...sessionInfo,
        session_id: sessionId,
      });

      // Send initial chunk with role
      this.sendChunk(reply, undefined, null, 'assistant');

      // Send session info in chunks (without automatic thinking block)
      const chunks = this.splitIntoChunks(formattedSessionInfo);
      for (const chunk of chunks) {
        this.sendChunk(reply, chunk);
      }
    }
  }

  /**
   * Process assistant message
   */
  private processAssistantMessage(jsonData: StreamJsonData, reply: FastifyReply): void {
    const message = jsonData.message || {};
    const content = message.content || [];
    const stopReason = message.stop_reason;
    const isFinalResponse = stopReason === 'end_turn';

    for (const item of content) {
      if (item.type === 'text') {
        // Close thinking when text content arrives
        if (this.inThinking) {
          if (this.showThinking) {
            this.sendChunk(reply, '\n</thinking>\n');
          }
          this.inThinking = false;
        }

        const textContent = item.text || '';
        const fullText = `\n${textContent}`;
        const chunks = this.splitIntoChunks(fullText);
        for (let i = 0; i < chunks.length; i++) {
          this.sendChunk(
            reply,
            chunks[i],
            i === chunks.length - 1 && isFinalResponse ? 'stop' : null
          );
        }
      } else if (item.type === 'thinking') {
        // Always process thinking content
        const thinkingContent = item.thinking || '';

        if (this.showThinking) {
          // Show thinking tags when enabled
          if (!this.inThinking) {
            this.sendChunk(reply, '\n<thinking>\n');
            this.inThinking = true;
          }
        }

        // Always show thinking content
        const fullText = `\n💭 ${thinkingContent}\n\n`;
        const chunks = this.splitIntoChunks(fullText);
        for (const chunk of chunks) {
          this.sendChunk(reply, chunk);
        }
      } else if (item.type === 'tool_use') {
        // Always process tool use content
        const toolName = item.name || 'Unknown';
        const toolInput = JSON.stringify(item.input || {});

        if (this.showThinking) {
          // Show thinking tags when enabled
          if (!this.inThinking) {
            this.sendChunk(reply, '\n<thinking>\n');
            this.inThinking = true;
          }
        }

        // Always show tool use content
        const fullText = `\n🔧 Using ${toolName}: ${toolInput}\n\n`;
        const chunks = this.splitIntoChunks(fullText);
        for (const chunk of chunks) {
          this.sendChunk(reply, chunk);
        }
      }
    }

    // Send empty delta with finish_reason for final response (if text didn't already send it)
    if (isFinalResponse && content.every(item => item.type !== 'text')) {
      // Close thinking if still open at end of final response
      if (this.inThinking) {
        if (this.showThinking) {
          this.sendChunk(reply, '\n</thinking>\n');
        }
        this.inThinking = false;
      }

      this.sendChunk(reply, undefined, 'stop');
    }
  }

  /**
   * Process user message (tool results)
   */
  private processUserMessage(jsonData: StreamJsonData, reply: FastifyReply): void {
    const message = jsonData.message || {};
    const content = message.content || [];

    for (const item of content) {
      if (item.type === 'tool_result') {
        // Always process tool result content
        const toolContent = item.content || '';
        const isError = item.is_error || false;
        const prefix = isError ? '\n❌ Tool Error: ' : '\n✅ Tool Result: ';

        if (this.showThinking) {
          // Show thinking tags when enabled
          if (!this.inThinking) {
            this.sendChunk(reply, '\n<thinking>\n');
            this.inThinking = true;
          }
        }

        // Always show tool result content
        let displayContent = toolContent;
        if (!this.showThinking && !isError && toolContent.length > 100) {
          displayContent = toolContent.substring(0, 100) + '...[truncated]';
        }
        const fullText = prefix + displayContent + '\n\n';
        const chunks = this.splitIntoChunks(fullText);
        for (const chunk of chunks) {
          this.sendChunk(reply, chunk);
        }
      }
    }
  }

  /**
   * Process success result
   */
  private processSuccessResult(reply: FastifyReply): void {
    // Close thinking block if still open
    if (this.inThinking) {
      if (this.showThinking) {
        this.sendChunk(reply, '\n</thinking>\n');
      }
      this.inThinking = false;
    }

    // Send final chunk with stop reason
    this.sendChunk(reply, undefined, 'stop');

    // End the stream
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
  }

  /**
   * Process error message
   */
  private processError(jsonData: StreamJsonData, reply: FastifyReply): void {
    if (this.inThinking) {
      if (this.showThinking) {
        this.sendChunk(reply, '\n</thinking>\n');
      }
      this.inThinking = false;
    }

    const errorMessage =
      typeof jsonData.error === 'string'
        ? jsonData.error
        : jsonData.error?.message || JSON.stringify(jsonData.error) || 'Unknown error';

    const fullText = `⚠️ ${errorMessage}\n\n`;
    const chunks = this.splitIntoChunks(fullText);
    for (let i = 0; i < chunks.length; i++) {
      this.sendChunk(reply, chunks[i], i === chunks.length - 1 ? 'stop' : null);
    }
  }

  /**
   * Process unknown message type
   */
  private processUnknown(jsonData: StreamJsonData, reply: FastifyReply): void {
    logger.warn(
      {
        unknownType: jsonData.type,
        data: jsonData,
        type: 'unknown_json_type',
      },
      `Received unknown JSON data type: ${jsonData.type}`
    );

    // Always process unknown data for debugging
    const unknownText = `\n🔍 Unknown data type '${jsonData.type}': ${JSON.stringify(jsonData, null, 2)}\n\n`;

    if (this.showThinking) {
      // Show thinking tags when enabled
      if (!this.inThinking) {
        this.sendChunk(reply, '\n<thinking>\n');
        this.inThinking = true;
      }
    }

    // Always show unknown data
    const chunks = this.splitIntoChunks(unknownText);
    for (const chunk of chunks) {
      this.sendChunk(reply, chunk);
    }
  }

  /**
   * Process a single data chunk from Claude CLI
   */
  processChunk(
    chunk: Buffer | string,
    reply: FastifyReply,
    sessionInfo: Partial<SessionInfo>
  ): boolean {
    const chunkStr = chunk.toString();
    if (!chunkStr.startsWith('data: ')) {
      return true;
    }

    try {
      const jsonStr = chunkStr.replace('data: ', '').trim();
      if (!jsonStr) return true;

      const jsonData: StreamJsonData = JSON.parse(jsonStr);

      switch (jsonData.type) {
        case 'system':
          if (jsonData.subtype === 'init') {
            this.processSystemInit(jsonData, sessionInfo, reply);
          }
          break;

        case 'assistant':
          this.processAssistantMessage(jsonData, reply);
          break;

        case 'user':
          this.processUserMessage(jsonData, reply);
          break;

        case 'result':
          if (jsonData.subtype === 'success') {
            this.processSuccessResult(reply);
            return false; // Signal end of stream
          }
          break;

        case 'error':
          this.processError(jsonData, reply);
          break;

        default:
          this.processUnknown(jsonData, reply);
          break;
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          chunk: chunkStr,
          type: 'json_parse_error',
        },
        'Failed to parse JSON data'
      );
    }

    return true; // Continue processing
  }

  /**
   * Clean up any open thinking blocks
   */
  cleanup(reply: FastifyReply): void {
    if (this.inThinking) {
      if (this.showThinking) {
        this.sendChunk(reply, '\n</thinking>\n');
      }
      this.inThinking = false;
    }
  }
}
