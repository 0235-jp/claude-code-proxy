const fs = require('fs').promises
const path = require('path')

async function createWorkspace(workspaceName = null) {
  let workspacePath
  
  if (workspaceName) {
    workspacePath = path.join(__dirname, 'workspace', workspaceName)
  } else {
    workspacePath = path.join(__dirname, 'shared_workspace')
  }
  
  await fs.mkdir(workspacePath, { recursive: true })
  return workspacePath
}

module.exports = { createWorkspace }