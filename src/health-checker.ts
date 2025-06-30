/**
 * Health check utilities for server monitoring
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { healthLogger, logHealthCheck } from './logger';

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

  healthLogger.debug(
    {
      type: 'health_check_start',
    },
    'Starting comprehensive health check'
  );

  // Run all checks in parallel
  const [claudeCli, workspace, version] = await Promise.all([
    checkClaudeCli(),
    checkWorkspace(),
    getVersion(),
  ]);

  // Log individual check results
  logHealthCheck('claude-cli', claudeCli.status, {
    message: claudeCli.message,
    details: claudeCli.details,
  });

  logHealthCheck('workspace', workspace.status, {
    message: workspace.message,
    details: workspace.details,
  });


  // Determine overall status
  const checks = { claudeCli, workspace };
  const statuses = Object.values(checks).map(check => check.status);

  let overallStatus: 'healthy' | 'unhealthy' | 'degraded';
  if (statuses.includes('unhealthy')) {
    overallStatus = 'unhealthy';
  } else if (statuses.includes('degraded')) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'healthy';
  }

  // Log overall health status
  healthLogger.info(
    {
      overallStatus,
      checkResults: {
        claudeCli: claudeCli.status,
        workspace: workspace.status,
      },
      uptime: getUptime(),
      version,
      type: 'health_check_complete',
    },
    `Health check completed with status: ${overallStatus}`
  );

  return {
    status: overallStatus,
    timestamp,
    uptime: getUptime(),
    version,
    checks,
  };
}
