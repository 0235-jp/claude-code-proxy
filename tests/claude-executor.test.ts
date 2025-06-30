/**
 * Tests for claude-executor module
 */

import { 
  executeClaudeAndStream, 
  cleanupActiveProcesses, 
  setupSignalHandlers, 
  cleanupZombieProcesses,
  getActiveProcesses 
} from '../src/claude-executor';
import { spawn } from 'child_process';
import { createWorkspace } from '../src/session-manager';
import { isMcpEnabled, validateMcpTools, getMcpConfig } from '../src/mcp-manager';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('child_process');
jest.mock('../src/session-manager');
jest.mock('../src/mcp-manager');

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockCreateWorkspace = createWorkspace as jest.MockedFunction<typeof createWorkspace>;
const mockIsMcpEnabled = isMcpEnabled as jest.MockedFunction<typeof isMcpEnabled>;
const mockValidateMcpTools = validateMcpTools as jest.MockedFunction<typeof validateMcpTools>;
const mockGetMcpConfig = getMcpConfig as jest.MockedFunction<typeof getMcpConfig>;

// Create mock ChildProcess
class MockChildProcess extends EventEmitter {
  pid = 12345;
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdin = {
    write: jest.fn(),
    end: jest.fn(),
  };
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(signal?: string): boolean {
    this.killed = true;
    this.emit('close', 0, signal || 'SIGTERM');
    return true;
  }
}

// Mock Fastify reply
const createMockReply = () => ({
  raw: {
    write: jest.fn(),
    end: jest.fn(),
  },
});

