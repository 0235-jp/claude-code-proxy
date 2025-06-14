/**
 * Workspace management for Claude sessions
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import 'dotenv/config';
import { sessionLogger } from './logger';

/**
 * Create workspace directory for Claude session
 * @param workspaceName - Custom workspace name or null for shared workspace
 * @returns Path to created workspace directory
 * @throws Error when workspace creation fails due to permissions or other filesystem issues
 */
export async function createWorkspace(workspaceName: string | null = null): Promise<string> {
  const baseWorkspacePath = process.env.WORKSPACE_BASE_PATH || path.join(__dirname, '..');
  let workspacePath: string;

  if (workspaceName) {
    workspacePath = path.join(baseWorkspacePath, 'workspace', workspaceName);
  } else {
    workspacePath = path.join(baseWorkspacePath, 'shared_workspace');
  }

  sessionLogger.debug(
    {
      workspaceName: workspaceName || 'shared',
      workspacePath,
      baseWorkspacePath,
      type: 'workspace_creation_start',
    },
    `Creating workspace: ${workspaceName || 'shared'}`
  );

  try {
    await fs.mkdir(workspacePath, { recursive: true });

    sessionLogger.info(
      {
        workspaceName: workspaceName || 'shared',
        workspacePath,
        type: 'workspace_created',
      },
      `Workspace created successfully: ${workspacePath}`
    );

    return workspacePath;
  } catch (error: unknown) {
    // Handle specific filesystem errors
    const fsError = error as NodeJS.ErrnoException;

    const errorContext = {
      workspaceName: workspaceName || 'shared',
      workspacePath,
      errorCode: fsError.code,
      errorMessage: fsError.message,
      type: 'workspace_creation_error',
    };

    if (fsError.code === 'EEXIST') {
      // Directory already exists - this is actually fine with recursive: true
      // but we'll handle it explicitly for clarity
      sessionLogger.debug(
        {
          ...errorContext,
          type: 'workspace_already_exists',
        },
        `Workspace already exists: ${workspacePath}`
      );
      return workspacePath;
    } else if (fsError.code === 'EACCES') {
      // Permission denied
      sessionLogger.error(
        {
          ...errorContext,
          type: 'workspace_permission_denied',
        },
        'Permission denied creating workspace directory'
      );
      throw new Error(
        `Permission denied: Cannot create workspace directory at ${workspacePath}. Check filesystem permissions.`
      );
    } else if (fsError.code === 'ENOTDIR') {
      // Parent is not a directory
      sessionLogger.error(
        {
          ...errorContext,
          type: 'workspace_invalid_parent',
        },
        'Invalid parent directory for workspace'
      );
      throw new Error(`Invalid path: Parent of ${workspacePath} is not a directory.`);
    } else if (fsError.code === 'ENOSPC') {
      // No space left on device
      sessionLogger.error(
        {
          ...errorContext,
          type: 'workspace_no_space',
        },
        'Insufficient disk space for workspace creation'
      );
      throw new Error(
        `Insufficient disk space: Cannot create workspace directory at ${workspacePath}.`
      );
    } else {
      // Other filesystem errors
      sessionLogger.error(
        {
          ...errorContext,
          error: fsError,
          type: 'workspace_unknown_error',
        },
        'Unknown error creating workspace directory'
      );
      throw new Error(
        `Failed to create workspace directory at ${workspacePath}: ${fsError.message || 'Unknown error'}`
      );
    }
  }
}
