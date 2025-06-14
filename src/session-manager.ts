/**
 * Workspace management for Claude sessions
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import 'dotenv/config';

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

  try {
    await fs.mkdir(workspacePath, { recursive: true });
    return workspacePath;
  } catch (error: unknown) {
    // Handle specific filesystem errors
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === 'EEXIST') {
      // Directory already exists - this is actually fine with recursive: true
      // but we'll handle it explicitly for clarity
      return workspacePath;
    } else if (fsError.code === 'EACCES') {
      // Permission denied
      throw new Error(
        `Permission denied: Cannot create workspace directory at ${workspacePath}. Check filesystem permissions.`
      );
    } else if (fsError.code === 'ENOTDIR') {
      // Parent is not a directory
      throw new Error(`Invalid path: Parent of ${workspacePath} is not a directory.`);
    } else if (fsError.code === 'ENOSPC') {
      // No space left on device
      throw new Error(
        `Insufficient disk space: Cannot create workspace directory at ${workspacePath}.`
      );
    } else {
      // Other filesystem errors
      throw new Error(
        `Failed to create workspace directory at ${workspacePath}: ${fsError.message || 'Unknown error'}`
      );
    }
  }
}
