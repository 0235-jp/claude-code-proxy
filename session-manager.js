const fs = require('fs').promises
const path = require('path')
const { v4: uuidv4 } = require('uuid')

async function createWorkspace() {
  const sessionId = uuidv4()
  const workspacePath = path.join(__dirname, 'Workspace', `session-${sessionId}`)
  await fs.mkdir(workspacePath, { recursive: true })
  return workspacePath
}

module.exports = { createWorkspace }