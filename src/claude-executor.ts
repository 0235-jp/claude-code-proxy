/**
 * Claude CLI process execution and management
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { createWorkspace } from './session-manager';
import { isMcpEnabled, validateMcpTools, getMcpConfig } from './mcp-manager';
import { ClaudeOptions } from './types';
import { FastifyReply } from 'fastify';
import { executorLogger, createRequestLogger, logProcessEvent } from './logger';

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

  // Process allowed tools and separate MCP tools
  let regularTools: string[] = [];
  let mcpTools: string[] = [];
  
  if (options.allowedTools && options.allowedTools.length > 0) {
    // Separate MCP tools from regular tools
    options.allowedTools.forEach(tool => {
      if (tool.startsWith('mcp__')) {
        mcpTools.push(tool);
      } else {
        regularTools.push(tool);
      }
    });
  }

  // Validate and add MCP configuration if MCP tools are present
  let validMcpTools: string[] = [];
  if (isMcpEnabled() && mcpTools.length > 0) {
    validMcpTools = validateMcpTools(mcpTools);
    if (validMcpTools.length > 0) {
      const mcpConfigPath =
        process.env.MCP_CONFIG_PATH || path.join(__dirname, '..', 'mcp-config.json');
      args.push('--mcp-config', mcpConfigPath);
      executorLogger.info(
        {
          mcpTools: validMcpTools,
          toolCount: validMcpTools.length,
          type: 'mcp_config',
        },
        'MCP enabled with validated tools'
      );
    }
  }

  // Combine all valid tools
  const allAllowedTools = [...regularTools, ...validMcpTools];

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
  executorLogger.info(
    {
      activeProcessCount: activeProcesses.size,
      type: 'process_cleanup',
    },
    `Cleaning up ${activeProcesses.size} active processes`
  );

  activeProcesses.forEach(proc => {
    if (proc && !proc.killed) {
      logProcessEvent(
        'signal',
        {
          ...(proc.pid && { pid: proc.pid }),
          signal: 'SIGTERM',
          command: 'claude',
        },
        { reason: 'cleanup' }
      );

      proc.kill('SIGTERM');
      // If SIGTERM doesn't work, force kill after configured timeout
      const killTimeoutMs = parseInt(process.env.PROCESS_KILL_TIMEOUT_MS || '5000', 10);
      setTimeout(() => {
        if (proc && !proc.killed) {
          logProcessEvent(
            'signal',
            {
              ...(proc.pid && { pid: proc.pid }),
              signal: 'SIGKILL',
              command: 'claude',
            },
            { reason: 'force_cleanup' }
          );

          proc.kill('SIGKILL');
        }
      }, killTimeoutMs);
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
      executorLogger.info(
        { signal: 'SIGTERM', type: 'signal_received' },
        'Received SIGTERM, cleaning up processes...'
      );
      cleanupActiveProcesses();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      executorLogger.info(
        { signal: 'SIGINT', type: 'signal_received' },
        'Received SIGINT, cleaning up processes...'
      );
      cleanupActiveProcesses();
      process.exit(0);
    });

    process.on('SIGQUIT', () => {
      executorLogger.info(
        { signal: 'SIGQUIT', type: 'signal_received' },
        'Received SIGQUIT, cleaning up processes...'
      );
      cleanupActiveProcesses();
      process.exit(0);
    });

    handlersSetup = true;
    executorLogger.debug({ type: 'signal_handlers' }, 'Signal handlers setup completed');
  }
}

/**
 * Check for and clean up zombie processes
 */
