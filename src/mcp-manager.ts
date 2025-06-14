/**
 * MCP (Model Context Protocol) configuration management
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { McpConfig } from './types';
import { mcpLogger, logConfiguration } from './logger';

/** MCP configuration object */
let mcpConfig: McpConfig | null = null;

/**
 * Load MCP configuration from mcp-config.json file
 * @returns Loaded configuration or null if failed
 */
export async function loadMcpConfig(): Promise<McpConfig | null> {
  try {
    const configPath = path.join(__dirname, '..', 'mcp-config.json');
    const configData = await fs.readFile(configPath, 'utf8');
    mcpConfig = JSON.parse(configData);

    // Log successful configuration load with server details
    const serverCount = Object.keys(mcpConfig?.mcpServers || {}).length;
    mcpLogger.info(
      {
        configPath,
        serverCount,
        servers: Object.keys(mcpConfig?.mcpServers || {}),
        type: 'config_loaded',
      },
      'MCP configuration loaded successfully'
    );

    // Log configuration details (masked for security)
    logConfiguration('mcp', {
      serverCount,
      servers: Object.keys(mcpConfig?.mcpServers || {}),
      configPath,
    });

    return mcpConfig;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      mcpLogger.info(
        {
          configPath: path.join(__dirname, '..', 'mcp-config.json'),
          type: 'config_missing',
        },
        'No mcp-config.json found, MCP features disabled'
      );
    } else {
      const message =
        error && typeof error === 'object' && 'message' in error ? error.message : 'Unknown error';
      mcpLogger.error(
        {
          error: error instanceof Error ? error : new Error(String(message)),
          configPath: path.join(__dirname, '..', 'mcp-config.json'),
          type: 'config_load_error',
        },
        'Error loading MCP configuration'
      );
    }
    mcpConfig = null;
    return null;
  }
}

/**
 * Get current MCP configuration
 * @returns Current MCP configuration
 */
export function getMcpConfig(): McpConfig | null {
  return mcpConfig;
}

/**
 * Check if MCP is enabled and configured
 * @returns True if MCP is enabled with servers configured
 */
export function isMcpEnabled(): boolean {
  return mcpConfig !== null && mcpConfig.mcpServers && Object.keys(mcpConfig.mcpServers).length > 0;
}

/**
 * Validate and filter requested MCP tools against available servers
 * @param requestedTools - Array of requested MCP tool names
 * @returns Array of valid MCP tools available on configured servers
 */
export function validateMcpTools(requestedTools: string[]): string[] {
  if (!isMcpEnabled() || !requestedTools || !Array.isArray(requestedTools)) {
    mcpLogger.debug(
      {
        mcpEnabled: isMcpEnabled(),
        requestedToolsProvided: !!requestedTools,
        isArray: Array.isArray(requestedTools),
        type: 'validation_skip',
      },
      'MCP tool validation skipped - conditions not met'
    );
    return [];
  }

  const availableServers = Object.keys(mcpConfig!.mcpServers);

  // Filter tools that match available server prefixes
  const validTools = requestedTools.filter(tool => {
    return availableServers.some(server => tool.startsWith(`mcp__${server}__`));
  });

  const invalidTools = requestedTools.filter(tool => !validTools.includes(tool));

  mcpLogger.info(
    {
      availableServers,
      requestedTools,
      validTools,
      invalidTools,
      validCount: validTools.length,
      invalidCount: invalidTools.length,
      type: 'tool_validation',
    },
    `MCP tool validation: ${validTools.length} valid, ${invalidTools.length} invalid tools`
  );

  if (invalidTools.length > 0) {
    mcpLogger.warn(
      {
        invalidTools,
        availableServers,
        type: 'invalid_tools_requested',
      },
      'Some requested MCP tools are not available on configured servers'
    );
  }

  return validTools;
}
