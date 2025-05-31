"""
title: Claude Code
author: 0235 inc
author_url: https://github.com/0235-jp
funding_url: https://github.com/0235-jp
repo_url: https://github.com/0235-jp/Claude-Code-Server
version: 0.1

REQUIREMENTS:
This pipe requires Claude Code Server to be running.
Please clone and run the server from: https://github.com/0235-jp/Claude-Code-Server

Setup Instructions:
1. Clone: git clone https://github.com/0235-jp/Claude-Code-Server
2. Install: npm install
3. Setup permissions (if using dangerously-skip-permissions):
   claude --dangerously-skip-permissions "test"
4. Start server: npm start
5. Configure BASE_URL in valves to point to your server (default: http://localhost:3000)
"""

import json
import re
from pydantic import BaseModel, Field
import requests


class Pipe:
    class Valves(BaseModel):
        BASE_URL: str = Field(
            default="http://localhost:3000", 
            description="Claude Code Server base URL - Requires https://github.com/0235-jp/Claude-Code-Server to be running"
        )

    def __init__(self):
        # IMPORTANT: This pipe requires Claude Code Server to be running
        # Get it from: https://github.com/0235-jp/Claude-Code-Server
        self.valves = self.Valves()

    def pipe(self, body: dict, __user__: dict):
        # Get the latest message
        messages = body.get("messages", [])
        if not messages:
            return "Error: No messages provided"

        user_message = messages[-1].get("content", "")

        session_id = None
        for i in range(len(messages) - 2, -1, -1):
            if messages[i].get("role") == "assistant":
                assistant_content = messages[i].get("content", "")
                session_match = re.search(r'session_id=([a-f0-9-]+)', assistant_content)
                if session_match:
                    session_id = session_match.group(1)
                break

        dangerously_skip_permissions = None
        danger_match = re.search(r'dangerously-skip-permissions=(\w+)', user_message)
        if danger_match:
            dangerously_skip_permissions = danger_match.group(1).lower() == 'true'

        allowedTools = None
        allowed_match = re.search(r'allowedTools=\[([^\]]+)\]', user_message)
        if allowed_match:
            allowedTools = [tool.strip().strip('"\'') for tool in allowed_match.group(1).split(',')]

        disallowedTools = None
        disallowed_match = re.search(r'disallowedTools=\[([^\]]+)\]', user_message)
        if disallowed_match:
            disallowedTools = [tool.strip().strip('"\'') for tool in disallowed_match.group(1).split(',')]

        prompt_match = re.search(r'prompt="([^"]+)"', user_message)
        if prompt_match:
            prompt = prompt_match.group(1)
        else:
            prompt = re.sub(r'(dangerously-skip-permissions=\w+|allowedTools=\[[^\]]+\]|disallowedTools=\[[^\]]+\]|prompt="[^"]+"|prompt=)(\s*)', '', user_message).strip()
            if not prompt:
                prompt = user_message

        data = {"prompt": prompt}
        if session_id:
            data["session_id"] = session_id
        if dangerously_skip_permissions is not None:
            data["dangerously-skip-permissions"] = dangerously_skip_permissions
        if allowedTools:
            data["allowedTools"] = allowedTools
        if disallowedTools:
            data["disallowedTools"] = disallowedTools

        headers = {"Content-Type": "application/json"}
        
        
        response = requests.post(
            f"{self.valves.BASE_URL}/api/claude",
            headers=headers,
            json=data,
            stream=True
        )

        if response.status_code == 200:
            buffer = ""
            for line in response.iter_lines():
                if line:
                    try:
                        line_text = line.decode("utf-8")
                        if line_text.startswith("data: "):
                            json_str = line_text.replace("data: ", "")
                            buffer += json_str
                            json_data = json.loads(buffer)
                            buffer = ""  # Reset buffer on successful parse
                                
                            if json_data.get("type") == "system" and json_data.get("subtype") == "init":
                                session_id_from_system = json_data.get("session_id")
                                if session_id_from_system:
                                    yield f"session_id={session_id_from_system}\n"
                                    yield "<thinking>\n"

                            elif json_data.get("type") == "assistant":
                                message = json_data.get("message", {})
                                content = message.get("content", [])
                                stop_reason = message.get("stop_reason")
                                is_final_response = stop_reason == "end_turn"
                                
                                # Close thinking before final response
                                if is_final_response:
                                    yield "\n</thinking>\n"
                                
                                for item in content:
                                    if item.get("type") == "text":
                                        text_content = item.get('text', '')
                                        if is_final_response:
                                            # Final response outside thinking
                                            yield f"\n{text_content}"
                                        else:
                                            # Thinking content with robot emoji - truncate if too long
                                            if len(text_content) > 500:
                                                truncated_content = text_content[:500] + "...(truncated)"
                                                yield f"\n🤖< {truncated_content}"
                                            else:
                                                yield f"\n🤖< {text_content}"
                                    elif item.get("type") == "tool_use":
                                        tool_name = item.get("name", "Unknown")
                                        tool_input = item.get("input", {})
                                        tool_input_str = str(tool_input)
                                        if len(tool_input_str) > 500:
                                            truncated_input = tool_input_str[:500] + "...(truncated)"
                                            yield f"\n🔧 Using {tool_name}: {truncated_input}\n"
                                        else:
                                            yield f"\n🔧 Using {tool_name}: {tool_input}\n"

                            elif json_data.get("type") == "user":
                                # Handle tool results
                                message = json_data.get("message", {})
                                content = message.get("content", [])
                                for item in content:
                                    if item.get("type") == "tool_result":
                                        tool_content = item.get("content", "")
                                        is_error = item.get("is_error", False)
                                        if is_error:
                                            yield f"\n❌ Tool Error: {tool_content}\n"
                                        else:
                                            # Truncate long tool results to prevent UI blocking
                                            if len(tool_content) > 500:
                                                truncated_content = tool_content[:500] + "...(truncated)"
                                                yield f"\n✅ Tool Result: {truncated_content}\n"
                                            else:
                                                yield f"\n✅ Tool Result: {tool_content}\n"

                            elif json_data.get("type") == "result":
                                # Skip result content since it's the same as final assistant message
                                # Only show additional metadata if needed
                                pass
                            
                            elif json_data.get("type") == "error":
                                yield "\n</thinking>\n"
                                # Display error message directly
                                error_message = json_data.get("error", "Unknown error")
                                if len(str(error_message)) > 500:
                                    truncated_error = str(error_message)[:500] + "...(truncated)"
                                    yield f"\⚠️ {truncated_error}\n"
                                else:
                                    yield f"\⚠️ {error_message}\n"
                            
                            else:
                                # Handle other unexpected data types (tool_use, etc.)
                                # Pass through unknown data to maintain transparency
                                json_str = str(json_data)
                                if len(json_str) > 500:
                                    truncated_json = json_str[:500] + "...(truncated)"
                                    yield f"\n💩 {truncated_json}\n"
                                else:
                                    yield f"\n💩 {json_data}\n"
                        else:
                            line_text = line.decode("utf-8")
                            if line_text.strip():
                                if len(line_text) > 500:
                                    truncated_line = line_text[:500] + "...(truncated)"
                                    yield f"\n💩 {truncated_line}\n"
                                else:
                                    yield f"\n💩 {line_text}\n"
                    except Exception as e:
                        print(f"Error: {e}")
                        yield f"\n⚠️ {e}\n"
                        continue
        else:
            error_message = (
                f"Workflow request failed with status code: {response.status_code}"
            )
            try:
                error_data = response.json()
                if "error" in error_data:
                    error_message += f" - {error_data['error']}"
            except:
                pass
            yield error_message
