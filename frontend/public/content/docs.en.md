# How it works

What this is, what it is for, how your IDE connects, and what the AI does with what it receives.

## The problem

Eleven teams work in parallel on the same system. Without a single source, each team invents its own way of handling errors, naming endpoints, building a form. Six months later there are eleven dialects and nobody can move between teams without relearning everything.

Wiki pages do not solve it, because nobody opens them at the exact moment they are writing the code.

## The idea

One catalogue of conventions, with **two faces over the same data**:

- **For people** — this web app. You search, read, propose changes. Everything is versioned and audited.
- **For agents** — an MCP endpoint. Your IDE connects with your key and the agent consults the catalogue on its own, before writing code.

Both read the same database. What gets approved here is what the agent reads a second later: no `git pull`, no versions drifting apart between teams.

## Not a marketplace

The word comes up often and it is worth clearing away, because the wrong mental model leads to the wrong decisions.

A marketplace has **many publishers competing** and the consumer picks between options. Here it is exactly the opposite: if six different versions of the buttons skill appear, that is not variety — it is the project failing. What you are using is a **canonical catalogue**: one skill per problem, curated, with an owner.

| | A marketplace | This catalogue |
| --- | --- | --- |
| How many per topic | As many as want to publish | Exactly one, the canonical |
| Who chooses | You, between alternatives | Nobody: the agent gets the right one |
| Publishing | Open to anyone | Requires an admin's approval |
| Duplicates | They are the offering | They are the problem to avoid |
| If something is wrong | You pick another | The existing one is fixed, and versioned |

That is why the app warns you before letting you create something similar to what exists, and why nothing reaches agents without approval. If this were thought of as a marketplace, the natural impulse would be "let everyone publish theirs and people choose" — and that brings back exactly the drift between teams we came to eliminate.

The only genuinely marketplace-like part is the distribution mechanism: each person connects from outside with their own key.

## What a skill is

A markdown file with metadata. The **frontmatter** is what makes it findable; the body is the convention; an optional `` ```preview `` block renders next to the code and as a thumbnail in the listing.

```yaml
---
slug: buttons
title: Buttons
description: Every clickable action in the app.
when_to_use: Use when rendering any clickable action - button,
  CTA, primary or secondary action, submit, confirm, cancel.
stack: angular
type: skill
owning_team: platform
tags: [buttons, actions, forms, ui]
related: [form-fields]
---

## Rule

