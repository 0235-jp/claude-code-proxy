const { spawn } = require('child_process')
const { saveSession, getSession } = require('./database')
const { createWorkspace } = require('./session-manager')

function executeClaudeCommand(query, claudeSessionId, workspacePath, options = {}) {
  const args = ['-p', '--verbose', '--output-format', 'stream-json']

  if (claudeSessionId) {
    args.push('--resume', claudeSessionId)
  }

  if (options.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push('--allowedTools', options.allowedTools.join(','))
  }

  if (options.disallowedTools && options.disallowedTools.length > 0) {
    args.push('--disallowedTools', options.disallowedTools.join(','))
  }

  args.push(query)

  return spawn('/home/kohei/.npm-global/bin/claude', args, {
    cwd: workspacePath,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  })
}

async function executeClaudeAndStream(query, claudeSessionId, options, reply) {
  let workspacePath

  if (claudeSessionId) {
    const session = getSession(claudeSessionId)
    if (!session) {
      reply.raw.write(`data: ${JSON.stringify({type: "error", error: "Session not found"})}\n\n`)
      reply.raw.end()
      return
    }
    workspacePath = session.workspace_path
  } else {
    workspacePath = await createWorkspace()
  }

  console.log(`Executing Claude in workspace: ${workspacePath}`)
  console.log(`Options:`, options)

  const claudeProcess = executeClaudeCommand(query, claudeSessionId, workspacePath, options)

  claudeProcess.on('spawn', () => {
    console.log('Claude process spawned successfully')
    claudeProcess.stdin.end()
  })

  // 30秒タイムアウト
  const timeout = setTimeout(() => {
    console.log('Claude process timeout - killing process')
    claudeProcess.kill('SIGTERM')
    reply.raw.write(`data: ${JSON.stringify({type: "error", error: "Process timeout"})}\n\n`)
    reply.raw.end()
  }, 30000)

  claudeProcess.stdout.on('data', async (data) => {
    console.log('Claude stdout:', data.toString())
    const lines = data.toString().split('\n').filter(line => line.trim())

    for (const line of lines) {
      try {
        const json = JSON.parse(line)

        if (json.type === 'system' && json.subtype === 'init' && json.session_id) {
          if (claudeSessionId) {
            console.log('Updating session after resume:', claudeSessionId, '->', json.session_id)
          } else {
            console.log('Saving new session:', json.session_id, workspacePath)
          }
          saveSession(json.session_id, workspacePath)
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
    clearTimeout(timeout)
    reply.raw.end()
  })

  claudeProcess.on('error', (error) => {
    console.error('Claude process error:', error)
    clearTimeout(timeout)
    reply.raw.write(`data: ${JSON.stringify({type: "error", error: error.message})}\n\n`)
    reply.raw.end()
  })
}

module.exports = { executeClaudeAndStream }