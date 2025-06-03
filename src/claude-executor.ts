import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { saveSession, getSession } from './database'
import { createWorkspace } from './session-manager'
import { ClaudeOptions, ClaudeResponse, ClaudeInitResponse } from './types'
import type { FastifyReply } from 'fastify'

function executeClaudeCommand(
  claudeSessionId: string | null,
  workspacePath: string,
  options: ClaudeOptions = {},
): ChildProcessWithoutNullStreams {
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

  return spawn('claude', args, {
    cwd: workspacePath,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  })
}

export async function executeClaudeAndStream(
  prompt: string,
  claudeSessionId: string | null,
  options: ClaudeOptions,
  reply: FastifyReply,
): Promise<void> {
  let workspacePath: string

  if (claudeSessionId) {
    const session = getSession(claudeSessionId)
    if (!session) {
      reply.raw.write(
        `data: ${JSON.stringify({
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: 'Session not found',
          session_id: claudeSessionId || null,
        } as ClaudeResponse)}\n\n`,
      )
      reply.raw.end()
      return
    }
    workspacePath = session.workspace_path
  } else {
    workspacePath = await createWorkspace()
  }

  console.log(`Executing Claude in workspace: ${workspacePath}`)
  console.log(`Options:`, options)

  // Timeout settings: 1 hour total execution time
  const timeoutMs = options.timeout || 3600000 // 1 hour default
  console.log(`Total timeout set to: ${timeoutMs}ms (${timeoutMs / 60000} minutes)`)

  const claudeProcess = executeClaudeCommand(claudeSessionId, workspacePath, options)

  claudeProcess.on('spawn', () => {
    console.log('Claude process spawned successfully')
    claudeProcess.stdin.write(prompt)
    claudeProcess.stdin.end()
  })

  // Total execution time timeout (1 hour)
  const totalTimeout = setTimeout(() => {
    console.log('Claude process total timeout - killing process')
    claudeProcess.kill('SIGTERM')
    reply.raw.write(
      `data: ${JSON.stringify({
        type: 'result',
        subtype: 'timeout',
        is_error: true,
        result: `Total timeout (${timeoutMs / 60000} minutes)`,
        session_id: claudeSessionId || null,
      } as ClaudeResponse)}\n\n`,
    )
    reply.raw.end()
  }, timeoutMs)

  // Inactivity timeout (5 minutes since last output)
  let inactivityTimeout: NodeJS.Timeout | undefined
  const resetInactivityTimeout = (): void => {
    if (inactivityTimeout) clearTimeout(inactivityTimeout)
    inactivityTimeout = setTimeout(() => {
      console.log('Claude process inactivity timeout - killing process')
      claudeProcess.kill('SIGTERM')
      reply.raw.write(
        `data: ${JSON.stringify({
          type: 'result',
          subtype: 'timeout',
          is_error: true,
          result: 'Inactivity timeout (5 minutes since last output)',
          session_id: claudeSessionId || null,
        } as ClaudeResponse)}\n\n`,
      )
      reply.raw.end()
    }, 300000) // 5 minutes
  }
  resetInactivityTimeout()

  claudeProcess.stdout.on('data', async (data: Buffer) => {
    console.log('Claude stdout:', data.toString())
    resetInactivityTimeout() // Reset inactivity timer since we got output

    const lines = data
      .toString()
      .split('\n')
      .filter((line) => line.trim())

    for (const line of lines) {
      try {
        const json = JSON.parse(line)

        if (json.type === 'system' && json.subtype === 'init' && json.session_id) {
          const initResponse = json as ClaudeInitResponse
          if (claudeSessionId) {
            console.log('Updating session after resume:', claudeSessionId, '->', initResponse.session_id)
          } else {
            console.log('Saving new session:', initResponse.session_id, workspacePath)
          }
          saveSession(initResponse.session_id, workspacePath)
        }

        reply.raw.write(`data: ${line}\n\n`)
        if ('flush' in reply.raw && typeof reply.raw.flush === 'function') {
          reply.raw.flush()
        }
      } catch (_e) {
        console.log('Non-JSON line:', line)
      }
    }
  })

  claudeProcess.stderr.on('data', (data: Buffer) => {
    console.error('Claude stderr:', data.toString())
  })

  claudeProcess.on('close', (code: number | null) => {
    console.log(`Claude process exited with code ${code}`)
    clearTimeout(totalTimeout)
    if (inactivityTimeout) clearTimeout(inactivityTimeout)
    reply.raw.end()
  })

  claudeProcess.on('error', (error: Error) => {
    console.error('Claude process error:', error)
    clearTimeout(totalTimeout)
    if (inactivityTimeout) clearTimeout(inactivityTimeout)
    reply.raw.write(
      `data: ${JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        result: error.message,
        session_id: claudeSessionId || null,
      } as ClaudeResponse)}\n\n`,
    )
    reply.raw.end()
  })
}
