---
slug: database-multi-mcp-server
title: Database Multi MCP Server
description: Provides safe read-only schema inspection and SQL queries for PostgreSQL and MySQL databases.
when_to_use: querying postgresql or mysql, inspecting database schemas, listing tables, exploring columns
stack: infra
type: plugin
owning_team: admin
version: 1
tags:
- database
- mcp
- mysql
- plugin
- postgres
- sql
---

## Rule

Use the Multi-DB MCP server (`mahAnuj/mcp-multi-db`) to explore schemas and run safe read-only SQL queries across PostgreSQL and MySQL databases.

### Safety Guardrails
- Strictly enforce read-only transactions; mutations (`INSERT`, `UPDATE`, `DELETE`, `DROP`) are blocked by design.
- Pass database connection URLs via environment variables: `DATABASE_URL=postgresql://...` or `mysql://...`.

### Core Capabilities
- `list_tables`: Lists all tables and views within the connected database.
- `describe_table`: Returns column names, types, primary keys, and nullability.
- `run_query`: Executes read-only SQL queries with automatic row count limits.
- `list_databases`: Enumerates available schemas and databases on the host.
