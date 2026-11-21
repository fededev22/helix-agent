# Helix Agent

Coding agent harness with Claude (and optional OpenAI / OpenRouter) tool loops, permission modes, project instructions (`HELIX.md`), slash commands, and a sandboxed workspace.

**GitHub:** [fededev22/helix-agent](https://github.com/fededev22/helix-agent)

## Features

- Interactive agent UI (transcript, tool cards, permissions)
- Models: Claude Sonnet / Opus / Haiku, GPT via OpenAI or OpenRouter, plus offline **demo**
- No app-side rate limits — usage follows the provider key you attach
- Tools: list, read, write, grep, glob, safe bash stand-ins (no `child_process`)
- Modes: `manual` · `accept_edits` · `plan`
- Sessions: resume / new, UUID-safe storage

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317).

Optional env (never commit values):

| variable | purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude models |
| `OPENAI_API_KEY` | GPT-4o mini direct |
| `OPENROUTER_API_KEY` | GPT-4o and others via OpenRouter |

Without keys, Helix uses the offline demo agent (try **fix the counter bug**).

## Security notes

- Session IDs must be UUIDs
- Approvals are enforced server-side against pending tools only
- File tools stay under `replica/sandbox`
- Shell tool is pure JS (`ls` / `pwd` / `cat` / `head` / `wc`) — no node/npm exec
