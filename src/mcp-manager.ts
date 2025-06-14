/**
 * MCP (Model Context Protocol) configuration management
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { McpConfig } from './types';

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
    console.log('MCP configuration loaded successfully');
    return mcpConfig;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.log('No mcp-config.json found, MCP features disabled');
    } else {
      const message =
        error && typeof error === 'object' && 'message' in error ? error.message : 'Unknown error';
      console.error('Error loading MCP configuration:', message);
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
    return [];
  }

  const availableServers = Object.keys(mcpConfig!.mcpServers);
  console.log('Available MCP servers:', availableServers);

  // Filter tools that match available server prefixes
  const validTools = requestedTools.filter(tool => {
    return availableServers.some(server => tool.startsWith(`mcp__${server}__`));
  });

  console.log('Requested MCP tools:', requestedTools);
  console.log('Valid MCP tools:', validTools);

  return validTools;
}
