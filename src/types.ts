export interface ClaudeOptions {
  dangerouslySkipPermissions?: boolean
  allowedTools?: string[]
  disallowedTools?: string[]
  timeout?: number
}

export interface ClaudeResponse {
  type: string
  subtype?: string
  is_error?: boolean
  result?: string
  session_id?: string | null
}

export interface ClaudeInitResponse extends ClaudeResponse {
  type: 'system'
  subtype: 'init'
  session_id: string
}

export interface ClaudeMessage {
  content?: Array<{
    type: string
    text?: string
    thinking?: string
    name?: string
    input?: unknown
    content?: string
    is_error?: boolean
  }>
  stop_reason?: string
}

export interface ClaudeStreamResponse {
  type: string
  subtype?: string
  session_id?: string
  message?: ClaudeMessage
  error?: unknown
}
