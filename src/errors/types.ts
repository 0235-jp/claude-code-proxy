/**
 * Standardized error response format and types
 */

export interface ErrorResponse {
  error: {
    message: string;
    type: ErrorType;
    code: string;
    details?: Record<string, unknown>;
    requestId?: string | undefined;
    timestamp: string;
  };
}

export enum ErrorType {
  VALIDATION_ERROR = 'validation_error',
  AUTHENTICATION_ERROR = 'authentication_error',
  AUTHORIZATION_ERROR = 'authorization_error',
  NOT_FOUND_ERROR = 'not_found_error',
  RATE_LIMIT_ERROR = 'rate_limit_error',
  SYSTEM_ERROR = 'system_error',
  CLAUDE_CLI_ERROR = 'claude_cli_error',
  WORKSPACE_ERROR = 'workspace_error',
  MCP_ERROR = 'mcp_error',
  STREAM_ERROR = 'stream_error',
  CONFIGURATION_ERROR = 'configuration_error',
  HEALTH_CHECK_ERROR = 'health_check_error',
}

export enum ErrorCode {
  // Validation errors
  INVALID_REQUEST = 'invalid_request',
  MISSING_REQUIRED_FIELD = 'missing_required_field',
  INVALID_FIELD_VALUE = 'invalid_field_value',
  INVALID_JSON = 'invalid_json',

  // Authentication/Authorization errors
  MISSING_API_KEY = 'missing_api_key',
  INVALID_API_KEY = 'invalid_api_key',
  INSUFFICIENT_PERMISSIONS = 'insufficient_permissions',

  // Resource errors
  RESOURCE_NOT_FOUND = 'resource_not_found',
  WORKSPACE_NOT_FOUND = 'workspace_not_found',
  SESSION_NOT_FOUND = 'session_not_found',

  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',

  // System errors
  INTERNAL_SERVER_ERROR = 'internal_server_error',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  TIMEOUT_ERROR = 'timeout_error',

  // Claude CLI specific
  CLAUDE_CLI_NOT_FOUND = 'claude_cli_not_found',
  CLAUDE_CLI_VERSION_MISMATCH = 'claude_cli_version_mismatch',
  CLAUDE_CLI_EXECUTION_FAILED = 'claude_cli_execution_failed',
  CLAUDE_CLI_TIMEOUT = 'claude_cli_timeout',

  // Workspace errors
  WORKSPACE_ACCESS_DENIED = 'workspace_access_denied',
  WORKSPACE_CREATION_FAILED = 'workspace_creation_failed',

  // MCP errors
  MCP_CONFIG_INVALID = 'mcp_config_invalid',
  MCP_SERVER_UNAVAILABLE = 'mcp_server_unavailable',
  MCP_TOOL_NOT_FOUND = 'mcp_tool_not_found',

  // Stream errors
  STREAM_INTERRUPTED = 'stream_interrupted',
  STREAM_WRITE_FAILED = 'stream_write_failed',

  // Configuration errors
  INVALID_CONFIGURATION = 'invalid_configuration',
  MISSING_CONFIGURATION = 'missing_configuration',

  // Health check errors
  HEALTH_CHECK_FAILED = 'health_check_failed',
}

export interface ErrorContext {
  requestId?: string;
  userId?: string;
  sessionId?: string;
  workspace?: string;
  endpoint?: string;
  method?: string;
  userAgent?: string | undefined;
  clientIp?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface ValidationErrorDetail {
  field: string;
  value: unknown;
  message: string;
  code: string;
}

export interface SystemErrorDetail {
  component: string;
  operation: string;
  originalError?: string | undefined;
  stackTrace?: string | undefined;
}
