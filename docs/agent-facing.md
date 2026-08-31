# Agent-facing ProjThread

How to use `/mcp`. Tools execute; this file is judgment.

1. **Start** with `session_briefing`. If you have one membership, omit `workspace_id`. If you get `memberships` and no `cards`, call again with a `workspace_id`.
2. **Search then read.** `wiki_search` → `wiki_read`. `card_search` → `card_get`. Do not dump the wiki into context.
3. **File work as a card.** `card_search` first. `card_create` is idempotent on title in a project. Do not invent a second card for the same work.
4. **Working memory is Activity.** `activity_log` (`decision` / `occurrence` / `note`). `activity_recent` before repeating an approach. Stage changes are `card_move` (reason required).
5. **Wiki writes are canonical.** `wiki_write` only after `wiki_read` on that node this turn. Create with `wiki_create` when no page should hold it. Compose vs cite: `compose_node` nests; `cite_node` points; `attach_node_work_item` links a card.
6. **Never:** room/chat tools (they are not here), Vectorize, OAuth, overwriting wiki without a read, using wiki as a diary of failed attempts.

Ids are stable. Names are for search.