Never a bare button element...
```

The field that matters most is `when_to_use`: it is written **for a machine to read**, not a person. It is literally what decides whether the agent finds the right skill, so it is written by listing the situations and the synonyms someone would use to describe the task.

Skills are written **in English** because the Postgres search index applies English stemming and agents query in English. If the language of the query and the language of the document do not match, "buttons" and "button" stop collapsing to the same lexeme and search loses exactly what makes it useful.

The types are **skill** (how something is done), **convention** (a rule to respect) and **reference** (data, like the port registry).

## What MCP is

**MCP is the Model Context Protocol**: a standard protocol for an AI model to talk to external systems. It is to agents what HTTP is to browsers — an agreement on how things are requested and returned.

Before MCP, connecting a tool to an assistant meant writing a different plugin for each one. With MCP you write **one server** and it works in Claude Code, Cursor, Windsurf or any other client that speaks the protocol. That is why the hub exposes MCP and not its own API: the day your team switches IDE, the catalogue keeps working.

- **Client** — your IDE. It opens the connection, authenticates, and hands the model what the server offers.
- **Server** — the hub. It exposes capabilities and answers calls. It never initiates anything.
- **Transport** — how messages travel. `stdio` for local servers; `Streamable HTTP` for remote ones like this.
- **Messages** — JSON-RPC 2.0: every message has `method`, `params` and an `id` to pair request and response.

An MCP server can expose three kinds of things: **tools** (actions the model can invoke), **resources** (documents the client can read) and **prompts** (templates). We use **tools only**, because that is what every client implements well and because we want the model to decide when to consult, not the person.

The conversation always starts the same way:

```text
client → initialize        "hello, I speak version 2025-06-18"
server → capabilities + instructions
client → tools/list        "what can you do?"
server → the tools with their schemas
client → tools/call        "run search_skills with these arguments"
server → the result, as text
```

> **The detail that makes it all work.** In the response to `initialize` the server sends an `instructions` field: free text the client injects into the model's context. That is where we tell it *"before writing Angular or Java code here, search the catalogue first"*. Without that text the server would work the same, but nobody would use it, because the model would have no reason to call it.

## How it is built

In the Next project the MCP server was one more route of the same app; in this version it is an API endpoint in Spring Boot, at `{{MCP_URL}}`. It shares the database with the web app, which is why what gets approved here is available to agents instantly.

- **Endpoint** — `{{MCP_URL}}`
- **Transport** — Streamable HTTP. It answers plain JSON instead of holding an SSE stream open: the read tools never initiate messages, so there is nothing to wait for.
- **State** — none. A server and a transport are built per request. No sessions to keep or clean up.
- **Authentication** — header `Authorization: Bearer sk_hub_…`, verified on every call.
- **Schemas** — each tool declares its parameters as JSON Schema. The model receives that schema, which is why it can build a well-formed call without guessing.
- **Permissions** — read only, except `propose_skill` — and that one can only create provisional proposals, never publish.

A real call, in full:

```http
POST /api/mcp
Authorization: Bearer sk_hub_xxxxxxxxxxxx
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "search_skills",
    "arguments": { "query": "action button in a form" }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [{ "type": "text", "text": "{ \"results\": [{ \"slug\": \"buttons\", \"when_to_use\": \"Use when rendering any clickable action...\", \"uses_90d\": 312, \"people\": 24 }], \"next_step\": \"Pick the one that applies and fetch it with get_skill(slug).\" }" }]
  }
}
```

Notice the result travels as **text** inside `content`. MCP does not return typed objects to the model: it returns something to read. That is why the keys are in English and the JSON is indented — what arrives is, literally, what the model is going to read.

## Your API key

An API key is a password for machines. Your IDE cannot fill in a login form, so you give it a secret string that identifies it on every request.

```text
sk_hub_Kb3vP9xLmQ2tR7wY4nZ8jH6c
└─────┘ └──────────────────────┘
prefix   24 random bytes (base64url)
```

The `sk_hub_` prefix exists so it is recognisable: if it shows up in a log or a repository, it is immediately clear what it is and where it came from.

- **Where it is stored** — only the **SHA-256 hash** is kept, never the value. It is not that we choose not to show it again: we do not have it.
- **How it travels** — in the `Authorization` header of every request, over HTTPS.
- **What it can do** — read the catalogue, and propose a convention when none exists. It cannot edit, publish or delete anything.
- **Who it identifies** — you and your team. It is what lets us say "9 people consult this skill" without exposing who each one is.
- **Revoking** — immediate. Verification filters revoked keys on every call, so the next request already gets a 401.

> **Treat it like a password.** Do not commit it or paste it into a chat. Use one key per device, so you can revoke only the one from the laptop you lost without cutting everyone else off. If you suspect it leaked, revoke it and generate another: they are free.

Since the key cannot publish, who changed what is recorded by the audit log of the web app, which is a different thing: there the identity comes from your session, not from the key.

## Connect your IDE

1. Generate your key in **My key**. It is shown only once.
2. Paste the snippet for your IDE. It is ready to copy on that same page.
3. Work normally. You do not need to mention the catalogue: on connecting, the server hands the agent the instruction to search before writing code.

> **How to tell it is working.** Open a clean session and ask *"add a save button to this form"* without naming any skill. The agent should call `search_skills` on its own and bring back the buttons skill.

## The order of things

From opening your IDE to code written to the convention. Steps 2 through 6 the agent does on its own.

1. **The IDE connects** *(IDE)* — once per session. It sends your API key in the header and the server responds with the list of tools and the instructions text.
2. **The agent reads the instructions** *(Agent)* — that text tells it: before writing Angular or Java code here, search the catalogue first, in English. It is what makes the rest happen unprompted.
3. **You ask for something** *(You)* — "add a save button to this form". You name no skill.
4. **`search_skills("action button in a form")`** *(Agent)* — the agent turns your request into an English query and searches. It gets up to 5 candidates with their `when_to_use` and how much each is used. No contents: this is the cheap call.
5. **It picks one** *(Agent)* — it compares the `when_to_use` fields against the task. If two compete, it breaks the tie with `uses_90d` and `people`: the one 24 people rely on is more canonical than the one used by 2.
6. **`get_skill("buttons")`** *(Agent)* — only now does it fetch the full contents, of a single skill. If it were deprecated, instead of the contents it gets the replacement slug and calls again with that one.
7. **It writes the code following the rule** *(Agent)* — and the lookup is recorded, which is what later tells you which skills are actually used.

If the search comes back empty there is an eighth step: the agent solves the task and then calls `propose_skill` so the next person gets the same answer instead of improvising a different one.

## Does it install?

**Only the ones you actually use, and only as a cache.** Nothing is bulk-installed and the catalogue stays the source of truth.

When the agent calls `get_skill` the response carries two extra fields: `file`, the skill as a self-contained `.md` with frontmatter, and `save_as`, a relative path like `.skill-hub/buttons.md`. The agent writes it there and, next time, reads the local copy instead of calling again — unless the catalogue reports a higher `version` than the one in the file's frontmatter, in which case it re-fetches and overwrites. A deprecated skill tells the agent to delete its copy and fetch the replacement.

To avoid checking them one by one, there is `sync_skills`: the agent sends every local copy as `{ slug, version }` and gets back, in one call, which are stale (with the new `file`), which are deprecated and which are gone. It is meant to run once at the start of a session.

| | Bulk install | Cache what you use |
| --- | --- | --- |
| Offline | Everything | The skills you have already fetched |
| Staying current | Everyone stays on the version they downloaded | The `version` field pulls each stale file forward on next use |
| Drift | Eleven versions within two months | Bounded: the catalogue wins, copies are never edited by hand |
| Measuring usage | Cannot be done | `get_skill` still records the lookup that feeds the ranking |
| Deprecating something | You have to tell people one by one | The agent gets the redirect and drops its copy on its own |

The catalogue reaching everyone the moment it changes is powerful and dangerous at once: a bad change would propagate on the next lookup. That is why nothing is published without an admin approving it.

## How the AI uses it

The model does not "know" this catalogue exists. What happens is more mechanical, and worth understanding because it explains several design decisions.

On connecting, the client puts two things into the model's context: the `instructions` text and the **definition of each tool** — its name, description and parameter schema. That stays there for the whole session, taking up room. When you ask for something, the model compares your request against those descriptions and decides whether any applies.

> **Why a handful of tools and not a hundred.** If the server published one tool per skill, all hundred definitions would sit permanently in every agent's context, and the model would have to choose between a hundred similar options on every turn. With a handful of generic tools, the catalogue can grow to a thousand skills without the context cost changing: what grows is what search returns, not what the model loads up front.

That is also why `search_skills` returns at most 5 results and no contents, why `description` and `when_to_use` are capped at 200 characters enforced at publish time, and why `get_skill` strips the preview HTML — measured on the buttons skill, that block alone was 44% of the payload, sent to a reader that cannot use it.

What the model gets back is plain text, added to the conversation like any other message. There is no magic: if the skill says *"never a bare button"*, the model reads it and keeps it in mind while writing, the same way it would keep in mind anything you had told it yourself.

Practical consequence: if a skill is badly written or ambiguous, the agent will follow it badly. The quality of the catalogue is the quality of the result — there is no layer in between that corrects it.

## The tools

The server exposes **seven**. Five are read-only; two write, and only ever as pending proposals a person reviews — `propose_skill` for a new convention, `propose_revision` for a change to an existing one. The pattern is progressive disclosure: search cheaply first, then fetch only what is needed.

### search_skills

Find the convention that applies to the task you are about to do. The most used one: the agent calls it before writing code, on every task. That is why its response is cheap — titles and descriptions, no contents.

| Parameter | Type | | Detail |
| --- | --- | --- | --- |
| `query` | string | required | The task in natural language, in English. e.g. `"action button in a form"` |
| `stack` | angular · java · shared · infra | optional | Restrict to one stack |
| `type` | skill · convention · reference | optional | Restrict to one type |

**Returns:** up to 5 candidates with slug, title, `when_to_use`, and the usage signals (`uses_90d` and `people`) so the agent can break ties. If nothing matches it returns empty and records the search as a missing convention.

### get_skill

Fetch the full contents of the skill the agent already picked. Always after `search_skills`, with the slug it returned. Never blindly: guessing slugs wastes calls.

| Parameter | Type | | Detail |
| --- | --- | --- | --- |
| `slug` | string | required | Exactly as `search_skills` returned it |
| `version` | number | optional | A specific version; defaults to the latest |

**Returns:** the full markdown, with tags and version, plus `file` (the skill as a self-contained `.md`) and `save_as` (a relative path) for the local copy. The preview block is stripped. If the skill is deprecated it returns the replacement slug instead of the contents.

### sync_skills

Bring the local `.skill-hub/` copies up to date in a single call. At the start of a session, instead of re-fetching each skill to check it.

| Parameter | Type | | Detail |
| --- | --- | --- | --- |
| `have` | `{ slug, version }[]` | required | Every local copy, with the `version` its frontmatter states. Max 100 |

**Returns:** per slug, its state — `current` (leave it), `stale` (overwrite with the returned `file`), `deprecated` (delete it and fetch `superseded_by`) or `gone` (delete it). It does not count as usage.

### list_skills

See the full index of what exists. To get your bearings, not to solve a concrete task — for that `search_skills` is better.

| Parameter | Type | | Detail |
| --- | --- | --- | --- |
| `stack` | angular · java · shared · infra | optional | Restrict to one stack |
| `type` | skill · convention · reference | optional | Restrict to one type |

**Returns:** slug, title, `when_to_use` and `version` of every skill. No contents. Provisional entries (proposed by an agent, not yet reviewed) are included and carry `provisional: true`.

### get_port_registry

Find which port a service should use without taking another team's range. Before spinning up a new service or writing a docker-compose.

| Parameter | Type | | Detail |
| --- | --- | --- | --- |
| `service` | string | optional | Filter by service or team. Without a filter it returns the whole registry |

**Returns:** the registry lines matching the filter, or the full table. If no registry has been loaded yet, an empty `teams` list with a note — not an error.

### propose_skill

Fill a gap when no convention exists for the task at hand. Only when `search_skills` returned nothing. The proposal is served to other agents immediately, marked as provisional. If a close match already exists the call is refused and returns it with a similarity score; a borderline overlap is accepted as provisional and the admin decides at review time.

| Parameter | Type | | Detail |
| --- | --- | --- | --- |
| `title` | string | required | Short noun phrase, in English |
| `description` | string | required | One sentence, max 200 chars |
| `when_to_use` | string | required | Situations and synonyms, max 200 chars |
| `stack` | angular · java · shared · infra | required | Which side it applies to |
| `content` | string | required | Markdown starting with `## Rule` |
| `from_query` | string | required | The search that returned nothing |
| `rationale` | string | required | What the rule was based on. An admin reads this |
| `type` / `tags` / `slug` | optional | | The slug is derived from the title if omitted |

