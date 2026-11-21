# Architecture: Helix (Claude Code core-loop clone)

## Stack

| layer | choice | why |
| --- | --- | --- |
| web app | Next.js App Router + TypeScript | browser surface for Cloud Agent demo; familiar |
| styling | Tailwind + design tokens | maps cleanly from replica-design |
| UI primitives | shadcn/ui | dialogs, buttons, scroll areas without hand-rolling |
| agent runtime | Route Handler + in-process tool loop | no extra services for the vertical slice |
| workspace | sandboxed `replica/sandbox` directory | real file tools without exposing the host |
| persistence | local JSON under `.helix/` in sandbox | sessions without a database for S slice |
| LLM | optional `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`; otherwise demo agent | works offline with a scripted loop |

One process. No microservices. No auth product yet (local single-user).

## Schema (JSON documents for slice; SQL later)

```sql
-- Target schema when backend hardens; slice uses JSON files mirroring this.
create table sessions (
  id uuid primary key,
  project_path text not null,
  title text not null default 'Untitled',
  permission_mode text not null check (permission_mode in ('manual','accept_edits','plan')),
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messages (
  id uuid primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index on messages (session_id, created_at);

create table tool_calls (
  id uuid primary key,
  message_id uuid not null references messages(id) on delete cascade,
  name text not null,
  input jsonb not null,
  output text,
  status text not null check (status in ('pending','running','awaiting_approval','done','error','denied')),
  created_at timestamptz not null default now()
);

create table checkpoints (
  id uuid primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  file_path text not null,
  before_content text not null,
  created_at timestamptz not null default now()
);
```

Access: all tools resolve paths under the sandbox root; path traversal denied.

## API (App Router)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| POST /api/chat | run agent turn (SSE) | local | sessionId, message, mode | stream events | F01 |
| GET /api/session | list / get session | local | id? | session + messages | F03 |
| POST /api/session | create session | local | title? | session | F01 |
| POST /api/permission | approve/deny tool | local | toolCallId, decision | ok | F01 |
| GET /api/files | list sandbox tree | local | path? | tree | S01 side |
| GET /api/helix-md | read project instructions | local | — | markdown | F04 |
| POST /api/helix-md | write /init content | local | content | ok | F04 |

## Parts that bite

- Path traversal on every file tool
- Shell must be allowlisted / cwd-locked (demo: simulated or restricted)
- Permission race if user denies after start
- Streaming backpressure for long tool outputs
- Context growth — `/compact` summarizes locally

## Build order

1. **Vertical slice:** S01 + tools against sandbox + S02 permissions + HELIX.md + slash commands
2. Must-haves from features.csv
3. Should-haves: resume, checkpoints, diffs
4. Entrepreneur fixes later

Milestone 1 screens: S01, S02, S03, S06. Tables: sessions, messages, tool_calls. Routes: chat, session, permission, helix-md, files.
