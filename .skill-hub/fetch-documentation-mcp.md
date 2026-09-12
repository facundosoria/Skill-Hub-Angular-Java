---
slug: fetch-documentation-mcp
title: Fetch Documentation MCP
description: Fetches online documentation and articles, converting them to token-efficient clean Markdown.
when_to_use: reading technical documentation online, fetching web pages, extracting markdown from URLs
stack: shared
type: plugin
owning_team: admin
version: 1
tags:
- docs
- fetch
- mcp
- plugin
- token-optimization
- web
---

## Rule

Use the Fetch MCP server (`modelcontextprotocol/servers/src/fetch`) to retrieve external technical documentation and articles directly as clean, token-efficient Markdown.

### Execution
- Runner: Run via `uvx mcp-server-fetch` or python module.

### Core Capabilities
- `fetch`: Downloads HTML content from a target URL, strips superfluous markup, and converts the core text to Markdown.
- Token efficiency: Cuts token consumption by up to 80% compared to loading full raw HTML pages into the agent's context window.