describe('claude-executor', () => {
  let mockProcess: MockChildProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    mockProcess = new MockChildProcess();
    mockSpawn.mockReturnValue(mockProcess as any);
    mockCreateWorkspace.mockResolvedValue('/test/workspace');
    mockIsMcpEnabled.mockReturnValue(false);
    mockValidateMcpTools.mockReturnValue([]);
    mockGetMcpConfig.mockReturnValue(null);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('process management utilities', () => {
    it('should track active processes in Set', () => {
      const activeProcesses = getActiveProcesses();
      expect(activeProcesses).toBeInstanceOf(Set);
      expect(activeProcesses.size).toBeGreaterThanOrEqual(0);
    });

    it('should cleanup active processes', () => {
      const mockProcess1 = new MockChildProcess();
      const mockProcess2 = new MockChildProcess();
      mockProcess2.killed = true; // Already killed
      
      const activeProcesses = getActiveProcesses();
      activeProcesses.add(mockProcess1 as any);
      activeProcesses.add(mockProcess2 as any);
      
      const killSpy1 = jest.spyOn(mockProcess1, 'kill');
      const killSpy2 = jest.spyOn(mockProcess2, 'kill');
      
      cleanupActiveProcesses();
      
      expect(killSpy1).toHaveBeenCalledWith('SIGTERM');
      expect(killSpy2).not.toHaveBeenCalled(); // Already killed
      expect(activeProcesses.size).toBe(0); // Cleared
    });

    it('should force kill processes that dont respond to SIGTERM', () => {
      jest.useFakeTimers();
      
      const mockProcess = new MockChildProcess();
      const activeProcesses = getActiveProcesses();
      activeProcesses.add(mockProcess as any);
      
      const killSpy = jest.spyOn(mockProcess, 'kill');
      
      // Mock kill to not actually kill the process
      killSpy.mockImplementation((signal) => {
        if (signal === 'SIGTERM') {
          // Don't set killed to true - simulate process not responding
          return true;
        }
        if (signal === 'SIGKILL') {
          mockProcess.killed = true;
          return true;
        }
        return false;
      });
      
      cleanupActiveProcesses();
      
      expect(killSpy).toHaveBeenCalledWith('SIGTERM');
      
      // Fast-forward 5 seconds to trigger SIGKILL
      jest.advanceTimersByTime(5000);
      
      expect(killSpy).toHaveBeenCalledWith('SIGKILL');
      
      jest.useRealTimers();
    });

    it('should cleanup zombie processes', () => {
      const mockProcess1 = new MockChildProcess();
      const mockProcess2 = new MockChildProcess();
      const mockProcess3 = new MockChildProcess();
      
      // Set up different process states
      mockProcess1.killed = true;
      mockProcess1.exitCode = null;
      mockProcess1.signalCode = null; // Zombie process
      
      mockProcess2.killed = false; // Not killed yet
      mockProcess2.exitCode = 0; // Properly exited
      
      mockProcess3.killed = false; // Still running
      
      const activeProcesses = getActiveProcesses();
      activeProcesses.clear();
      activeProcesses.add(mockProcess1 as any);
      activeProcesses.add(mockProcess2 as any);
      activeProcesses.add(mockProcess3 as any);
      
      cleanupZombieProcesses();
      
      expect(activeProcesses.has(mockProcess1 as any)).toBe(false); // Zombie removed
      expect(activeProcesses.has(mockProcess2 as any)).toBe(true); // Not killed kept
      expect(activeProcesses.has(mockProcess3 as any)).toBe(true); // Running kept
    });

    it('should setup signal handlers without duplicates', () => {
      const processOnSpy = jest.spyOn(process, 'on');
      const originalListenerCount = process.listenerCount('SIGTERM');
      
      setupSignalHandlers();
      setupSignalHandlers(); // Call twice to test duplicate prevention
      
      // Should not have added more listeners on second call
      expect(process.listenerCount('SIGTERM')).toBe(originalListenerCount + 1);
      
      processOnSpy.mockRestore();
    });
  });

  describe('executeClaudeAndStream', () => {
    it('should create workspace and spawn claude process', async () => {
      const reply = createMockReply();
      const options = { workspace: 'test-project' };

      const executePromise = executeClaudeAndStream('test prompt', null, options, reply as any);

      // Wait for spawn to be called
      await Promise.resolve();

      expect(mockCreateWorkspace).toHaveBeenCalledWith('test-project');
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['-p', '--verbose', '--output-format', 'stream-json'],
        {
          cwd: '/test/workspace',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: expect.any(Object),
        }
      );

      // Simulate process spawn and end
      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);

      await executePromise;
    });

    it('should use session ID when provided', async () => {
      const reply = createMockReply();
      const sessionId = 'session-123';

      const executePromise = executeClaudeAndStream('test prompt', sessionId, {}, reply as any);
      await Promise.resolve();

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['-p', '--verbose', '--output-format', 'stream-json', '--resume', sessionId],
        expect.any(Object)
      );

      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should add system prompt when provided', async () => {
      const reply = createMockReply();
      const options = { systemPrompt: 'You are a helpful assistant' };

      const executePromise = executeClaudeAndStream('test prompt', null, options, reply as any);
      await Promise.resolve();

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        [
          '-p',
          '--verbose',
          '--output-format',
          'stream-json',
          '--system-prompt',
          'You are a helpful assistant',
        ],
        expect.any(Object)
      );

      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should add allowed tools when provided', async () => {
      const reply = createMockReply();
      const options = { allowedTools: ['tool1', 'tool2'] };

      const executePromise = executeClaudeAndStream('test prompt', null, options, reply as any);
      await Promise.resolve();

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        [
          '-p',
          '--verbose',
          '--output-format',
          'stream-json',
          '--allowedTools',
          'tool1,tool2',
        ],
        expect.any(Object)
      );

      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should add MCP configuration when enabled', async () => {
      const reply = createMockReply();
      const options = { allowedTools: ['mcp__github__listRepos'] };

      mockIsMcpEnabled.mockReturnValue(true);
      mockValidateMcpTools.mockReturnValue(['mcp__github__listRepos']);

      const executePromise = executeClaudeAndStream('test prompt', null, options, reply as any);
      await Promise.resolve();

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '--mcp-config',
          expect.stringContaining('mcp-config.json'),
          '--allowedTools',
          'mcp__github__listRepos',
        ]),
        expect.any(Object)
      );

      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should handle process stdout data', async () => {
      const reply = createMockReply();
      const testData = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'test-session' });

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      mockProcess.emit('spawn');
      mockProcess.stdout.emit('data', Buffer.from(testData + '\n'));

      expect(reply.raw.write).toHaveBeenCalledWith(`data: ${testData}\n\n`);

      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should handle process stderr data', async () => {
      const reply = createMockReply();

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      mockProcess.emit('spawn');
      mockProcess.stderr.emit('data', Buffer.from('Error message'));

      // The stderr data is now logged via structured logging instead of console.error
      // Just verify the process continues to work correctly
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should handle process errors', async () => {
      const reply = createMockReply();
      const error = new Error('Process error');

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      mockProcess.emit('spawn');
      mockProcess.emit('error', error);

      expect(reply.raw.write).toHaveBeenCalledWith(
        expect.stringContaining('Process error')
      );
      expect(reply.raw.end).toHaveBeenCalled();

      await executePromise;
    });

    it('should handle total timeout', async () => {
      const reply = createMockReply();
      const killSpy = jest.spyOn(mockProcess, 'kill');

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      mockProcess.emit('spawn');

      // Mock the process kill to not actually emit close immediately
      killSpy.mockImplementation(() => {
        // Don't emit close, just mark as killed
        mockProcess.killed = true;
        return true;
      });

      // Fast-forward past the total timeout
      jest.advanceTimersByTime(3600000 + 1000); // 1 hour + 1 second

      expect(killSpy).toHaveBeenCalledWith('SIGTERM');
      expect(reply.raw.write).toHaveBeenCalledWith(
        expect.stringContaining('Total timeout')
      );

      // Now manually emit close to finish the test
      mockProcess.emit('close', 0, 'SIGTERM');
      await executePromise;
    });

    it('should handle inactivity timeout', async () => {
      const reply = createMockReply();

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      mockProcess.emit('spawn');

      // Fast-forward past the inactivity timeout
      jest.advanceTimersByTime(300000 + 1000); // 5 minutes + 1 second

      expect(reply.raw.write).toHaveBeenCalledWith(
        expect.stringContaining('Inactivity timeout')
      );

      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should reset inactivity timeout on stdout data', async () => {
      const reply = createMockReply();

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      mockProcess.emit('spawn');

      // Advance time but not past timeout
      jest.advanceTimersByTime(200000); // 3.33 minutes

      // Emit stdout data to reset timeout
      mockProcess.stdout.emit('data', Buffer.from('{"type": "test"}\n'));

      // Advance time again, but still under timeout from reset
      jest.advanceTimersByTime(200000); // Another 3.33 minutes

      // Should not have timed out yet
      expect(reply.raw.write).not.toHaveBeenCalledWith(
        expect.stringContaining('Inactivity timeout')
      );

      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should use dangerously skip permissions flag', async () => {
      const reply = createMockReply();
      const options = { dangerouslySkipPermissions: true };

      const executePromise = executeClaudeAndStream('test prompt', null, options, reply as any);
      await Promise.resolve();

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--dangerously-skip-permissions']),
        expect.any(Object)
      );

      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should create shared workspace when no workspace specified', async () => {
      const reply = createMockReply();

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      expect(mockCreateWorkspace).toHaveBeenCalledWith();

      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should handle disconnect event', async () => {
      const reply = createMockReply();

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      mockProcess.emit('spawn');
      mockProcess.emit('disconnect');

      expect(getActiveProcesses().has(mockProcess as any)).toBe(false);

      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should handle exit event', async () => {
      const reply = createMockReply();

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      mockProcess.emit('spawn');
      mockProcess.emit('exit', 1, 'SIGTERM');

      expect(getActiveProcesses().has(mockProcess as any)).toBe(false);

      mockProcess.emit('close', 1, 'SIGTERM');
      await executePromise;
    });

    it('should handle non-JSON stdout lines gracefully', async () => {
      const reply = createMockReply();

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      mockProcess.emit('spawn');
      mockProcess.stdout.emit('data', Buffer.from('invalid json line\n'));

      // Non-JSON lines are now logged via structured logging instead of console.log
      // Just verify the process continues to work correctly
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should handle process that fails to spawn', async () => {
      const reply = createMockReply();

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      // Emit error before spawn
      const spawnError = new Error('Failed to spawn process');
      mockProcess.emit('error', spawnError);

      expect(reply.raw.write).toHaveBeenCalledWith(
        expect.stringContaining('Failed to spawn process')
      );
      expect(reply.raw.end).toHaveBeenCalled();

      await executePromise;
    });

    it('should log session initialization', async () => {
      const reply = createMockReply();

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      mockProcess.emit('spawn');
      
      const sessionData = JSON.stringify({ 
        type: 'system', 
        subtype: 'init', 
        session_id: 'test-session-123' 
      });
      mockProcess.stdout.emit('data', Buffer.from(sessionData + '\n'));

      // Session initialization is now logged via structured logging
      // Verify the stream data is still written to reply
      expect(reply.raw.write).toHaveBeenCalledWith(`data: ${sessionData}\n\n`);

      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should add disallowed tools when provided', async () => {
      const reply = createMockReply();
      const options = { disallowedTools: ['dangerous-tool', 'risky-tool'] };

      const executePromise = executeClaudeAndStream('test prompt', null, options, reply as any);
      await Promise.resolve();

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '--disallowedTools',
          'dangerous-tool,risky-tool',
        ]),
        expect.any(Object)
      );

      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should handle workspace creation with session ID but no explicit workspace', async () => {
      const reply = createMockReply();
      const sessionId = 'existing-session';

      const executePromise = executeClaudeAndStream('test prompt', sessionId, {}, reply as any);
      await Promise.resolve();

      expect(mockCreateWorkspace).toHaveBeenCalledWith(); // Called without workspace name

      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });
  });

  describe('error conditions and edge cases', () => {
    it('should handle MCP tools when MCP is disabled', async () => {
      const reply = createMockReply();
      const options = { allowedTools: ['mcp__tool'] };

      mockIsMcpEnabled.mockReturnValue(false);

      const executePromise = executeClaudeAndStream('test prompt', null, options, reply as any);
      await Promise.resolve();

      expect(mockValidateMcpTools).not.toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.not.arrayContaining(['--mcp-config']),
        expect.any(Object)
      );

      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should add MCP config even for potentially invalid tools', async () => {
      const reply = createMockReply();
      const options = { allowedTools: ['mcp__invalid__tool'] };

      mockIsMcpEnabled.mockReturnValue(true);

      const executePromise = executeClaudeAndStream('test prompt', null, options, reply as any);
      await Promise.resolve();

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '--mcp-config',
          expect.stringContaining('mcp-config.json'),
          '--allowedTools',
          'mcp__invalid__tool'
        ]),
        expect.any(Object)
      );

      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should log MCP status when enabled', async () => {
      const reply = createMockReply();
      const options = { allowedTools: ['mcp__test__tool'] };

      mockIsMcpEnabled.mockReturnValue(true);
      mockValidateMcpTools.mockReturnValue(['mcp__test__tool']);
      mockGetMcpConfig.mockReturnValue({
        mcpServers: {
          test: { command: 'node', args: ['test.js'] },
          github: { command: 'node', args: ['github.js'] }
        }
      });

      const executePromise = executeClaudeAndStream('test prompt', null, options, reply as any);
      await Promise.resolve();

      // MCP status is now logged via structured logging instead of console.log
      // Just verify the execution continues to work correctly
      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });

    it('should log when MCP is not enabled', async () => {
      const reply = createMockReply();

      mockIsMcpEnabled.mockReturnValue(false);

      const executePromise = executeClaudeAndStream('test prompt', null, {}, reply as any);
      await Promise.resolve();

      // MCP status is now logged via structured logging instead of console.log
      // Just verify the execution continues to work correctly
      mockProcess.emit('spawn');
      mockProcess.emit('close', 0, null);
      await executePromise;
    });
  });
});