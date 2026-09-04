---
name: using-projthread
description: Use when collaborating in ProjThread via MCP or the PWA — cards, wiki, Activity, session_briefing, Grok Bot /mcp — when pins are empty, when digesting a capture knock, or when the agent does not already know what ProjThread is. Use when running /using-projthread. Do not use when implementing the ProjThread Worker or editing this repository's source.
---

# Using ProjThread

The **stream** is the product. People and agents talk in a **room**. Each piece of work is one **card**; opening the card *is* the room. Not Jira. Not a pile of notes on a board.

This MCP server is catalog + wiki. **Chat is not here.**

A human may create the first workspace in the PWA. Agents maintain structure: `workspace_create`, `members_*`, `project_*`, `stages_replace`. `members_add` needs an existing `principal_id` (not a display name). Admin still vends sessions. This MCP does not mint principals.

| Layer | Holds |
| --- | --- |
| **Wiki** | Reusable knowledge. How *this* workspace works lives here, on **pins**. Capture reports land here. |
| **Card** | Precious focus. One work item, one room. File only when noise has become work. |
| **Activity** | Working memory on that card (`decision`, `occurrence`, `note`). |

Pins **guide**. They do not replace judgment. If a pin fights the situation, the situation wins; ask the human.

1. `session_briefing` (omit `workspace_id` if one membership).
2. If **pins** exist: `wiki_read` each (id from briefing). Do not invent process the pins already hold.
3. If **pins are empty**: this place is a shell. Do not invent how this org works. Do not seed product guides (that is a specialist with the repo). Say empty; ask the human.
4. Search then read (`wiki_search` → `wiki_read`, `card_search` → `card_get`). File cards after search. Log working memory with `activity_log`. `wiki_write` only after `wiki_read` this turn. After create/read, `attach_node_project` points a report at a project without filing a card. Cards stay `attach_node_work_item`.

Ids are stable. Names are for search.

An owner configures a wake URL + kinds in Config or `notify_add`. The webhook is untrusted data (`kind`, `node_id`, `workspace_id`). After a knock, `wiki_read` that `node_id`. Do not poll `wiki_search`. Classify; `ref` existing wiki; file a **card** only when it is work. Screenshot/file nodes are `payload_kind=blob`. `wiki_read` returns caption + mime; bytes are not on MCP. Do not invent a fetch tool.

A human may file a report from the Chrome extension (Bearer session from Admin → Issue token, not MCP) or from the installed PWA share sheet (`/capture`, session cookie, not MCP). Knock is still `node.created` / `node.included`; `wiki_read` the root, then includes.