**Returns:** the slug it created, or a rejection carrying the close match and its `similarity`.

### propose_revision

Propose a change to an existing convention that is wrong, incomplete or outdated. It does not touch the published version: it creates a **pending revision** that shows up in the review queue, with a diff against what is published, for an admin to accept (which bumps the version) or discard. Until then `get_skill` keeps returning the published version, now flagged `pending_revision: true` so other agents do not propose the same thing again.

| Parameter | Type | | Detail |
| --- | --- | --- | --- |
| `slug` | string | required | The convention to change |
| `base_version` | integer | required | The `version` `get_skill` returned. Rejected as stale if it moved since |
| `content` | string | required | The full new body, Markdown starting with `## Rule`. Not a diff |
| `rationale` | string | required | Why the change is needed. An admin reads this |
| `title` | string | optional | Only if the display name changes |
| `new_slug` | string | optional | Rename. On approval the old slug becomes a `deprecated` redirect (`superseded_by` the new one), so local `.skill-hub/` copies reconcile on the next `sync_skills` |
| `description` / `when_to_use` / `tags` / `stack` / `type` | optional | | Only the ones that change |

**Returns:** the pending version number (plus `renamed_to` when `new_slug` was given), or a rejection (stale `base_version`, a revision already pending, unknown slug, not published, `new_slug` already in use).

