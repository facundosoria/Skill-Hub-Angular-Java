---
slug: taiga-api-integration-plugin
title: Taiga API Integration Plugin
description: Connects agents to the Taiga REST API to query user stories, update tasks, and track sprint
  progress.
when_to_use: integrating with Taiga REST API, syncing user stories with Taiga, updating task status in
  Taiga
stack: shared
type: plugin
owning_team: admin
version: 1
tags:
- agile
- api
- plugin
- taiga
- tasks
- user-stories
---

## Rule

Use the Taiga REST API integration to synchronize backlog items, user stories, and task updates between AI agents and Taiga boards.

### Connection and Authentication
- Base URL: Target `https://api.taiga.io/api/v1/` or the organisation's self-hosted instance.
- Authorization: Authenticate requests using a Taiga API Bearer token in the request header.

### Supported Operations
- `taiga_list_user_stories`: Retrieves user stories assigned to the active sprint.
- `taiga_get_tasks`: Lists technical tasks linked to a specific user story.
- `taiga_update_task_status`: Updates task status (e.g., In Progress, Closed, Blocked).
- `taiga_create_issue`: Files defects and bug reports directly into the project board.
