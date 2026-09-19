---
name: connect-skillhub-mcp
description: Configure Skill Hub as a remote MCP server from an IDE, desktop client, or CLI using a local API-key file without exposing the key in chat, logs, or project files.
---

# Connect Skill Hub MCP

Use this skill when the user wants to connect `https://marketplace-utn.tech/api/mcp` to an installed MCP client and has a Skill Hub API key.

## Security requirements

- Treat the API key as a password. Never print it, quote it in a response, put it in a visible command, include it in a log, or paste it into the chat.
- The user must load the key into `SKILL_HUB_API_KEY` locally before invoking the agent. Use these default source-file paths only for the user's setup instructions:
  - macOS/Linux: `$HOME/.config/skillhub/api-key`
  - Windows PowerShell: `$env:USERPROFILE\.config\skillhub\api-key`
- Do not create the key file inside the project. Never commit it, add it to a project `.env`, or place it in a tracked MCP configuration.
- If the user has not created the file and loaded the variable, explain how to do that locally and stop before configuring the client. Do not ask the user to send the key.
- Do not read, open, `cat`, `Get-Content`, or otherwise load the source key file into the agent's context. The user, not the agent, loads the variable in their terminal.
- If the client process was not started from the terminal containing `SKILL_HUB_API_KEY`, tell the user to close it and start it from that terminal. Do not try to recover the key by reading the file.
- If any command would echo the key, do not run it. Use only a supported environment-variable reference in the client configuration.
- If the key appears in output, stop, tell the user to revoke it from Skill Hub, and do not repeat it.

## User setup before the agent

Explain these steps before asking the agent to edit MCP configuration:

1. Create the private file outside the project:
   - macOS/Linux: run `mkdir -p ~/.config/skillhub`, then `nano ~/.config/skillhub/api-key`, paste the key, save with `Ctrl+O`, press Enter, exit with `Ctrl+X`, and run `chmod 600 ~/.config/skillhub/api-key`.
   - Windows PowerShell: run `New-Item -ItemType Directory -Force "$HOME\.config\skillhub"`, then `notepad "$HOME\.config\skillhub\api-key"`; paste the key, save, and close Notepad.
2. Load the key into the terminal environment without printing it:
   - macOS/Linux: `export SKILL_HUB_API_KEY="$(tr -d '\r\n' < ~/.config/skillhub/api-key)"`
   - Windows PowerShell: `$env:SKILL_HUB_API_KEY = (Get-Content "$HOME\.config\skillhub\api-key" -Raw).Trim()`
3. Check only that the variable is non-empty:
   - macOS/Linux: `[ -n "$SKILL_HUB_API_KEY" ] && echo "Variable lista" || echo "Variable vacía"`
   - Windows PowerShell: `if ($env:SKILL_HUB_API_KEY) { "Variable lista" } else { "Variable vacía" }`
4. Start or restart the MCP client from that same terminal. A GUI already running may not inherit the variable. Do not continue if the variable is empty.

## Workflow

1. Confirm the target URL is `https://marketplace-utn.tech/api/mcp` and locate the local key file. Check only that the file exists and is non-empty; never display its contents.
2. Detect the client and surface without guessing. Check installed commands and known configuration locations:
   - Claude Code/Desktop: `~/.claude.json`, `.mcp.json`, or the Claude Desktop configuration documented for the installed version.
   - Codex CLI/IDE: `~/.codex/config.toml` or a trusted project `.codex/config.toml`.
   - Antigravity IDE/CLI: `~/.gemini/config/mcp_config.json` or workspace `.agents/mcp_config.json`.
   - OpenCode: `~/.config/opencode/opencode.jsonc`, `~/.config/opencode/opencode.json`, or project `opencode.jsonc`.
   - Other clients: use the client's installed documentation or clearly identified MCP settings file; do not invent a path.
3. Before any write, report the detected client, surface, configuration path, and whether the change is user-wide or project-specific. Ask for confirmation. Do not modify anything yet.
4. After confirmation, create a recoverable backup beside the target file before editing it. Do not put the backup in the project if it contains a key.
5. Configure a server named `skillhub` using Streamable HTTP and the URL above. Use the client's documented schema and a reference to `SKILL_HUB_API_KEY` or its secure secret mechanism. If the client cannot reference an environment variable securely, stop and explain the limitation; never write a literal key.
6. Preserve unrelated settings, existing servers, comments where the format supports them, and the user's scope. Do not replace the complete configuration when a single server entry can be added.
7. Verify using the client's documented status command or MCP panel. Report only the client, edited path, backup path, and status. Do not report the key or an Authorization header.
8. Ask the user to open a new agent session and send: `Listame las skills disponibles en el marketplace.` A successful result mentions Skill Hub or returns a list of skills.

## Client-specific constraints

- Claude supports remote HTTP MCP servers with `claude mcp add --transport http` and user-scoped configuration. Desktop and CLI share MCP configuration, but Claude Desktop may also load its own desktop configuration; inspect the installed version before choosing a file.
- Codex CLI and its IDE extension share MCP configuration. The documented user file is `~/.codex/config.toml`; do not use a project file unless the user explicitly wants project scope and trusts that project.
- Antigravity has different menus and configuration surfaces. Antigravity IDE uses its MCP manager and raw `mcp_config.json`; Antigravity 2.0 uses `Settings → Customizations → Installed MCP Servers`. The current remote schema uses `serverUrl`, not legacy `url` or `httpUrl`.
- OpenCode's current configuration uses `mcp.servers` and a remote entry with `type: "remote"` and `url`. Do not assume an IDE surface exists when only the terminal/TUI is installed.
- If the client's schema, authentication field, or version is unclear, stop and show the user the exact uncertainty. Never invent a menu, field, or configuration format.

## Completion response

Keep the final response short and include:

- detected client and surface;
- configuration file changed and backup location;
- connection status;
- the exact verification prompt to send.

Never include the API key, its length, a partial value, or the generated configuration if it contains a literal secret.
