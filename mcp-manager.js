const fs = require('fs').promises
const path = require('path')

let mcpConfig = null

async function loadMcpConfig() {
  try {
    const configPath = path.join(__dirname, 'mcp-config.json')
    const configData = await fs.readFile(configPath, 'utf8')
    mcpConfig = JSON.parse(configData)
    console.log('MCP configuration loaded successfully')
    return mcpConfig
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No mcp-config.json found, MCP features disabled')
    } else {
      console.error('Error loading MCP configuration:', error.message)
    }
    mcpConfig = null
    return null
  }
}

function getMcpConfig() {
  return mcpConfig
}

function isMcpEnabled() {
  return mcpConfig !== null && mcpConfig.mcpServers && Object.keys(mcpConfig.mcpServers).length > 0
}

function validateMcpTools(requestedTools) {
  if (!isMcpEnabled() || !requestedTools || !Array.isArray(requestedTools)) {
    return []
  }
  
  return requestedTools.filter(tool => {
    if (typeof tool !== 'string') return false
    if (!tool.startsWith('mcp__')) return false
    return true
  })
}

module.exports = {
  loadMcpConfig,
  getMcpConfig,
  isMcpEnabled,
  validateMcpTools
}