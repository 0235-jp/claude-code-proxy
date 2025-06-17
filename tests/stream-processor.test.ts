/**
 * Unit tests for StreamProcessor class
 */

import { FastifyReply } from 'fastify';
import { StreamProcessor } from '../src/stream-processor';
import { OpenAITransformer } from '../src/openai-transformer';
import { SessionInfo } from '../src/types';

// Mock OpenAITransformer
jest.mock('../src/openai-transformer');

// Mock logger
jest.mock('../src/logger', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('StreamProcessor', () => {
  let streamProcessor: StreamProcessor;
  let mockReply: Partial<FastifyReply>;
  let mockWrite: jest.Mock;

  beforeEach(() => {
    streamProcessor = new StreamProcessor(100, true); // Enable thinking tags for tests
    mockWrite = jest.fn();
    mockReply = {
      raw: {
        write: mockWrite,
        end: jest.fn(),
      } as any,
    };

    // Setup OpenAITransformer mock
    (OpenAITransformer.createChunk as jest.Mock).mockImplementation(
      (messageId, content, finishReason, role) => ({
        id: messageId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'claude-code',
        system_fingerprint: 'fp_test',
        choices: [
          {
            index: 0,
            delta: {
              ...(role && { role }),
              ...(content !== undefined && { content }),
            },
            logprobs: null,
            finish_reason: finishReason || null,
          },
        ],
      })
    );

    (OpenAITransformer.formatSessionInfo as jest.Mock).mockImplementation(
      (sessionInfo) => {
        let info = '';
        if (sessionInfo.session_id) info += `session-id=${sessionInfo.session_id}\n`;
        if (sessionInfo.workspace) info += `workspace=${sessionInfo.workspace}\n`;
        return info;
      }
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processChunk', () => {
    describe('system init messages', () => {
      it('should process system init with session info', () => {
        const sessionInfo: Partial<SessionInfo> = {
          workspace: 'test-workspace',
        };

        const chunk = Buffer.from('data: {"type":"system","subtype":"init","session_id":"test-123"}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, sessionInfo);

        // Should send role chunk
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('"delta":{"role":"assistant"}')
        );

        // Should send session info
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('session-id=test-123')
        );
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('workspace=test-workspace')
        );
        
        // Should NOT automatically send thinking block
        const thinkingCalls = mockWrite.mock.calls.filter(call => 
          call[0].includes('<thinking>')
        );
        expect(thinkingCalls.length).toBe(0);
      });

      it('should not process system init twice', () => {
        const chunk = Buffer.from('data: {"type":"system","subtype":"init","session_id":"test-456"}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});
        const initialCallCount = mockWrite.mock.calls.length;

        // Process again
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});
        
        // Should not send additional chunks
        expect(mockWrite).toHaveBeenCalledTimes(initialCallCount);
      });
    });

    describe('assistant messages', () => {
      it('should process text content', () => {
        const chunk = Buffer.from('data: {"type":"assistant","message":{"content":[{"type":"text","text":"Hello world"}]}}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        // Should send text content
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('Hello world')
        );
      });

      it('should process thinking content and open thinking block', () => {
        const chunk = Buffer.from('data: {"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Processing request..."}]}}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        // Should open thinking block when thinking content arrives
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('<thinking>')
        );
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('💭 Processing request...')
        );
      });

      it('should process thinking content without tags when showThinking is false', () => {
        const streamProcessorNoThinking = new StreamProcessor(100, false);
        streamProcessorNoThinking.setOriginalWrite(mockWrite);
        const chunk = Buffer.from('data: {"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Processing request..."}]}}');
        
        streamProcessorNoThinking.processChunk(chunk, mockReply as FastifyReply, {});

        // Should not open thinking block
        expect(mockWrite).not.toHaveBeenCalledWith(
          expect.stringContaining('<thinking>')
        );
        // Should show thinking content as code block
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('```💭 Thinking')
        );
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('Processing request...')
        );
      });

      it('should process tool use and open thinking block', () => {
        const chunk = Buffer.from('data: {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file":"test.txt"}}]}}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        // Should open thinking block when tool use arrives
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('<thinking>')
        );
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('🔧 Using Read:')
        );
        // Check that the JSON input is included in one of the calls
        const callsWithToolInput = mockWrite.mock.calls.filter(call => 
          call[0].includes('test.txt')
        );
        expect(callsWithToolInput.length).toBeGreaterThan(0);
      });

      it('should process tool use without tags when showThinking is false', () => {
        const streamProcessorNoThinking = new StreamProcessor(100, false);
        streamProcessorNoThinking.setOriginalWrite(mockWrite);
        const chunk = Buffer.from('data: {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file":"test.txt"}}]}}');
        
        streamProcessorNoThinking.processChunk(chunk, mockReply as FastifyReply, {});

        // Should not open thinking block
        expect(mockWrite).not.toHaveBeenCalledWith(
          expect.stringContaining('<thinking>')
        );
        // Should show tool use content as code block
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('```🔧 Tool use')
        );
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('Using Read:')
        );
      });

      it('should handle final response with stop reason', () => {
        const chunk = Buffer.from('data: {"type":"assistant","message":{"content":[{"type":"text","text":"Done"}],"stop_reason":"end_turn"}}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        // Check that finish_reason is set to 'stop'
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('"finish_reason":"stop"')
        );
      });
    });

    describe('user messages', () => {
      it('should process tool results', () => {
        const chunk = Buffer.from('data: {"type":"user","message":{"content":[{"type":"tool_result","content":"File contents here"}]}}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('✅ Tool Result:')
        );
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('File contents here')
        );
      });

      it('should process tool errors', () => {
        const chunk = Buffer.from('data: {"type":"user","message":{"content":[{"type":"tool_result","content":"Error occurred","is_error":true}]}}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('❌ Tool Error:')
        );
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('Error occurred')
        );
      });

      it('should show tool result content in code blocks without truncation', () => {
        const streamProcessorNoThinking = new StreamProcessor(1000, false); // Large chunk size
        streamProcessorNoThinking.setOriginalWrite(mockWrite);
        const longContent = 'A'.repeat(150); // 150 characters
        const chunk = Buffer.from(`data: {"type":"user","message":{"content":[{"type":"tool_result","content":"${longContent}","is_error":false}]}}`);
        
        streamProcessorNoThinking.processChunk(chunk, mockReply as FastifyReply, {});

        // Check if tool result is shown as code block without truncation
        const calls = mockWrite.mock.calls.map(call => call[0]).join('');
        expect(calls).toContain('```✅ Tool Result');
        expect(calls).toContain('A'.repeat(150)); // Should contain full content (no truncation for code blocks)
      });

      it('should not truncate tool result errors even when showThinking is false', () => {
        const streamProcessorNoThinking = new StreamProcessor(1000, false); // Large chunk size to avoid splitting
        streamProcessorNoThinking.setOriginalWrite(mockWrite);
        const longError = 'Error: ' + 'E'.repeat(150); // 157 characters
        const chunk = Buffer.from(`data: {"type":"user","message":{"content":[{"type":"tool_result","content":"${longError}","is_error":true}]}}`);
        
        streamProcessorNoThinking.processChunk(chunk, mockReply as FastifyReply, {});

        // Check if error is shown as code block
        const calls = mockWrite.mock.calls.map(call => call[0]).join('');
        expect(calls).toContain('```❌ Tool Error');
        expect(calls).toContain('E'.repeat(150)); // Should contain the repeated E's
        expect(calls).not.toContain('...'); // Should not be truncated
      });
    });

    describe('result messages', () => {
      it('should handle success result and end stream', () => {
        const chunk = Buffer.from('data: {"type":"result","subtype":"success"}');
        
        const shouldContinue = streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        expect(shouldContinue).toBe(false);
        expect(mockWrite).toHaveBeenCalledWith('data: [DONE]\n\n');
        expect(mockReply.raw!.end).toHaveBeenCalled();
      });
    });

    describe('error messages', () => {
      it('should process error messages', () => {
        const chunk = Buffer.from('data: {"type":"error","error":"Something went wrong"}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('⚠️ Something went wrong')
        );
      });

      it('should handle error object format', () => {
        const chunk = Buffer.from('data: {"type":"error","error":{"message":"API error"}}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('⚠️ API error')
        );
      });
    });

    describe('unknown messages', () => {
      it('should handle unknown message types', () => {
        const chunk = Buffer.from('data: {"type":"unknown_type","data":"some data"}');
        
        streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('🔍 Unknown data type')
        );
      });
    });

    describe('error handling', () => {
      it('should handle invalid JSON', () => {
        const chunk = Buffer.from('data: {invalid json}');
        
        const shouldContinue = streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        expect(shouldContinue).toBe(true);
        // Logger should have been called but processing continues
      });

      it('should ignore non-data chunks', () => {
        const chunk = Buffer.from('some other data');
        
        const shouldContinue = streamProcessor.processChunk(chunk, mockReply as FastifyReply, {});

        expect(shouldContinue).toBe(true);
        expect(mockWrite).not.toHaveBeenCalled();
      });
    });
  });

  describe('cleanup', () => {
    it('should close thinking block if open', () => {
      // Process thinking content to open thinking block
      const thinkingChunk = Buffer.from('data: {"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Test thinking"}]}}');
      streamProcessor.processChunk(thinkingChunk, mockReply as FastifyReply, {});

      // Clear previous calls
      mockWrite.mockClear();

      streamProcessor.cleanup(mockReply as FastifyReply);

      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringContaining('</thinking>')
      );
    });

    it('should not send anything if thinking is not open', () => {
      streamProcessor.cleanup(mockReply as FastifyReply);

      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should not send closing tag when showThinking is false', () => {
      const streamProcessorNoThinking = new StreamProcessor(100, false);
      streamProcessorNoThinking.setOriginalWrite(mockWrite);
      
      // Process thinking content to open thinking block (but no tags will be shown)
      const thinkingChunk = Buffer.from('data: {"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Test thinking"}]}}');
      streamProcessorNoThinking.processChunk(thinkingChunk, mockReply as FastifyReply, {});

      // Clear previous calls
      mockWrite.mockClear();

      streamProcessorNoThinking.cleanup(mockReply as FastifyReply);

      // Should not send closing thinking tag
      expect(mockWrite).not.toHaveBeenCalledWith(
        expect.stringContaining('</thinking>')
      );
    });
  });

  describe('chunk size handling', () => {
    it('should split large text into smaller chunks', () => {
      const processor = new StreamProcessor(10); // Small chunk size for testing
      const longText = 'This is a very long text that should be split into multiple chunks';

      const chunk = Buffer.from(`data: {"type":"assistant","message":{"content":[{"type":"text","text":"${longText}"}]}}`);
      
      processor.processChunk(chunk, mockReply as FastifyReply, {});

      // Count how many times write was called with content chunks
      const contentCalls = mockWrite.mock.calls.filter(call => 
        call[0].includes('"delta":{"content":')
      );

      // Should be split into multiple calls
      expect(contentCalls.length).toBeGreaterThan(1);
    });
  });
});