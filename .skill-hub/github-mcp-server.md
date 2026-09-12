---
slug: github-mcp-server
title: GitHub MCP Server
description: Connects AI agents to GitHub to manage pull requests, issues, branches, and code reviews.
when_to_use: interacting with GitHub, opening pull requests, reviewing PRs, managing issues, git automation
stack: shared
type: plugin
owning_team: admin
version: 1
tags:
- git
- github
- mcp
- plugin
- vcs
---

## Rule

Use the official GitHub MCP server (`github/github-mcp-server`) for agent interactions with remote GitHub repositories, pull requests, and issues.

### Setup and Execution
- Containerized: Run via Docker image `ghcr.io/github/github-mcp-server`.
- Binary: Download the precompiled Go binary from `github.com/github/github-mcp-server/releases`.
- Authentication: Provide `GITHUB_PERSONAL_ACCESS_TOKEN` with `repo` and `workflow` scopes.

### Core Capabilities
- `create_pull_request`: Opens a PR with automated diff summary.
- `create_or_update_file`: Pushes code changes directly to target branches.
- `list_issues` and `create_issue`: Manages repository issues.
- `search_code`: Performs semantic and keyword search across repositories.
