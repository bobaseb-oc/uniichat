Legion
======

OnCorps' local AI agent: one chat that never ends, run on your own Mac,
through the OnCorps LiteLLM gateway. You talk to the same orchestrator
for days or weeks and it remembers. It hands the work to a crew of
managers and workers that run shell commands, edit repos and drive
Claude Code on your machine, under the same OnCorps guard hooks Claude
Code uses.

**AI agents wrote and reviewed most of this code.** Treat it as an
internal tool, not a product: read it before you trust it.

How it works
------------

- **One chat, a memory tree.** Every message gets a one-line summary,
  and neighbouring lines merge in pairs, again and again, into a binary
  tree. Each call sees the whole chat in at most 128 KB: recent
  messages a line each, older ones under fewer, broader lines. Detail
  fades with age, but nothing is deleted.
- **Zoom.** The agent can open any line into the two it was made from,
  down to the original message, so the past is never thrown away.
- **Built in the background.** A cheaper model (the compactor, Haiku by
  default) writes the summaries as messages arrive. A turn waits for the
  summaries before it, 60 s at most, then goes on with the missing ones
  marked "(not summarized yet)". While it waits, the status says why
  ("compressing earlier messages… (compactor: HTTP 429 …)").
- **A crew, not one agent.** The orchestrator does no hands-on work. It
  spawns managers, managers spawn workers (or Claude Code workers), and
  each agent has a title, repos and a todo list. The web's Crew view and
  the terminal's `/crew` show the tree; questions the orchestrator has
  for you wait in a Questions pane.
- **Claude Code parity.** Device tools are shell, read, write, edit,
  glob and grep, each passed through the Claude Code PreToolUse and
  PostToolUse hooks in your managed, user and project settings (so the
  OnCorps guard blocks here too). `!cmd` runs a shell command yourself.
  Permission modes are plan (read-only), auto (a cheap-model reviewer
  checks each change; anything it can't decide comes to you) and full.
  Shift+Tab cycles them.
- **Every window is a view.** The server owns the chat. A browser tab
  or `legion` in a terminal shows it live, and any of them can send a
  message, stop the work or change the model.

The design is in the header comment of each file. Start with Memory.ts
(the tree and the view), Server.ts (the chat and its turns), Tools.ts
(agents and tools) and AskAI.ts (model calls and the cache).

Run it
------

You need [Bun](https://bun.sh), the gateway's `LITELLM_API_BASE` and
`LITELLM_API_KEY` in your environment, and optionally Docker (for web
search through a local SearXNG).

    local/legion              # starts the server if needed, opens the chat
    local/legion web          # the web UI, signed in as your terminal
    local/legion stop         # stops the server and SearXNG
    local/legion log          # the server's log (sign-in links print here)

The header of local/unii-local.sh lists the rest (device, knowledge,
mcp-login). Symlink it onto your PATH as `legion`. The server only
listens on 127.0.0.1:8788, and the terminal only opens loopback servers.

    bun run test              # the tests, each file on its own
    bun run web               # rebuilds web/app.js from web/src

Your chat lives in ~/.unii/users/<id>, one JSON line per message
(main/) and per summary (tree/). That is the memory: back it up.

Config
------

`~/.unii/config.json` (optional; the dir is `$UNII_DIR`). Each key can
also be set as `UNII_<KEY>`. The ones that matter here:

- `anthropic_url`: the Claude API origin (local/legion points it at
  the gateway).
- `pick`: what the chat runs on, `vendor:model:effort:speed` (default
  `claude-api:sonnet-5.5:medium:slow`).
- `compactor`: what writes the summaries and reviews auto-mode changes
  (default `claude-api:haiku-5.5:high:slow`).
- `agents`: what sub-agents run on (default: the chat's pick).
- `work`: the agents' working dirs (default ~/.unii/work).
- `rules`: a file appended to every system prompt; local/rules.md
  imports your ~/.claude/CLAUDE.md and the skills index.
- `mcp`: a JSON file of MCP servers whose tools the agents get
  (local/mcp.ts makes one; `legion mcp-login atlassian` keeps the
  OAuth grant in the Keychain).
- `searches`: 0 turns off the vendor's web search (Bedrock behind
  LiteLLM rejects it); `searxng_url` is the local search instead.
- `after`: a shell command run after each turn.

Today's LiteLLM spend shows in the status line when a cost cache is
kept (Cost.ts reads it; it never calls the gateway itself).

Gaps
----

What is known not to work, or not checked yet:

- **Sign-in is a magic link printed to the server log.** No SSO. It is
  safe only because the server is loopback-only and single-user.
- **Atlassian OAuth (commit 36e97d8) was merged as a draft.** It is a
  Red Zone change that no one has reviewed yet.
- **No web fetch.** The vendor's fetch tool doesn't work on Bedrock,
  and there is no replacement yet. Search goes through SearXNG only.
- **The gateway's budget stops the compactor.** Over budget, summaries
  stop. Turns now go on after 60 s with lines unsummarized, but the
  tree only catches up once the budget is back.
- **Not checked live yet:** recall over the imported history, a turn
  with the gateway down (the 60 s go-ahead and the shown reason), the
  auto-mode reviewer on the real gateway, sub-agents getting their own
  worktrees when their edits could collide.
- **Three tests fail** (`link_ask` and two `logs` tests) and have done
  so since before the OnCorps work. `tsc` reports only missing Bun type
  definitions.
- **Upstream names stay in the data and code.** ~/.unii, `UNII_*`
  settings, the package name `uniichat`, the AI's own name "Unii" in its
  prompt, and the `unii` command (an alias of `legion`).
- **ios/ isn't built or used.** Phones are off by default and the app
  still points at upstream's hosted service.
- Upstream's hosted-service parts are still in the code but not used
  here: billing (Billing.ts), emailed sign-in links (Resend), multiple
  worker processes, iOS push and the OpenAI vendor.

Origin
------

Legion is a fork of [uniichat](https://github.com/VictorTaelin/uniichat)
by Higher Order Company, used under the Apache License 2.0. The OnCorps
changes, on top of upstream's main:

- runs on the LiteLLM gateway, loopback-only, with no telemetry,
  installer or self-update;
- local web search (SearXNG), MCP tools with Keychain OAuth, live rules
  and the skills index, import of redacted Claude Code and Codex history;
- the agent hierarchy (orchestrator, managers, workers, Claude Code
  workers), the Crew view, agent labels and todo lists, the questions
  backlog;
- Claude Code hooks on device tools, glob and grep, `!cmd`, plan, auto
  and full permission modes, notifications with their own sound, and
  the web status line;
- renamed UniiChat to Legion.

`git log` has the details; tasks/todo.md has the plan and proof of each
step.

License
-------

Apache-2.0 (LICENSE). Copyright 2026 Higher Order Company; OnCorps
changes as described in Origin.
