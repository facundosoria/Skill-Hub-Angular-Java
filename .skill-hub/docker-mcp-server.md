---
slug: docker-mcp-server
title: Docker MCP Server
description: Allows AI agents to manage Docker containers, view real-time logs, and inspect compose services.
when_to_use: managing docker containers, inspecting docker compose, reading container logs, docker health
  checks
stack: infra
type: plugin
owning_team: admin
version: 1
tags:
- compose
- containers
- docker
- infra
- mcp
- plugin
---

## Rule

Use the Docker MCP server (`friendlygeorge/docker-mcp-server`) to inspect container health, read container logs, and oversee Docker Compose stacks.

### Setup and Permissions
- Socket access: Requires access to the Docker daemon socket (`/var/run/docker.sock`).
- Execution: Run via `npx -y @friendlygeorge/docker-mcp-server` or as an isolated container.

### Core Capabilities
- `list_containers`: Enumerates active and stopped containers with port mappings.
- `get_container_logs`: Fetches recent stdout/stderr lines from specific services.
- `inspect_container`: Returns status, network settings, and health check output.
- `restart_container`: Triggers service restarts when recovery is needed.
