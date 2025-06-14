/**
 * Claude CLI process execution and management
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { createWorkspace } from './session-manager';
import { isMcpEnabled, validateMcpTools, getMcpConfig } from './mcp-manager';
import { ClaudeOptions } from './types';
import { FastifyReply } from 'fastify';

/**
 * Execute Claude CLI command with specified parameters
 * @param prompt - The prompt to send to Claude
 * @param claudeSessionId - Session ID to resume (optional)
 * @param workspacePath - Path to workspace directory
 * @param options - Claude execution options
 * @returns Spawned Claude process
 */
function executeClaudeCommand(
  _prompt: string,
  claudeSessionId: string | null,
  workspacePath: string,
  options: ClaudeOptions = {}
): ChildProcess {
  const args = ['-p', '--verbose', '--output-format', 'stream-json'];

  if (claudeSessionId) {
    args.push('--resume', claudeSessionId);
  }

  if (options.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  if (options.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt);
  }

  // Collect all allowed tools (regular + MCP)
  let allAllowedTools: string[] = [];
  if (options.allowedTools && options.allowedTools.length > 0) {
    allAllowedTools = [...options.allowedTools];
  }

  // Add MCP configuration if enabled and tools are requested
  if (isMcpEnabled() && options.mcpAllowedTools && options.mcpAllowedTools.length > 0) {
    const validMcpTools = validateMcpTools(options.mcpAllowedTools);
    if (validMcpTools.length > 0) {
      const mcpConfigPath = path.join(__dirname, '..', 'mcp-config.json');
      args.push('--mcp-config', mcpConfigPath);
      allAllowedTools = [...allAllowedTools, ...validMcpTools];
      console.log('MCP enabled with tools:', validMcpTools);
    }
  }

  // Add combined allowed tools if any
  if (allAllowedTools.length > 0) {
    args.push('--allowedTools', allAllowedTools.join(','));
  }

  if (options.disallowedTools && options.disallowedTools.length > 0) {
    args.push('--disallowedTools', options.disallowedTools.join(','));
  }

  return spawn('claude', args, {
    cwd: workspacePath,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
}

/**
 * Track active Claude processes for cleanup
 */
const activeProcesses = new Set<ChildProcess>();

/**
 * Get active processes (for testing)
 */
export function getActiveProcesses(): Set<ChildProcess> {
  return activeProcesses;
}

/**
 * Cleanup function to kill all active processes
 */
export function cleanupActiveProcesses(): void {
  console.log(`Cleaning up ${activeProcesses.size} active processes`);
  activeProcesses.forEach(proc => {
    if (proc && !proc.killed) {
      console.log(`Killing process ${proc.pid}`);
      proc.kill('SIGTERM');
      // If SIGTERM doesn't work, force kill after 5 seconds
      setTimeout(() => {
        if (proc && !proc.killed) {
          console.log(`Force killing process ${proc.pid}`);
          proc.kill('SIGKILL');
        }
      }, 5000);
    }
  });
  activeProcesses.clear();
}

/**
 * Setup process signal handlers for graceful shutdown
 */
// Track if signal handlers have been set up to prevent duplicates
let handlersSetup = false;

export function setupSignalHandlers(): void {
  if (!handlersSetup) {
    process.on('SIGTERM', () => {
      console.log('Received SIGTERM, cleaning up processes...');
      cleanupActiveProcesses();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('Received SIGINT, cleaning up processes...');
      cleanupActiveProcesses();
      process.exit(0);
    });

    process.on('SIGQUIT', () => {
      console.log('Received SIGQUIT, cleaning up processes...');
      cleanupActiveProcesses();
      process.exit(0);
    });

    handlersSetup = true;
  }
}

/**
 * Check for and clean up zombie processes
 */
export function cleanupZombieProcesses(): void {
  activeProcesses.forEach(proc => {
    if (proc && proc.killed && !proc.exitCode && !proc.signalCode) {
      console.log(`Removing zombie process ${proc.pid} from active list`);
      activeProcesses.delete(proc);
    }
  });
}

/**
 * Execute Claude command and stream responses to client
 * @param prompt - The prompt to send to Claude
 * @param claudeSessionId - Session ID to resume (optional)
 * @param options - Claude execution options
 * @param reply - Fastify reply object for streaming
 */
export async function executeClaudeAndStream(
  prompt: string,
  claudeSessionId: string | null,
  options: ClaudeOptions,
  reply: FastifyReply
): Promise<void> {
  let workspacePath: string;

  if (options.workspace) {
    workspacePath = await createWorkspace(options.workspace);
  } else if (claudeSessionId) {
    workspacePath = await createWorkspace();
  } else {
    workspacePath = await createWorkspace();
  }

  console.log(`Executing Claude in workspace: ${workspacePath}`);
  console.log(`Options:`, options);

  // Log MCP status
  if (isMcpEnabled()) {
    const mcpConfig = getMcpConfig();
    const serverCount = Object.keys(mcpConfig?.mcpServers || {}).length;
    console.log(`MCP enabled with ${serverCount} server(s) configured`);
    if (options.mcpAllowedTools && options.mcpAllowedTools.length > 0) {
      console.log(`MCP tools requested:`, options.mcpAllowedTools);
    }
  } else {
    console.log('MCP not enabled (no mcp-config.json found)');
  }

  const timeoutMs = 3600000; // 1 hour
  console.log(`Total timeout set to: ${timeoutMs}ms (${timeoutMs / 60000} minutes)`);

  // Setup signal handlers for graceful shutdown
  setupSignalHandlers();

  // Clean up any zombie processes
  cleanupZombieProcesses();

  const claudeProcess = executeClaudeCommand(prompt, claudeSessionId, workspacePath, options);

  // Track this process for cleanup
  activeProcesses.add(claudeProcess);

  claudeProcess.on('spawn', () => {
    console.log('Claude process spawned successfully');
    claudeProcess.stdin?.write(prompt);
    claudeProcess.stdin?.end();
  });

  const totalTimeout = setTimeout(() => {
    console.log('Claude process total timeout - killing process');
    claudeProcess.kill('SIGTERM');
    // Force kill if SIGTERM doesn't work
    setTimeout(() => {
      if (claudeProcess && !claudeProcess.killed) {
        console.log('Force killing Claude process after timeout');
        claudeProcess.kill('SIGKILL');
      }
    }, 5000);
    reply.raw.write(
      `data: ${JSON.stringify({
        type: 'result',
        subtype: 'timeout',
        is_error: true,
        result: `Total timeout (${timeoutMs / 60000} minutes)`,
        session_id: claudeSessionId || null,
      })}\n\n`
    );
    reply.raw.end();
  }, timeoutMs);

  let inactivityTimeout: NodeJS.Timeout;
  const resetInactivityTimeout = (): void => {
    if (inactivityTimeout) clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(() => {
      console.log('Claude process inactivity timeout - killing process');
      claudeProcess.kill('SIGTERM');
      // Force kill if SIGTERM doesn't work
      setTimeout(() => {
        if (claudeProcess && !claudeProcess.killed) {
          console.log('Force killing Claude process after inactivity timeout');
          claudeProcess.kill('SIGKILL');
        }
      }, 5000);
      reply.raw.write(
        `data: ${JSON.stringify({
          type: 'result',
          subtype: 'timeout',
          is_error: true,
          result: 'Inactivity timeout (5 minutes since last output)',
          session_id: claudeSessionId || null,
        })}\n\n`
      );
      reply.raw.end();
    }, 300000);
  };
  resetInactivityTimeout();

  claudeProcess.stdout?.on('data', async (data: Buffer) => {
    console.log('Claude stdout:', data.toString());
    resetInactivityTimeout();

    const lines = data
      .toString()
      .split('\n')
      .filter(line => line.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line);

        if (json.type === 'system' && json.subtype === 'init' && json.session_id) {
          console.log('Session initialized:', json.session_id);
        }

        reply.raw.write(`data: ${line}\n\n`);
      } catch (e) {
        console.log('Non-JSON line:', line);
      }
    }
  });

  claudeProcess.stderr?.on('data', (data: Buffer) => {
    console.error('Claude stderr:', data.toString());
  });

  claudeProcess.on('close', (code: number | null, signal: string | null) => {
    console.log(`Claude process exited with code ${code}, signal ${signal}`);
    clearTimeout(totalTimeout);
    if (inactivityTimeout) clearTimeout(inactivityTimeout);

    // Remove from active processes
    activeProcesses.delete(claudeProcess);

    reply.raw.end();
  });

  claudeProcess.on('error', (error: Error) => {
    console.error('Claude process error:', error);
    clearTimeout(totalTimeout);
    if (inactivityTimeout) clearTimeout(inactivityTimeout);

    // Remove from active processes
    activeProcesses.delete(claudeProcess);

    reply.raw.write(
      `data: ${JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        result: error.message,
        session_id: claudeSessionId || null,
      })}\n\n`
    );
    reply.raw.end();
  });

  // Handle process disconnection
  claudeProcess.on('disconnect', () => {
    console.log('Claude process disconnected');
    activeProcesses.delete(claudeProcess);
  });

  // Handle process exit
  claudeProcess.on('exit', (code: number | null, signal: string | null) => {
    console.log(`Claude process exit with code ${code}, signal ${signal}`);
    activeProcesses.delete(claudeProcess);
  });
}