export function cleanupZombieProcesses(): void {
  const zombieCount = Array.from(activeProcesses).filter(
    proc => proc && proc.killed && !proc.exitCode && !proc.signalCode
  ).length;

  if (zombieCount > 0) {
    executorLogger.debug(
      {
        zombieCount,
        type: 'zombie_cleanup',
      },
      `Found ${zombieCount} zombie processes to clean up`
    );
  }

  activeProcesses.forEach(proc => {
    if (proc && proc.killed && !proc.exitCode && !proc.signalCode) {
      executorLogger.debug(
        {
          pid: proc.pid,
          type: 'zombie_removal',
        },
        `Removing zombie process ${proc.pid} from active list`
      );
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

  // Separate MCP tools from regular tools for logging
  let mcpToolsForLogging: string[] = [];
  if (options.allowedTools) {
    mcpToolsForLogging = options.allowedTools.filter(tool => tool.startsWith('mcp__'));
  }

  // Create request-scoped logger for this execution
  const requestLogger = createRequestLogger('claude-execution');

  // Log execution start with detailed context
  requestLogger.info(
    {
      workspacePath,
      workspace: options.workspace || 'default',
      sessionId: claudeSessionId,
      promptLength: prompt.length,
      options: {
        systemPrompt: options.systemPrompt ? options.systemPrompt.length + ' characters' : null,
        dangerouslySkipPermissions: options.dangerouslySkipPermissions || false,
        allowedToolsCount: options.allowedTools?.length || 0,
        disallowedToolsCount: options.disallowedTools?.length || 0,
        mcpToolsCount: mcpToolsForLogging.length,
      },
      type: 'execution_start',
    },
    'Starting Claude execution'
  );

  // Log MCP status with structured data
  if (isMcpEnabled()) {
    const mcpConfig = getMcpConfig();
    const serverCount = Object.keys(mcpConfig?.mcpServers || {}).length;
    requestLogger.info(
      {
        mcpEnabled: true,
        serverCount,
        requestedMcpTools: mcpToolsForLogging,
        type: 'mcp_status',
      },
      `MCP enabled with ${serverCount} server(s) configured`
    );
  } else {
    requestLogger.debug(
      {
        mcpEnabled: false,
        type: 'mcp_status',
      },
      'MCP not enabled (no mcp-config.json found)'
    );
  }

  const timeoutMs = parseInt(process.env.CLAUDE_TOTAL_TIMEOUT_MS || '3600000', 10); // Default: 1 hour
  requestLogger.debug(
    {
      timeoutMs,
      timeoutMinutes: timeoutMs / 60000,
      type: 'timeout_config',
    },
    `Total timeout set to: ${timeoutMs}ms (${timeoutMs / 60000} minutes)`
  );

  // Setup signal handlers for graceful shutdown
  setupSignalHandlers();

  // Clean up any zombie processes
  cleanupZombieProcesses();

  const claudeProcess = executeClaudeCommand(prompt, claudeSessionId, workspacePath, options);

  // Track this process for cleanup
  activeProcesses.add(claudeProcess);

  claudeProcess.on('spawn', () => {
    logProcessEvent(
      'spawn',
      {
        ...(claudeProcess.pid && { pid: claudeProcess.pid }),
        command: 'claude',
      },
      {
        workspacePath,
        sessionId: claudeSessionId,
        promptLength: prompt.length,
      }
    );

    claudeProcess.stdin?.write(prompt);
    claudeProcess.stdin?.end();
  });

  const totalTimeout = setTimeout(() => {
    logProcessEvent(
      'timeout',
      {
        ...(claudeProcess.pid && { pid: claudeProcess.pid }),
        command: 'claude',
      },
      {
        timeoutType: 'total',
        timeoutMs,
        sessionId: claudeSessionId,
        workspacePath,
      }
    );

    claudeProcess.kill('SIGTERM');
    // Force kill if SIGTERM doesn't work
    const killTimeoutMs = parseInt(process.env.PROCESS_KILL_TIMEOUT_MS || '5000', 10);
    setTimeout(() => {
      if (claudeProcess && !claudeProcess.killed) {
        logProcessEvent(
          'signal',
          {
            ...(claudeProcess.pid && { pid: claudeProcess.pid }),
            command: 'claude',
            signal: 'SIGKILL',
          },
          { reason: 'force_kill_after_timeout' }
        );

        claudeProcess.kill('SIGKILL');
      }
    }, killTimeoutMs);
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

  const inactivityTimeoutMs = parseInt(process.env.CLAUDE_INACTIVITY_TIMEOUT_MS || '300000', 10); // Default: 5 minutes
  let inactivityTimeout: NodeJS.Timeout;
  const resetInactivityTimeout = (): void => {
    if (inactivityTimeout) clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(() => {
      logProcessEvent(
        'timeout',
        {
          ...(claudeProcess.pid && { pid: claudeProcess.pid }),
          command: 'claude',
        },
        {
          timeoutType: 'inactivity',
          inactivityTimeoutMs,
          sessionId: claudeSessionId,
          workspacePath,
        }
      );

      claudeProcess.kill('SIGTERM');
      // Force kill if SIGTERM doesn't work
      const killTimeoutMs = parseInt(process.env.PROCESS_KILL_TIMEOUT_MS || '5000', 10);
      setTimeout(() => {
        if (claudeProcess && !claudeProcess.killed) {
          logProcessEvent(
            'signal',
            {
              ...(claudeProcess.pid && { pid: claudeProcess.pid }),
              command: 'claude',
              signal: 'SIGKILL',
            },
            { reason: 'force_kill_after_inactivity_timeout' }
          );

          claudeProcess.kill('SIGKILL');
        }
      }, killTimeoutMs);
      reply.raw.write(
        `data: ${JSON.stringify({
          type: 'result',
          subtype: 'timeout',
          is_error: true,
          result: `Inactivity timeout (${inactivityTimeoutMs / 60000} minutes since last output)`,
          session_id: claudeSessionId || null,
        })}\n\n`
      );
      reply.raw.end();
    }, inactivityTimeoutMs);
  };
  resetInactivityTimeout();

  claudeProcess.stdout?.on('data', async (data: Buffer) => {
    const dataStr = data.toString();
    requestLogger.debug(
      {
        pid: claudeProcess.pid,
        dataLength: dataStr.length,
        type: 'process_stdout',
      },
      'Received Claude stdout data'
    );

    resetInactivityTimeout();

    const lines = dataStr.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line);

        if (json.type === 'system' && json.subtype === 'init' && json.session_id) {
          requestLogger.info(
            {
              sessionId: json.session_id,
              type: 'session_init',
            },
            'Claude session initialized'
          );
        }

        reply.raw.write(`data: ${line}\n\n`);
      } catch (e) {
        requestLogger.debug(
          {
            line: line.substring(0, 100) + (line.length > 100 ? '...' : ''),
            type: 'non_json_output',
          },
          'Received non-JSON output line'
        );
      }
    }
  });

  claudeProcess.stderr?.on('data', (data: Buffer) => {
    const errorData = data.toString();
    requestLogger.error(
      {
        pid: claudeProcess.pid,
        errorData,
        type: 'process_stderr',
      },
      'Claude process stderr output'
    );
  });

  claudeProcess.on('close', (code: number | null, signal: string | null) => {
    logProcessEvent(
      'exit',
      {
        ...(claudeProcess.pid && { pid: claudeProcess.pid }),
        command: 'claude',
        ...(code !== null && { exitCode: code }),
        ...(signal && { signal }),
      },
      {
        sessionId: claudeSessionId,
        workspacePath,
      }
    );

    clearTimeout(totalTimeout);
    if (inactivityTimeout) clearTimeout(inactivityTimeout);

    // Remove from active processes
    activeProcesses.delete(claudeProcess);

    reply.raw.end();
  });

  claudeProcess.on('error', (error: Error) => {
    logProcessEvent(
      'error',
      {
        ...(claudeProcess.pid && { pid: claudeProcess.pid }),
        command: 'claude',
        error,
      },
      {
        sessionId: claudeSessionId,
        workspacePath,
      }
    );

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
    requestLogger.info(
      {
        pid: claudeProcess.pid,
        type: 'process_disconnect',
      },
      'Claude process disconnected'
    );
    activeProcesses.delete(claudeProcess);
  });

  // Handle process exit
  claudeProcess.on('exit', (code: number | null, signal: string | null) => {
    requestLogger.debug(
      {
        pid: claudeProcess.pid,
        exitCode: code,
        signal,
        type: 'process_exit',
      },
      `Claude process exit with code ${code}, signal ${signal}`
    );
    activeProcesses.delete(claudeProcess);
  });
}
