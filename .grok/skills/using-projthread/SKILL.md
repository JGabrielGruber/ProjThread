---
name: using-projthread
description: Use when collaborating in ProjThread via MCP or the PWA — cards, wiki, Activity, session_briefing, Grok Bot /mcp — or when the agent does not already know what ProjThread is. Use when running /using-projthread. Do not use when implementing the ProjThread Worker or editing this repository's source.
---

# Using ProjThread

ProjThread is a **live workspace**. People and agents talk in a **room**. Each piece of work is one **card**; opening the card *is* the room. Not Jira. Not a wiki dump.

This MCP server is catalog + wiki. **Chat is not here.** Do not look for room or message tools.

## Why three stores

Densities stay distinct so neither a board nor the model context eats the conversation.

| Layer | Holds | Answers |
| --- | --- | --- |
| **Wiki** (node) | Reusable knowledge: how we do X, architecture, policy | "How do we do auth here?" |
| **Card** (work item) | The work: title, stage, project | "Is this open, and where?" |
| **Activity** | Working memory on that card: `decision`, `occurrence`, `note`, plus stage moves | "We rejected X because Y." |

About this card and belongs on its timeline → **Activity**. Must be found from other work or reused → **wiki**. Do not grow Activity into a second wiki. Do not use wiki as a diary of failed attempts.

**1:1:** one card, one room, same id. Do not invent a second task object.

## Place

Organization → **Workspace** (the place: members, stages, wiki) → **Project** forest → cards. Wiki nodes live on the workspace and link to cards. Workspace ≠ Project. Spanning work sits on the ancestor project.

Ids are stable. Names are for search.

## How to work

1. **Start** with `session_briefing`. One membership: omit `workspace_id`. If you get `memberships` and no `cards`, call again with a `workspace_id`.
2. **Search then read.** `wiki_search` → `wiki_read`. `card_search` → `card_get`. Do not dump the wiki into context.
3. **File work as a card** after `card_search`. `card_create` is idempotent on exact title in a project. Do not duplicate.
4. **Log working memory** with `activity_log`. `activity_recent` before repeating an approach. Stage changes are `card_move` (reason required).
5. **Wiki writes are canonical.** `wiki_write` only after `wiki_read` on that node this turn. `wiki_create` when no page should hold it. `compose_node` nests; `cite_node` points; `attach_node_work_item` links a card.

Never: Vectorize, OAuth, overwriting wiki without a read this turn, a second card for the same work.
