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

  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

startServer()