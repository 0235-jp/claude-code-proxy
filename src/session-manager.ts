import { promises as fs } from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

export async function createWorkspace(): Promise<string> {
  const sessionId = uuidv4()
  const workspacePath = path.join(__dirname, '..', 'Workspace', `session-${sessionId}`)
  await fs.mkdir(workspacePath, { recursive: true })
  return workspacePath
}
