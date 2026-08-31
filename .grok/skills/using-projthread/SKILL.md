---
name: using-projthread
description: Use when collaborating in ProjThread via MCP or the PWA — cards, wiki, Activity, session_briefing, Grok Bot /mcp — or when the agent does not already know what ProjThread is. Use when running /using-projthread. Do not use when implementing the ProjThread Worker or editing this repository's source.
---

# Using ProjThread

ProjThread is a **live workspace**. People and agents talk in a **room**. Each piece of work is one **card**; opening the card *is* the room. Not Jira.

This MCP server is catalog + wiki. **Chat is not here.**

| Layer | Holds |
| --- | --- |
| **Wiki** | Reusable knowledge. How *this* workspace works lives here, on **pins**. |
| **Card** | The work: title, stage, project. |
| **Activity** | Working memory on that card (`decision`, `occurrence`, `note`). |

1. `session_briefing` (omit `workspace_id` if one membership).
2. `wiki_read` each **pin** (id from briefing). Do not invent process the pins already hold.
3. Search then read (`wiki_search` → `wiki_read`, `card_search` → `card_get`). File cards after search. Log working memory with `activity_log`. `wiki_write` only after `wiki_read` this turn.

Ids are stable. Names are for search.
