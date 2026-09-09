package com.skillhub.mcp;

/**
 * Puerto verbatim de src/server/mcp/instructions.ts.
 *
 * Es lo que el servidor entrega en el initialize y lo que hace que el agente
 * consulte el catalogo SOLO. Va al frente del prompt y tiene que ser byte a
 * byte identico entre requests para ser cacheable: nada dinamico aca dentro.
 */
public final class McpInstructions {

    private McpInstructions() {}

    public static final String SERVER_INSTRUCTIONS = """
This server is the canonical catalogue of engineering conventions for this organisation: how the Angular frontend is written, how the Java backend is written, what shape errors take, which ports each team owns.

BEFORE writing or modifying any Angular or Java code in this organisation, call `search_skills` with a natural-language description of the task you are about to do. The user does not need to ask for it and does not need to name a skill: consulting the catalogue is part of doing the work correctly here.

Search in English. The catalogue is written in English and the index stems English, so an English query matches far better than a translated one - even when the conversation with the user is in another language.

Examples of when to search:
- "add a save button to this form"        -> search_skills("action button in a form")
- "create a new Spring endpoint"          -> search_skills("endpoint naming and structure")
- "handle the error from this HTTP call"  -> search_skills("API error shape")
- "spin up a new service"                 -> get_port_registry()

How to use the results:
1. `search_skills` returns at most 5 candidates with their `when_to_use`, plus `uses_90d` and `people`: how often each skill is consulted and by how many distinct people. Use that signal to break ties - a skill 24 people rely on is more canonical than one used by 2.
2. Pick the one that applies and fetch its full contents with `get_skill`.
3. Follow it. These conventions exist so that 11 teams write the same code; departing from them has a real cost.

Keep the skills you fetch as local reference files:
1. Before searching, look for a `.skill-hub/` folder at the project root and read any `.md` files in it. A skill you already have locally may answer the task with no call.
2. After every `get_skill`, write the response's `file` field verbatim to the relative path in `save_as`, creating `.skill-hub/` if needed.
3. If that file already exists, compare its frontmatter `version:` with the `version` in the response. Overwrite only when the catalogue's is higher; if they are equal, leave the file untouched.
4. Once per session, if `.skill-hub/` has files, call `sync_skills` with every one as { slug, version } from its frontmatter. Apply what it returns: overwrite the `stale` ones with their `file`, delete the `deprecated` and `gone` ones. This is cheaper than re-fetching each skill to check it.

These files are a cache, not the source of truth: the catalogue always wins. Never edit them by hand and never propose changes from them.

If `get_skill` returns a deprecated skill, the response carries the slug of its replacement: use that one, not the old slug.

If `search_skills` returns nothing, there is no convention for this yet — and that gap is not neutral. If you simply improvise, the next person on another team improvises differently, and six months later there are eleven ways of doing the same thing. That is exactly what this catalogue exists to prevent.

So when a search comes back empty and you are going to solve the problem anyway:
1. Read `get_skill("writing-skills")` first — it defines what a usable entry looks like.
2. Solve the task.
3. Call `propose_skill` with the rule you actually followed. Be honest in `rationale` about what you based it on: the surrounding codebase, a related skill, or general practice because there was nothing to infer from. An admin reads that to decide how much to trust it.
4. Tell the user you added a provisional convention and that nobody has reviewed it yet.

The proposal is served to other agents immediately, so the organisation converges from day one, but it travels clearly marked as provisional until a person reviews it. If a close match already exists, the call is refused and returns it with a similarity score — follow that one instead of creating a near-duplicate.

If an existing convention is wrong, incomplete or outdated, do not just tell the user: call `propose_revision` with its slug and the `version` you got from `get_skill`. That creates a pending revision an admin accepts or discards — the published version does not change in the meantime, and `get_skill` will report `pending_revision: true` so other agents do not propose the same thing again. `propose_revision` can also rename a convention: pass `new_slug` (and `title`); once accepted the old slug keeps redirecting.

Publishing a skill, and accepting a revision, still goes through a person in the web app.""";
}
