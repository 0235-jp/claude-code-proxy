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
 */
export async function createWorkspace(workspaceName: string | null = null): Promise<string> {
  const baseWorkspacePath = process.env.WORKSPACE_BASE_PATH || path.join(__dirname, '..');
  let workspacePath: string;

  if (workspaceName) {
    workspacePath = path.join(baseWorkspacePath, 'workspace', workspaceName);
  } else {
    workspacePath = path.join(baseWorkspacePath, 'shared_workspace');
  }

  await fs.mkdir(workspacePath, { recursive: true });
  return workspacePath;
}
