# Claude Code Server - Open WebUI Prompt Template

## Overview

This prompt template provides a convenient way to interact with Claude Code Server through Open WebUI with parameter control.

## Prompt Template

**Title:** `/claude`

**Content:**
```
dangerously-skip-permissions=
allowedTools=
disallowedTools=
prompt=
```

## Parameter Descriptions

### `dangerously-skip-permissions=`
- **Type:** boolean (true/false)
- **Default:** false (not specified)
- **Description:** Bypasses all permission checks in Claude Code
- **Important:** Must be accepted in an interactive Claude Code session first with `claude --dangerously-skip-permissions "test"`
- **Example:** `dangerously-skip-permissions=true`

### `allowedTools=`
- **Type:** array of tool names
- **Default:** All tools allowed
- **Description:** Comma-separated list of tools that Claude Code is allowed to use
- **Format:** `allowedTools=["Tool1","Tool2","Tool3"]`
- **Example:** `allowedTools=["Bash","Edit","Write"]`

### `disallowedTools=`
- **Type:** array of tool names  
- **Default:** No tools disallowed
- **Description:** Comma-separated list of tools that Claude Code is NOT allowed to use
- **Format:** `disallowedTools=["Tool1","Tool2","Tool3"]`
- **Example:** `disallowedTools=["WebFetch","WebSearch"]`

### `prompt=`
- **Type:** string
- **Required:** Yes
- **Description:** The actual instruction/question for Claude Code
- **Format:** `prompt="Your instruction here"`
- **Note:** If not specified with quotes, the entire message excluding other parameters will be used as the prompt

## Available Tools

Common Claude Code tools include:
- `Bash` - Execute bash commands
- `Edit` - Edit existing files
- `Write` - Create new files
- `Read` - Read file contents
- `Glob` - Find files by patterns
- `Grep` - Search file contents
- `WebFetch` - Fetch web content
- `WebSearch` - Perform web searches
- `Task` - Launch sub-agents

## Usage Examples

### Basic Usage
```
prompt="Create a hello world JavaScript file"
```

### With Permission Bypass
```
dangerously-skip-permissions=true
prompt="Create and execute a system script"
```

### With Tool Restrictions
```
allowedTools=["Bash","Edit","Write"]
disallowedTools=["WebFetch","WebSearch"]
prompt="Create a Node.js application"
```

### Complex Example
```
dangerously-skip-permissions=true
allowedTools=["Bash","Edit","Write","Read"]
prompt="Analyze this project and create a deployment script"
```

### Without Parameters (Simple)
```
Create a Python script that prints hello world
```

## Session Management

- **Automatic Session Detection:** The system automatically detects and maintains sessions across conversations
- **Session Persistence:** Previous work context is preserved within the same chat
- **Session ID Display:** Session information appears as `session_id=xxx` in responses
- **No Manual Session Management:** Users don't need to manually specify session IDs

## Response Format

Responses are formatted as:
```
session_id=abc123-def456-...

A:Claude Code response text here

result:Final result summary
```
## Tips

- **Parameter Order:** Parameters can be specified in any order
- **Whitespace:** Extra spaces around parameters are automatically handled
- **Case Sensitivity:** Parameter names are case-sensitive
- **Tool Names:** Tool names in arrays are case-sensitive and should match exactly
- **Error Handling:** Invalid parameters are ignored, and the system falls back to defaults
