/**
 * Type definitions for Claude Code Server
 */

export interface ClaudeOptions {
  workspace?: string;
  systemPrompt?: string;
  dangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
}

export interface ClaudeApiRequest {
  prompt: string;
  'session-id'?: string;
  workspace?: string;
  'system-prompt'?: string;
  'dangerously-skip-permissions'?: boolean;
  'allowed-tools'?: string[];
  'disallowed-tools'?: string[];
  files?: string[];
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<{
        type: 'text' | 'image_url' | 'file';
        text?: string;
        image_url?: {
          url: string;
          detail?: 'low' | 'high' | 'auto';
        };
        file?: {
          file_data: string; // base64 encoded file data
          filename?: string;
        };
      }>;
}

export interface OpenAIRequest {
  model?: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}


export interface SessionInfo {
  session_id: string;
  workspace?: string;
  dangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  showThinking?: boolean;
}

// Content block types based on Anthropic SDK
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface StreamJsonData {
  type: 'system' | 'assistant' | 'user' | 'result' | 'error' | string;
  subtype?: string;
  session_id?: string;
  message?: {
    content?: ContentBlock[];
    stop_reason?: string;
  };
  // Result type specific fields
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  result?: string;
  total_cost_usd?: number;
  // Error type specific field
  error?: string | { message: string };
}
