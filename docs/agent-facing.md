# MCP implementers

This file is for agents **building** ProjThread (`src/worker/mcp.ts`). It is not the product skill.

**Operators** (Grok Bot, or Grok Build using `/mcp` as a collaborator): `.grok/skills/using-projthread/SKILL.md`.

Still wrap catalog/wiki HTTP. Do not re-add wrap names (`me`, `list_*`, `get_node`, …). Do not add room tools. Node markdown stays in `content[0]`; envelope `content[1]` must not repeat `node.content`. Blob bytes are HTTP `GET /api/nodes/:id/blob` (Bearer), not `/mcp`. Envelope keeps `mime_type` / `byte_size` / `filename` and strips `blob_key`. `wiki_create` is markdown|json, not blob. `attach_node_project` wraps `POST /api/nodes/:id/projects`.

Config MCP wraps catalog HTTP (`POST /api/organizations`, members GET/POST/PATCH/DELETE, projects POST, `PATCH /api/projects/:id`, `PATCH .../stages`). Notify MCP wraps subscription HTTP (`GET/POST /api/workspaces/:ws/notify-subscriptions`, `PATCH/DELETE …/:id`) as `notify_list` / `notify_add` / `notify_set` / `notify_remove`. The doorbell consumer is the Worker `queue` handler, not `/mcp`. The webhook body is not a tool. Do not wrap admin. Do not mint principals.
