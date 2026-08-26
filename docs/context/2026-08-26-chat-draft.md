# Source: Grok Chat draft (25 Aug 2026)

Unverified. Kept as spirit, not as specification. Corrections live in `2026-08-26-working-model.md`.

---

**ProjThread – Consolidated Context**  
*(as of 25 Aug 2026)*

### Vision
ProjThread is a multi-tenant, agent-native project management and knowledge system.  
It is the evolution of the old `dotproj` + `knowkey`, purpose-built so that **humans and AI agents (Grok Bots, Grok Build, Cursor, etc.) can collaborate as first-class participants**.

Primary initial use: your personal build workspace for the farm/egg-production systematization project and the José Gabriel Gruber Consultoria. Designed to scale to multiple organizations later.

### Core Hierarchy
```
Organization          ← tenant boundary (multi-tenant)
  └── Project
        ├── Task
        │     └── Thread (group chat)
        └── Node (knowledge)
```

- **Organization** – top-level tenant  
- **Project** – the real working unit  
- **Task** – actionable item with short summary + status  
- **Thread** – dedicated live group chat for that task (humans + bots)  
- **Node** – durable, structured knowledge (decisions, research, processes, etc.)

### Key Design Decisions

**1. Tasks vs Nodes**
- Tasks stay **shallow**: title, short summary, status, owner, acceptance criteria, links.
- Heavy content is promoted to **Nodes**.
- Every non-trivial task links to one or more Nodes.

**2. Threads**
- One Durable Object per Task = the group chat.
- Participants: you, Chief of Staff bot, Grok, Grok Build, Cursor, other specialist bots.
- Comments/discussion live here. Important outcomes are promoted to Nodes.

**3. Chief of Staff Bot**
- Orchestrator that manages the board.
- Creates/updates tasks, runs planning, assigns work to specialist bots, promotes content to Nodes, moves status to “Ready for Approval”, monitors progress.

**4. Identity & Access (IAM)**
- **Application plane** (normal work):
  - Humans → Google OAuth
  - Bots/Agents → scoped API tokens (Bearer)
- **Admin / Tenant-management plane**:
  - Protected by **Cloudflare Zero Trust (Access)** only
  - Used for creating/deleting Organizations and other high-privilege operations
- Fully multi-tenant from day one.

**5. Technology Stack (Cloudflare-native)**
- Workers (API + MCP server – using the new 2026-07-28 stateless MCP spec)
- D1 (structured data: orgs, projects, tasks, nodes, users, tokens)
- Durable Objects (one per Task Thread)
- Vectorize (embeddings for semantic search over Nodes)
- R2 (media/files if needed)
- Zero Trust for admin routes

**6. Integration with Grok ecosystem**
- Grok Chat (Android/web) → discusses and creates work via MCP
- Grok Build → primary tool to *build* ProjThread itself, later used as a coding specialist inside it
- Grok Bots → live inside ProjThread as Chief of Staff + specialists
- Cursor → code review / bug-hunt, can join threads via MCP

**7. Status flow (simplified)**
`Backlog → Discussing → Planned → Ready for Approval → In Progress → Review → Done`

### Current Scope Priority
1. Solid multi-tenant foundation (Orgs + Projects)
2. Tasks + Threads + Nodes
3. Basic IAM (Google + bot tokens)
4. Chief of Staff coordination
5. MCP surface so all Grok tools can participate
6. Zero Trust admin plane

This is the full shared context for ProjThread.
