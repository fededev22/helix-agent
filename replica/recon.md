# Recon map: Claude Code (terminal / agentic coding harness)

Scope: Core interactive coding loop — session UI, tools (files/search/shell), permissions, project instructions, slash commands. Not Desktop, Web cloud VMs, IDE plugins, enterprise gateways, or Anthropic-hosted review products.
For: A clean-room coding agent product (Helix) for developers who want a local-feeling agent harness in the browser.
Date: 2026-11-21

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Official overview | https://code.claude.com/docs/en/overview | Surfaces, install, what you can do |
| 2 | How it works | https://code.claude.com/docs/en/how-claude-code-works | Agentic loop, tools, sessions, permissions |
| 3 | Features / extend | https://code.claude.com/docs/en/features-overview | CLAUDE.md, skills, MCP, hooks, subagents |
| 4 | CLI reference | https://code.claude.com/docs/en/cli-reference | `claude`, `-p`, continue/resume |
| 5 | Docs index | https://code.claude.com/docs/llms.txt | Full public surface map |
| 6 | Permissions | https://code.claude.com/docs/en/permissions | Modes and ask-before-act |

Public docs only. No private APIs, no bundled source, no account scraping.

## Core loop

User describes a coding goal → agent gathers context (search/read) → takes action (edit/run) → verifies → streams tool activity → asks before risky actions → user steers mid-flight.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Session terminal | `/` or `claude` in cwd | Primary chat + tool stream | transcript, prompt, status line, permission chip | empty, streaming, waiting-permission, error |
| S02 | Permission prompt | inline in S01 | Approve/deny tool call | tool summary, allow once, allow always, deny | pending, resolved |
| S03 | Slash command palette | type `/` in prompt | Discover commands | command list, descriptions | filtered, empty |
| S04 | Context / status | `/context` or status line | Show what fills context | bars, file list | compacting, full |
| S05 | Resume picker | `/resume` or `--resume` | Pick prior session | session list, names | empty, filled |
| S06 | Project instructions | open `CLAUDE.md` / `/init` | Persistent project rules | markdown editor/viewer | missing, present |
| S07 | Plan mode view | permission mode Plan | Read-only exploration + plan | plan markdown, no write tools | drafting, ready |
| S08 | Diff / edit preview | after file edit tool | Show proposed change | unified diff | single file, multi |

## Flows

```
F01 Interactive coding task (core)
    S01 prompt -> tool stream (read/search) -> S02 if needed -> edits -> verify (bash/tests) -> reply
    happy path clicks: 1 (send) + optional 1–n approvals
    edge: interrupt, queued follow-up, tool failure, permission deny

F02 One-shot / pipe style
    CLI `-p` equivalent: single prompt, tools, exit with answer
    edge: no TTY, JSON/text out

F03 Resume session
    S05 pick session -> S01 continues under same id
    edge: wrong directory, forked session

F04 Init project instructions
    S01 /init -> S06 generate starter instructions -> saved to project root
    edge: AGENTS.md already present

F05 Cycle permission mode
    S01 Shift+Tab / chip -> Manual | Accept edits | Plan | Auto
    edge: Plan blocks writes; Accept edits still asks for shell
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Transcript message | user, assistant, system | streaming, done, error | S01 |
| Tool call card | read, write, edit, bash, grep, glob | running, success, failed, pending-approval | S01, S02 |
| Prompt input | multiline | idle, queued, disabled-while-streaming | S01 |
| Status line | model, mode, cwd, context % | compacting | S01, S04 |
| Permission dialog | allow/deny/always | pending | S02 |
| Slash menu | built-in commands | filtered | S03 |
| Diff viewer | unified | collapsed, expanded | S08 |

## Inferred data model

```
Session     id, project_path, title, created_at, updated_at, permission_mode, model
            evidence: sessions docs, resume picker
            confidence: high

Message     id, session_id, role (user|assistant|system), content, created_at
            evidence: JSONL under ~/.claude/projects/
            confidence: high

ToolCall    id, message_id, name, input_json, output, status, approved
            evidence: tool stream in how-it-works
            confidence: high

Checkpoint  id, session_id, file_path, before_content, created_at
            evidence: checkpointing / Esc Esc rewind
            confidence: high

ProjectMemory  path (CLAUDE.md / MEMORY.md), content, scope (project|user)
            evidence: memory docs
            confidence: high
```

Relationships: Project 1-n Session, Session 1-n Message, Message 1-n ToolCall, Session 1-n Checkpoint.

## Feature matrix

See `features.csv`. Must: 12, should: 8, could: 6, skip: 7.

## Out of scope (cannot or should not be cloned)

- Anthropic model brands, logos, Claude trademark, product name "Claude Code"
- Anthropic-hosted cloud VMs, billing, subscriptions
- Official VS Code / JetBrains marketplace extensions (rebuild patterns only)
- Enterprise SSO / Claude apps gateway
- Partner MCP catalogue as a proprietary marketplace
- Proprietary training data / system prompts
- App Store / Play listings copy

## Size

Screens 8, flows 5, entities 5. Hard parts: safe sandboxed shell, permission UX, streaming tool loop, context compaction. Size: L for full parity; this build targets **S vertical slice** (F01 + permissions + instructions + slash commands in a web terminal).
