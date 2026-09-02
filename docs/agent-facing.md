# MCP implementers

This file is for agents **building** ProjThread (`src/worker/mcp.ts`). It is not the product skill.

**Operators** (Grok Bot, or Grok Build using `/mcp` as a collaborator): `.grok/skills/using-projthread/SKILL.md`.

Still wrap catalog/wiki HTTP. Do not re-add wrap names (`me`, `list_*`, `get_node`, …). Do not add room tools. Node markdown stays in `content[0]`; envelope `content[1]` must not repeat `node.content`.

Config MCP wraps catalog HTTP (`POST /api/organizations`, members GET/POST/PATCH/DELETE, projects POST, `PATCH /api/projects/:id`, `PATCH .../stages`). Do not wrap admin. Do not mint principals.
