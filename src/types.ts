/**
 * Type definitions for Claude Code Server
 */

export interface ClaudeOptions {
  workspace?: string;
  systemPrompt?: string;
  dangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpAllowedTools?: string[];
}

export interface ClaudeApiRequest {
  prompt: string;
  'session-id'?: string;
  workspace?: string;
  'system-prompt'?: string;
  'dangerously-skip-permissions'?: boolean;
  'allowed-tools'?: string[];
  'disallowed-tools'?: string[];
  'mcp-allowed-tools'?: string[];
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

export interface McpConfig {
  mcpServers: Record<string, unknown>;
}

export interface SessionInfo {
  session_id: string;
  workspace?: string;
  dangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpAllowedTools?: string[];
  showThinking?: boolean;
}

export interface StreamJsonData {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
      name?: string;
      input?: unknown;
      content?: string;
      is_error?: boolean;
    }>;
    stop_reason?: string;
  };
  error?: string | { message: string };
}
