/**
 * Workspace management for Claude sessions
 */

import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Create workspace directory for Claude session
 * @param workspaceName - Custom workspace name or null for shared workspace
 * @returns Path to created workspace directory
 */
export async function createWorkspace(workspaceName: string | null = null): Promise<string> {
  let workspacePath: string;
  
  if (workspaceName) {
    workspacePath = path.join(__dirname, '..', 'workspace', workspaceName);
  } else {
    workspacePath = path.join(__dirname, '..', 'shared_workspace');
  }
  
  await fs.mkdir(workspacePath, { recursive: true });
  return workspacePath;
}