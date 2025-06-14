/**
 * Health check utilities for server monitoring
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getMcpConfig, isMcpEnabled } from './mcp-manager';

/**
 * Health check result interface
 */
export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Overall health status interface
 */
export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    claudeCli: HealthCheckResult;
    workspace: HealthCheckResult;
    mcpConfig: HealthCheckResult;
  };
}

/**
 * Check if Claude CLI is available and working
 */
export async function checkClaudeCli(): Promise<HealthCheckResult> {
  const timestamp = new Date().toISOString();

  try {
    return new Promise(resolve => {
      const claudeProcess = spawn('claude', ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      });

      let stdout = '';
      let stderr = '';

      claudeProcess.stdout?.on('data', data => {
        stdout += data.toString();
      });

      claudeProcess.stderr?.on('data', data => {
        stderr += data.toString();
      });

      claudeProcess.on('close', code => {
        if (code === 0) {
          resolve({
            status: 'healthy',
            message: 'Claude CLI is available and responsive',
            details: {
              version: stdout.trim(),
              exitCode: code,
            },
            timestamp,
          });
        } else {
          resolve({
            status: 'unhealthy',
            message: 'Claude CLI returned non-zero exit code',
            details: {
              exitCode: code,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            },
            timestamp,
          });
        }
      });

      claudeProcess.on('error', error => {
        resolve({
          status: 'unhealthy',
          message: 'Claude CLI is not available or not working',
          details: {
            error: error.message,
            name: error.name,
          },
          timestamp,
        });
      });

      // Handle timeout
      setTimeout(() => {
        if (!claudeProcess.killed) {
          claudeProcess.kill('SIGTERM');
          resolve({
            status: 'unhealthy',
            message: 'Claude CLI check timed out',
            details: {
              timeout: '5000ms',
            },
            timestamp,
          });
        }
      }, 5000);
    });
  } catch (error) {
    return {
      status: 'unhealthy',
      message: 'Failed to check Claude CLI',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      timestamp,
    };
  }
}

/**
 * Check workspace directory accessibility
 */
export async function checkWorkspace(): Promise<HealthCheckResult> {
  const timestamp = new Date().toISOString();
  const baseWorkspacePath = process.env.WORKSPACE_BASE_PATH || path.join(__dirname, '..');

  try {
    // Check if base workspace path exists and is accessible
    const stats = await fs.stat(baseWorkspacePath);

    if (!stats.isDirectory()) {
      return {
        status: 'unhealthy',
        message: 'Workspace base path is not a directory',
        details: {
          path: baseWorkspacePath,
          type: 'file',
        },
        timestamp,
      };
    }

    // Try to create a test directory to verify write permissions
    const testDir = path.join(baseWorkspacePath, '.health-check-test');
    try {
      await fs.mkdir(testDir, { recursive: true });
      await fs.rmdir(testDir);

      return {
        status: 'healthy',
        message: 'Workspace directory is accessible and writable',
        details: {
          path: baseWorkspacePath,
          readable: true,
          writable: true,
        },
        timestamp,
      };
    } catch (writeError) {
      return {
        status: 'degraded',
        message: 'Workspace directory is readable but not writable',
        details: {
          path: baseWorkspacePath,
          readable: true,
          writable: false,
          writeError: writeError instanceof Error ? writeError.message : 'Unknown error',
        },
        timestamp,
      };
    }
  } catch (error) {
    return {
      status: 'unhealthy',
      message: 'Workspace directory is not accessible',
      details: {
        path: baseWorkspacePath,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      timestamp,
    };
  }
}

/**
 * Check MCP configuration status
 */
export async function checkMcpConfig(): Promise<HealthCheckResult> {
  const timestamp = new Date().toISOString();

  try {
    if (!isMcpEnabled()) {
      return {
        status: 'healthy',
        message: 'MCP is disabled (no configuration file found)',
        details: {
          enabled: false,
          configPath: process.env.MCP_CONFIG_PATH || path.join(__dirname, '..', 'mcp-config.json'),
        },
        timestamp,
      };
    }

    const mcpConfig = getMcpConfig();
    const serverCount = mcpConfig ? Object.keys(mcpConfig.mcpServers || {}).length : 0;

    if (serverCount === 0) {
      return {
        status: 'degraded',
        message: 'MCP is enabled but no servers configured',
        details: {
          enabled: true,
          serverCount: 0,
          configPath: process.env.MCP_CONFIG_PATH || path.join(__dirname, '..', 'mcp-config.json'),
        },
        timestamp,
      };
    }

    return {
      status: 'healthy',
      message: 'MCP configuration is valid and servers are configured',
      details: {
        enabled: true,
        serverCount,
        servers: Object.keys(mcpConfig?.mcpServers || {}),
        configPath: process.env.MCP_CONFIG_PATH || path.join(__dirname, '..', 'mcp-config.json'),
      },
      timestamp,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: 'MCP configuration is invalid or corrupted',
      details: {
        enabled: true,
        error: error instanceof Error ? error.message : 'Unknown error',
        configPath: process.env.MCP_CONFIG_PATH || path.join(__dirname, '..', 'mcp-config.json'),
      },
      timestamp,
    };
  }
}

/**
 * Get process uptime in seconds
 */
export function getUptime(): number {
  return process.uptime();
}

/**
 * Get application version from package.json
 */
export async function getVersion(): Promise<string> {
  try {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Perform comprehensive health check
 */
export async function performHealthCheck(): Promise<HealthStatus> {
  const timestamp = new Date().toISOString();

  // Run all checks in parallel
  const [claudeCli, workspace, mcpConfig, version] = await Promise.all([
    checkClaudeCli(),
    checkWorkspace(),
    checkMcpConfig(),
    getVersion(),
  ]);

  // Determine overall status
  const checks = { claudeCli, workspace, mcpConfig };
  const statuses = Object.values(checks).map(check => check.status);

  let overallStatus: 'healthy' | 'unhealthy' | 'degraded';
  if (statuses.includes('unhealthy')) {
    overallStatus = 'unhealthy';
  } else if (statuses.includes('degraded')) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'healthy';
  }

  return {
    status: overallStatus,
    timestamp,
    uptime: getUptime(),
    version,
    checks,
  };
}
