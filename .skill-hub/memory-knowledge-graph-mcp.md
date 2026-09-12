---
slug: memory-knowledge-graph-mcp
title: Knowledge Graph Memory MCP
description: Provides persistent graph memory for AI agents to retain decisions and context across sessions.
when_to_use: persisting agent memory across sessions, storing architecture decisions, graph knowledge
  retrieval
stack: shared
type: plugin
owning_team: admin
version: 1
tags:
- agent-tool
- context
- knowledge-graph
- mcp
- memory
- plugin
---

## Rule

Use the Memory MCP server (`modelcontextprotocol/servers/src/memory`) to persist long-term entity relationships, architecture conventions, and project decisions across agent sessions.

### Setup and Storage
- Execution: Run via `npx -y @modelcontextprotocol/server-memory`.
- Persistence: Data is stored in a local graph file mapped to the repository workspace.

### Core Capabilities
- `create_entities`: Creates knowledge entities representing modules, design rules, or services.
- `create_relations`: Links entities with directional predicates (e.g., `SkillCatalog` -> `reads` -> `Database`).
- `search_nodes`: Queries the graph by entity name or entity type.
- `read_graph`: Retrieves the knowledge graph to quickly orient the agent in complex domains.
