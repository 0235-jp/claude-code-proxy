import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import { executeClaudeAndStream } from './claude-executor'
import { ClaudeOptions } from './types'

interface ClaudeRequestBody {
  prompt: string
  session_id?: string
  'dangerously-skip-permissions'?: boolean
  allowedTools?: string[]
  disallowedTools?: string[]
}

interface OpenAIMessage {
  role: string
  content: string
}

interface OpenAIRequestBody {
  model?: string
  messages: OpenAIMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

interface OpenAIChunk {
  id: string
  object: string
  created: number
  model: string
  system_fingerprint: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string
    }
    logprobs: null
    finish_reason: string | null
  }>
}

const server: FastifyInstance = fastify({ logger: true })

async function startServer(): Promise<void> {
  await server.register(cors)

  server.post<{ Body: ClaudeRequestBody }>(
    '/api/claude',
    {
      schema: {
        body: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
            session_id: { type: 'string' },
            'dangerously-skip-permissions': { type: 'boolean' },
            allowedTools: { type: 'array', items: { type: 'string' } },
            disallowedTools: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ClaudeRequestBody }>, reply: FastifyReply) => {
      const { prompt, session_id, allowedTools, disallowedTools } = request.body
      const dangerouslySkipPermissions = request.body['dangerously-skip-permissions']

      // Log incoming request details
      console.log('=== Claude API Request ===')
      console.log('Prompt:', prompt)
      console.log('Session ID:', session_id || 'new session')
      console.log('Dangerously skip permissions:', dangerouslySkipPermissions || false)
      console.log('Allowed tools:', allowedTools || 'none specified')
      console.log('Disallowed tools:', disallowedTools || 'none specified')
      console.log('==========================')

      reply
        .type('text/event-stream')
        .header('Cache-Control', 'no-cache')
        .header('Connection', 'keep-alive')
        .header('Access-Control-Allow-Origin', '*')

      reply.hijack()

      const options: ClaudeOptions = {
        dangerouslySkipPermissions,
        allowedTools,
        disallowedTools,
      }

      await executeClaudeAndStream(prompt, session_id || null, options, reply)
    },
  )

  // OpenAI Chat API compatible endpoint
  server.post<{ Body: OpenAIRequestBody }>(
    '/v1/chat/completions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['messages'],
          properties: {
            model: { type: 'string' },
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
            stream: { type: 'boolean' },
            temperature: { type: 'number' },
            max_tokens: { type: 'number' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: OpenAIRequestBody }>, reply: FastifyReply) => {
      const { messages, stream = true } = request.body

      if (!stream) {
        reply.code(400).send({ error: 'Only streaming is supported' })
        return
      }

      // Get the latest user message
      const userMessage = messages[messages.length - 1]?.content || ''

      // Extract session_id from previous assistant messages
      let session_id: string | null = null
      let prev_dangerously_skip_permissions: boolean | null = null
      let prev_allowedTools: string[] | null = null
      let prev_disallowedTools: string[] | null = null

      for (let i = messages.length - 2; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          const content = messages[i].content || ''

          const sessionMatch = content.match(/session_id=([a-f0-9-]+)/)
          if (sessionMatch) session_id = sessionMatch[1]

          const dangerMatch = content.match(/dangerously-skip-permissions=(\w+)/)
          if (dangerMatch) prev_dangerously_skip_permissions = dangerMatch[1].toLowerCase() === 'true'

          const allowedMatch = content.match(/allowedTools=\[([^\]]+)\]/)
          if (allowedMatch) {
            prev_allowedTools = allowedMatch[1].split(',').map((tool) => tool.trim().replace(/['"]/g, ''))
          }

          const disallowedMatch = content.match(/disallowedTools=\[([^\]]+)\]/)
          if (disallowedMatch) {
            prev_disallowedTools = disallowedMatch[1].split(',').map((tool) => tool.trim().replace(/['"]/g, ''))
          }
          break
        }
      }

      // Parse current message settings
      const dangerMatch = userMessage.match(/dangerously-skip-permissions=(\w+)/)
      const dangerouslySkipPermissions = dangerMatch
        ? dangerMatch[1].toLowerCase() === 'true'
        : prev_dangerously_skip_permissions

      const allowedMatch = userMessage.match(/allowedTools=\[([^\]]+)\]/)
      const allowedTools = allowedMatch
        ? allowedMatch[1].split(',').map((tool) => tool.trim().replace(/['"]/g, ''))
        : prev_allowedTools

      const disallowedMatch = userMessage.match(/disallowedTools=\[([^\]]+)\]/)
      const disallowedTools = disallowedMatch
        ? disallowedMatch[1].split(',').map((tool) => tool.trim().replace(/['"]/g, ''))
        : prev_disallowedTools

      // Extract prompt
      const promptMatch = userMessage.match(/prompt="([^"]+)"/)
      let prompt: string
      if (promptMatch) {
        prompt = promptMatch[1]
      } else {
        // Remove settings from message
        prompt = userMessage
          .replace(
            /(dangerously-skip-permissions=\w+|allowedTools=\[[^\]]+\]|disallowedTools=\[[^\]]+\]|prompt="[^"]+"|prompt=)(\s*)/g,
            '',
          )
          .trim()
        if (!prompt) prompt = userMessage
      }

      console.log('=== OpenAI Chat API Request ===')
      console.log('Prompt:', prompt)
      console.log('Session ID:', session_id || 'new session')
      console.log('================================')

      reply.hijack()

      // Manually write headers after hijacking
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      // Create a custom stream handler for OpenAI format
      const originalWrite = reply.raw.write.bind(reply.raw)
      const originalEnd = reply.raw.end.bind(reply.raw)

      let inThinking = false
      let sessionPrinted = false
      const messageId = 'chatcmpl-' + Date.now()
      const systemFingerprint = 'fp_' + Date.now().toString(36)

      // Helper function to split text into chunks
      function splitIntoChunks(text: string, chunkSize = 100): string[] {
        const chunks: string[] = []
        for (let i = 0; i < text.length; i += chunkSize) {
          chunks.push(text.slice(i, i + chunkSize))
        }
        return chunks
      }

      // Helper function to send a chunk
      function sendChunk(content: string, finishReason: string | null = null): void {
        const chunk: OpenAIChunk = {
          id: messageId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'claude-code',
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: { content: content },
              logprobs: null,
              finish_reason: finishReason,
            },
          ],
        }
        originalWrite(`data: ${JSON.stringify(chunk)}\n\n`)
      }

      reply.raw.write = function (chunk: any): boolean {
        if (chunk.toString().startsWith('data: ')) {
          try {
            const jsonStr = chunk.toString().replace('data: ', '').trim()
            if (!jsonStr) return true

            const jsonData = JSON.parse(jsonStr)

            if (jsonData.type === 'system' && jsonData.subtype === 'init') {
              const sessionId = jsonData.session_id
              if (sessionId && !sessionPrinted) {
                sessionPrinted = true

                // Build session info content
                let sessionInfo = `session_id=${sessionId}\n`
                if (dangerouslySkipPermissions !== null) {
                  sessionInfo += `dangerously-skip-permissions=${dangerouslySkipPermissions}\n`
                }
                if (allowedTools) {
                  const toolsStr = allowedTools.map((tool) => `"${tool}"`).join(',')
                  sessionInfo += `allowedTools=[${toolsStr}]\n`
                }
                if (disallowedTools) {
                  const toolsStr = disallowedTools.map((tool) => `"${tool}"`).join(',')
                  sessionInfo += `disallowedTools=[${toolsStr}]\n`
                }
                sessionInfo += '<thinking>\n'
                inThinking = true

                // Send initial chunk with role
                const roleChunk: OpenAIChunk = {
                  id: messageId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: 'claude-code',
                  system_fingerprint: systemFingerprint,
                  choices: [
                    {
                      index: 0,
                      delta: { role: 'assistant' },
                      logprobs: null,
                      finish_reason: null,
                    },
                  ],
                }
                originalWrite(`data: ${JSON.stringify(roleChunk)}\n\n`)

                // Send session info in chunks (only once)
                const chunks = splitIntoChunks(sessionInfo)
                for (const chunk of chunks) {
                  sendChunk(chunk)
                }
              }
            } else if (jsonData.type === 'assistant') {
              const message = jsonData.message || {}
              const content = message.content || []
              const stopReason = message.stop_reason
              const isFinalResponse = stopReason === 'end_turn'

              for (const item of content) {
                if (item.type === 'text') {
                  // Close thinking when text content arrives
                  if (inThinking) {
                    sendChunk('\n</thinking>\n')
                    inThinking = false
                  }

                  const textContent = item.text || ''
                  const fullText = `\n${textContent}`
                  const chunks = splitIntoChunks(fullText)
                  for (let i = 0; i < chunks.length; i++) {
                    sendChunk(chunks[i], i === chunks.length - 1 && isFinalResponse ? 'stop' : null)
                  }
                } else if (item.type === 'thinking') {
                  // Reopen thinking if it was closed by text
                  if (!inThinking) {
                    sendChunk('\n<thinking>\n')
                    inThinking = true
                  }

                  // Thinking content stays within thinking tags
                  const thinkingContent = item.thinking || ''
                  const fullText = `\n🤖< ${thinkingContent}`
                  const chunks = splitIntoChunks(fullText)
                  for (const chunk of chunks) {
                    sendChunk(chunk)
                  }
                } else if (item.type === 'tool_use') {
                  // Reopen thinking if it was closed by text
                  if (!inThinking) {
                    sendChunk('\n<thinking>\n')
                    inThinking = true
                  }

                  // Tool use stays within thinking tags
                  const toolName = item.name || 'Unknown'
                  const toolInput = JSON.stringify(item.input || {})
                  const fullText = `\n🔧 Using ${toolName}: ${toolInput}\n`
                  const chunks = splitIntoChunks(fullText)
                  for (const chunk of chunks) {
                    sendChunk(chunk)
                  }
                }
              }

              // Close thinking if still open at end of final response
              if (isFinalResponse && inThinking) {
                sendChunk('\n</thinking>\n')
                inThinking = false
              }

              // Send empty delta with finish_reason for final response (if text didn't already send it)
              if (isFinalResponse && content.every((item: any) => item.type !== 'text')) {
                const finalChunk: OpenAIChunk = {
                  id: messageId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: 'claude-code',
                  system_fingerprint: systemFingerprint,
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      logprobs: null,
                      finish_reason: 'stop',
                    },
                  ],
                }
                originalWrite(`data: ${JSON.stringify(finalChunk)}\n\n`)
              }
            } else if (jsonData.type === 'user') {
              const message = jsonData.message || {}
              const content = message.content || []

              for (const item of content) {
                if (item.type === 'tool_result') {
                  const toolContent = item.content || ''
                  const isError = item.is_error || false

                  const prefix = isError ? '\n❌ Tool Error: ' : '\n✅ Tool Result: '
                  const fullText = prefix + toolContent + '\n'
                  const chunks = splitIntoChunks(fullText)
                  for (const chunk of chunks) {
                    sendChunk(chunk)
                  }
                }
              }
            } else if (jsonData.type === 'error') {
              if (inThinking) {
                sendChunk('\n</thinking>\n')
              }

              const errorMessage =
                typeof jsonData.error === 'string'
                  ? jsonData.error
                  : jsonData.error?.message || JSON.stringify(jsonData.error) || 'Unknown error'

              const fullText = `⚠️ ${errorMessage}\n`
              const chunks = splitIntoChunks(fullText)
              for (let i = 0; i < chunks.length; i++) {
                sendChunk(chunks[i], i === chunks.length - 1 ? 'stop' : null)
              }
            }
          } catch (e: any) {
            console.error('Error processing chunk:', e)
            // Send error to client in proper format
            const errorText = `\n⚠️ Stream processing error: ${e.message}\n`
            const chunks = splitIntoChunks(errorText)
            for (let i = 0; i < chunks.length; i++) {
              sendChunk(chunks[i], i === chunks.length - 1 ? 'stop' : null)
            }
          }
        }
        return true
      }

      reply.raw.end = function (cb?: () => void) {
        originalWrite('data: [DONE]\n\n')
        return originalEnd(cb)
      }

      const options: ClaudeOptions = {
        dangerouslySkipPermissions: dangerouslySkipPermissions || undefined,
        allowedTools: allowedTools || undefined,
        disallowedTools: disallowedTools || undefined,
      }

      await executeClaudeAndStream(prompt, session_id, options, reply)
    },
  )

  try {
    await server.listen({ port: 3000, host: '0.0.0.0' })
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

void startServer()
