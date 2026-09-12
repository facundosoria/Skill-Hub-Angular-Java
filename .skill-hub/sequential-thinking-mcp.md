---
slug: sequential-thinking-mcp
title: Sequential Thinking MCP Plugin
description: Enables dynamic step-by-step reasoning and hypothesis revision for complex engineering tasks.
when_to_use: complex problem solving, architecture planning, multi-step debugging, dynamic reasoning
stack: shared
type: plugin
owning_team: admin
version: 1
tags:
- mcp
- planning
- plugin
- reasoning
- sequential-thinking
---

## Rule

Use the Sequential Thinking MCP server (`modelcontextprotocol/servers/src/sequentialthinking`) to break down complex refactoring, design decisions, and deep debugging into iterative, self-correcting steps.

### Execution
- Package runner: Execute via `npx -y @modelcontextprotocol/server-sequential-thinking`.

### Core Workflow
- Dynamic steps: Submits progressive thoughts with `thoughtNumber` and estimated `totalThoughts`.
- Hypothesis branching: Tests alternative implementation designs using `branchFromThought` and `branchId`.
- Active self-correction: Adjusts assumptions using `revisesThought` when new evidence appears during coding.
