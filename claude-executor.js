const { spawn } = require('child_process')
const { createWorkspace } = require('./session-manager')
const { isMcpEnabled, validateMcpTools, getMcpConfig } = require('./mcp-manager')
const path = require('path')

function executeClaudeCommand(prompt, claudeSessionId, workspacePath, options = {}) {
  const args = ['-p', '--verbose', '--output-format', 'stream-json']

  if (claudeSessionId) {
    args.push('--resume', claudeSessionId)
  }

  if (options.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  if (options.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt)
  }

  // Collect all allowed tools (regular + MCP)
  let allAllowedTools = []
  if (options.allowedTools && options.allowedTools.length > 0) {
    allAllowedTools = [...options.allowedTools]
  }
  
  // Add MCP configuration if enabled and tools are requested
  if (isMcpEnabled() && options.mcpAllowedTools && options.mcpAllowedTools.length > 0) {
    const validMcpTools = validateMcpTools(options.mcpAllowedTools)
    if (validMcpTools.length > 0) {
      const mcpConfigPath = path.join(__dirname, 'mcp-config.json')
      args.push('--mcp-config', mcpConfigPath)
      allAllowedTools = [...allAllowedTools, ...validMcpTools]
      console.log('MCP enabled with tools:', validMcpTools)
    }
  }
  
  // Add combined allowed tools if any
  if (allAllowedTools.length > 0) {
    args.push('--allowedTools', allAllowedTools.join(','))
  }

  if (options.disallowedTools && options.disallowedTools.length > 0) {
    args.push('--disallowedTools', options.disallowedTools.join(','))
  }

  return spawn('claude', args, {
    cwd: workspacePath,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  })
}

async function executeClaudeAndStream(prompt, claudeSessionId, options, reply) {
  let workspacePath
  
  if (options.workspace) {
    workspacePath = await createWorkspace(options.workspace)
  } else if (claudeSessionId) {
    workspacePath = await createWorkspace()
  } else {
    workspacePath = await createWorkspace()
  }

  console.log(`Executing Claude in workspace: ${workspacePath}`)
  console.log(`Options:`, options)
  
  // Log MCP status
  if (isMcpEnabled()) {
    const mcpConfig = getMcpConfig()
    const serverCount = Object.keys(mcpConfig.mcpServers || {}).length
    console.log(`MCP enabled with ${serverCount} server(s) configured`)
    if (options.mcpAllowedTools && options.mcpAllowedTools.length > 0) {
      console.log(`MCP tools requested:`, options.mcpAllowedTools)
    }
  } else {
    console.log('MCP not enabled (no mcp-config.json found)')
  }

  const timeoutMs = options.timeout || 3600000
  console.log(`Total timeout set to: ${timeoutMs}ms (${timeoutMs/60000} minutes)`)

  const claudeProcess = executeClaudeCommand(prompt, claudeSessionId, workspacePath, options)

  claudeProcess.on('spawn', () => {
    console.log('Claude process spawned successfully')
    claudeProcess.stdin.write(prompt)
    claudeProcess.stdin.end()
  })

  const totalTimeout = setTimeout(() => {
    console.log('Claude process total timeout - killing process')
    claudeProcess.kill('SIGTERM')
    reply.raw.write(`data: ${JSON.stringify({
      type: "result",
      subtype: "timeout",
      is_error: true,
      result: `Total timeout (${timeoutMs/60000} minutes)`,
      session_id: claudeSessionId || null
    })}\n\n`)
    reply.raw.end()
  }, timeoutMs)

  let inactivityTimeout
  const resetInactivityTimeout = () => {
    if (inactivityTimeout) clearTimeout(inactivityTimeout)
    inactivityTimeout = setTimeout(() => {
      console.log('Claude process inactivity timeout - killing process')
      claudeProcess.kill('SIGTERM')
      reply.raw.write(`data: ${JSON.stringify({
        type: "result",
        subtype: "timeout",
        is_error: true,
        result: "Inactivity timeout (5 minutes since last output)",
        session_id: claudeSessionId || null
      })}\n\n`)
      reply.raw.end()
    }, 300000)
  }
  resetInactivityTimeout()

  claudeProcess.stdout.on('data', async (data) => {
    console.log('Claude stdout:', data.toString())
    resetInactivityTimeout()
    
    const lines = data.toString().split('\n').filter(line => line.trim())

    for (const line of lines) {
      try {
        const json = JSON.parse(line)

        if (json.type === 'system' && json.subtype === 'init' && json.session_id) {
          console.log('Session initialized:', json.session_id)
        }

        reply.raw.write(`data: ${line}\n\n`)
        reply.raw.flush && reply.raw.flush()
      } catch (e) {
        console.log('Non-JSON line:', line)
      }
    }
  })

  claudeProcess.stderr.on('data', (data) => {
    console.error('Claude stderr:', data.toString())
  })

  claudeProcess.on('close', (code) => {
    console.log(`Claude process exited with code ${code}`)
    clearTimeout(totalTimeout)
    if (inactivityTimeout) clearTimeout(inactivityTimeout)
    reply.raw.end()
  })

  claudeProcess.on('error', (error) => {
    console.error('Claude process error:', error)
    clearTimeout(totalTimeout)
    if (inactivityTimeout) clearTimeout(inactivityTimeout)
    reply.raw.write(`data: ${JSON.stringify({
      type: "result",
      subtype: "error",
      is_error: true,
      result: error.message,
      session_id: claudeSessionId || null
    })}\n\n`)
    reply.raw.end()
  })
}

module.exports = { executeClaudeAndStream }