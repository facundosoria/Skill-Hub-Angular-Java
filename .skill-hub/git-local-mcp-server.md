---
slug: git-local-mcp-server
title: Git Local MCP Server
description: Enables AI agents to inspect diffs, status, commit history, and branches in local repositories.
when_to_use: inspecting local git repo, checking git status, viewing git diff, reading git commit log,
  git branch
stack: shared
type: plugin
owning_team: admin
version: 1
tags:
- diff
- git
- mcp
- plugin
- vcs
---

## Rule

Use the local Git MCP server (`modelcontextprotocol/servers/src/git`) to inspect and manipulate local Git repositories without requiring external network or API access.

### Setup and Execution
- Package runner: Run via `uvx mcp-server-git --repository /path/to/repo`.
- Working directory: Ensure the execution path points to the root of the target Git repository.

### Core Capabilities
- `git_status`: Displays modified, staged, and untracked files.
- `git_diff`: Shows precise unified diffs for uncommitted changes.
- `git_log`: Reads recent commits, authors, and commit messages.
- `git_show`: Inspects specific commit contents and metadata.
