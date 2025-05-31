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
            prompt = re.sub(r'(dangerously-skip-permissions=\w+|allowedTools=\[[^\]]+\]|disallowedTools=\[[^\]]+\]|prompt="[^"]+")(\s*)', '', user_message).strip()
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
            for line in response.iter_lines():
                if line:
                    try:
                        line_text = line.decode("utf-8")
                        if line_text.startswith("data: "):
                            json_data = json.loads(line_text.replace("data: ", ""))
                            if json_data.get("type") == "system" and json_data.get("subtype") == "init":
                                session_id_from_system = json_data.get("session_id")
                                if session_id_from_system:
                                    yield f"session_id={session_id_from_system}\n\n"

                            elif json_data.get("type") == "assistant":
                                message = json_data.get("message", {})
                                content = message.get("content", [])
                                for item in content:
                                    if item.get("type") == "text":
                                        yield f"\nassistant:{item.get('text', '')}"

                            elif json_data.get("type") == "result":
                                result_text = json_data.get("result", "")
                                if result_text:
                                    yield f"\nresult:{result_text}"

                    except json.JSONDecodeError as e:
                        print(f"Failed to parse JSON: {line} - Error: {e}")
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