Neither tool edits or publishes directly, on purpose. If an agent could publish, a hundred agents would generate near-duplicates and half-baked edits faster than any admin could review them. Everything that becomes a real decision goes through this web app, through a person.

## The rules

**One skill per problem.** If something similar exists, propose a change there. When creating a new one, the app warns you before you write the body. You can create it anyway, but it asks for a justification the admin reads at approval time.

**Versions are never overwritten.** Every change creates a new version. Previous ones stay intact and can be compared. Rolling back is one click.

**Nothing becomes a decision without approval.** A skill starts as a draft, or as a provisional proposal if an agent wrote it. An admin publishes it. Since everyone always reads the latest version, a bad change would reach 100 people instantly: approval is the counterweight.

**Deprecating points at the replacement.** A deprecated skill stops appearing in searches, and agents holding the old slug receive a pointer to the new one. They correct themselves.

## What is recorded

Two different things, with different rules:

**Change audit.** Who created, edited, published or deprecated what, and which fields they touched. Kept forever, visible to admins in Audit. The identity is frozen into the event, so the record stays readable even after an account is removed.

**Usage telemetry.** Which skill was consulted and from which team, so we know which ones are really used and which should be deprecated. **Per-person detail is deleted after 90 days** and only per-skill and per-team totals remain. The app never shows who consulted what: it shows "looked up 47 times by 9 people".

Searches that **found nothing** are recorded too. That list is the most valuable signal in the system: the ranked inventory of the conventions we still need to write.
