const fastify = require('fastify')({ logger: true })
const { executeClaudeAndStream } = require('./claude-executor')

async function startServer() {
  await fastify.register(require('@fastify/cors'))

  fastify.post('/api/claude', {
    schema: {
      body: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string' },
          session_id: { type: 'string' },
          'dangerously-skip-permissions': { type: 'boolean' },
          allowedTools: { type: 'array', items: { type: 'string' } },
          disallowedTools: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
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

    reply.type('text/event-stream')
      .header('Cache-Control', 'no-cache')
      .header('Connection', 'keep-alive')
      .header('Access-Control-Allow-Origin', '*')

    reply.hijack()
    
    await executeClaudeAndStream(prompt, session_id, { dangerouslySkipPermissions, allowedTools, disallowedTools }, reply)
  })

  // OpenAI Chat API compatible endpoint
  fastify.post('/v1/chat/completions', {
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
                content: { type: 'string' }
              }
            }
          },
          stream: { type: 'boolean' },
          temperature: { type: 'number' },
          max_tokens: { type: 'number' }
        }
      }
    }
  }, async (request, reply) => {
    const { messages, stream = true } = request.body
    
    if (!stream) {
      reply.code(400).send({ error: 'Only streaming is supported' })
      return
    }

    // Get the latest user message
    const userMessage = messages[messages.length - 1]?.content || ''
    
    // Extract session_id from previous assistant messages
    let session_id = null
    let prev_dangerously_skip_permissions = null
    let prev_allowedTools = null
    let prev_disallowedTools = null
    
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const content = messages[i].content || ''
        
        const sessionMatch = content.match(/session_id=([a-f0-9-]+)/)
        if (sessionMatch) session_id = sessionMatch[1]
        
        const dangerMatch = content.match(/dangerously-skip-permissions=(\w+)/)
        if (dangerMatch) prev_dangerously_skip_permissions = dangerMatch[1].toLowerCase() === 'true'
        
        const allowedMatch = content.match(/allowedTools=\[([^\]]+)\]/)
        if (allowedMatch) {
          prev_allowedTools = allowedMatch[1].split(',').map(tool => tool.trim().replace(/['"]/g, ''))
        }
        
        const disallowedMatch = content.match(/disallowedTools=\[([^\]]+)\]/)
        if (disallowedMatch) {
          prev_disallowedTools = disallowedMatch[1].split(',').map(tool => tool.trim().replace(/['"]/g, ''))
        }
        break
      }
    }
    
    // Parse current message settings
    const dangerMatch = userMessage.match(/dangerously-skip-permissions=(\w+)/)
    const dangerouslySkipPermissions = dangerMatch ? 
      dangerMatch[1].toLowerCase() === 'true' : 
      prev_dangerously_skip_permissions
    
    const allowedMatch = userMessage.match(/allowedTools=\[([^\]]+)\]/)
    const allowedTools = allowedMatch ? 
      allowedMatch[1].split(',').map(tool => tool.trim().replace(/['"]/g, '')) :
      prev_allowedTools
    
    const disallowedMatch = userMessage.match(/disallowedTools=\[([^\]]+)\]/)
    const disallowedTools = disallowedMatch ?
      disallowedMatch[1].split(',').map(tool => tool.trim().replace(/['"]/g, '')) :
      prev_disallowedTools
    
    // Extract prompt
    const promptMatch = userMessage.match(/prompt="([^"]+)"/)
    let prompt
    if (promptMatch) {
      prompt = promptMatch[1]
    } else {
      // Remove settings from message
      prompt = userMessage.replace(
        /(dangerously-skip-permissions=\w+|allowedTools=\[[^\]]+\]|disallowedTools=\[[^\]]+\]|prompt="[^"]+"|prompt=)(\s*)/g, 
        ''
      ).trim()
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
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })
    
    // Create a custom stream handler for OpenAI format
    const originalWrite = reply.raw.write
    const originalEnd = reply.raw.end
    
    let responseBuffer = ''
    let inThinking = false
    let sessionPrinted = false
    let messageId = 'chatcmpl-' + Date.now()
    let systemFingerprint = 'fp_' + Date.now().toString(36)
    
    // Helper function to split text into chunks
    function splitIntoChunks(text, chunkSize = 100) {
      const chunks = []
      for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize))
      }
      return chunks
    }
    
    // Helper function to send a chunk
    function sendChunk(content, finishReason = null) {
      const chunk = {
        id: messageId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'claude-code',
        system_fingerprint: systemFingerprint,
        choices: [{
          index: 0,
          delta: { content: content },
          logprobs: null,
          finish_reason: finishReason
        }]
      }
      originalWrite.call(reply.raw, `data: ${JSON.stringify(chunk)}\n\n`)
    }
    
    reply.raw.write = function(chunk) {
      if (chunk.toString().startsWith('data: ')) {
        try {
          const jsonStr = chunk.toString().replace('data: ', '').trim()
          if (!jsonStr) return
          
          const buffer = jsonStr
          const jsonData = JSON.parse(buffer)
          
          if (jsonData.type === 'system' && jsonData.subtype === 'init') {
            const sessionId = jsonData.session_id
            if (sessionId && !sessionPrinted) {
              sessionPrinted = true
              responseBuffer = `session_id=${sessionId}\n`
              if (dangerouslySkipPermissions !== null) {
                responseBuffer += `dangerously-skip-permissions=${dangerouslySkipPermissions}\n`
              }
              if (allowedTools) {
                const toolsStr = allowedTools.map(tool => `"${tool}"`).join(',')
                responseBuffer += `allowedTools=[${toolsStr}]\n`
              }
              if (disallowedTools) {
                const toolsStr = disallowedTools.map(tool => `"${tool}"`).join(',')
                responseBuffer += `disallowedTools=[${toolsStr}]\n`
              }
              responseBuffer += '<thinking>\n'
              inThinking = true
              
              // Send initial chunk with role
              const roleChunk = {
                id: messageId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'claude-code',
                system_fingerprint: systemFingerprint,
                choices: [{
                  index: 0,
                  delta: { role: 'assistant' },
                  logprobs: null,
                  finish_reason: null
                }]
              }
              originalWrite.call(reply.raw, `data: ${JSON.stringify(roleChunk)}\n\n`)
              
              // Send session info in chunks
              const chunks = splitIntoChunks(responseBuffer)
              for (const chunk of chunks) {
                sendChunk(chunk)
              }
            }
          } else if (jsonData.type === 'assistant') {
            const message = jsonData.message || {}
            const content = message.content || []
            const stopReason = message.stop_reason
            const isFinalResponse = stopReason === 'end_turn'
            
            if (isFinalResponse && inThinking) {
              sendChunk('\n</thinking>\n')
              inThinking = false
            }
            
            for (const item of content) {
              if (item.type === 'text') {
                const textContent = item.text || ''
                if (isFinalResponse) {
                  // For final response, send text in chunks
                  const fullText = `\n${textContent}`
                  const chunks = splitIntoChunks(fullText)
                  for (let i = 0; i < chunks.length; i++) {
                    sendChunk(chunks[i], i === chunks.length - 1 ? 'stop' : null)
                  }
                } else {
                  // For thinking content, send with emoji prefix in chunks
                  const fullText = `\n🤖< ${textContent}`
                  const chunks = splitIntoChunks(fullText)
                  for (const chunk of chunks) {
                    sendChunk(chunk)
                  }
                }
              } else if (item.type === 'tool_use') {
                const toolName = item.name || 'Unknown'
                const toolInput = JSON.stringify(item.input || {})
                const fullText = `\n🔧 Using ${toolName}: ${toolInput}\n`
                const chunks = splitIntoChunks(fullText)
                for (const chunk of chunks) {
                  sendChunk(chunk)
                }
              } else if (item.type === 'thinking') {
                const thinkingContent = item.thinking || ''
                if (isFinalResponse) {
                  // For final response, send thinking content as normal text
                  const fullText = `\n${thinkingContent}`
                  const chunks = splitIntoChunks(fullText)
                  for (let i = 0; i < chunks.length; i++) {
                    sendChunk(chunks[i], i === chunks.length - 1 ? 'stop' : null)
                  }
                } else {
                  // For thinking content during processing, send with emoji prefix
                  const fullText = `\n🤖< ${thinkingContent}`
                  const chunks = splitIntoChunks(fullText)
                  for (const chunk of chunks) {
                    sendChunk(chunk)
                  }
                }
              }
            }
            
            // Send empty delta with finish_reason for final response (if not already sent)
            if (isFinalResponse && content.every(item => item.type !== 'text' && item.type !== 'thinking')) {
              const finalChunk = {
                id: messageId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'claude-code',
                system_fingerprint: systemFingerprint,
                choices: [{
                  index: 0,
                  delta: {},
                  logprobs: null,
                  finish_reason: 'stop'
                }]
              }
              originalWrite.call(reply.raw, `data: ${JSON.stringify(finalChunk)}\n\n`)
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
            
            const errorMessage = typeof jsonData.error === 'string' ? 
              jsonData.error : 
              (jsonData.error?.message || JSON.stringify(jsonData.error) || 'Unknown error')
            
            const fullText = `⚠️ ${errorMessage}\n`
            const chunks = splitIntoChunks(fullText)
            for (let i = 0; i < chunks.length; i++) {
              sendChunk(chunks[i], i === chunks.length - 1 ? 'stop' : null)
            }
          }
        } catch (e) {
          console.error('Error processing chunk:', e)
          // Send error to client in proper format
          const errorText = `\n⚠️ Stream processing error: ${e.message}\n`
          const chunks = splitIntoChunks(errorText)
          for (let i = 0; i < chunks.length; i++) {
            sendChunk(chunks[i], i === chunks.length - 1 ? 'stop' : null)
          }
        }
      }
    }
    
    reply.raw.end = function() {
      originalWrite.call(reply.raw, 'data: [DONE]\n\n')
      originalEnd.call(reply.raw)
    }
    
    await executeClaudeAndStream(prompt, session_id, { dangerouslySkipPermissions, allowedTools, disallowedTools }, reply)
  })

  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

startServer()