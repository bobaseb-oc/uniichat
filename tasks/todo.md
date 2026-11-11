# UniiChat local: LiteLLM + primed memory tree

Plan: ~/.claude/plans/can-you-make-me-idempotent-waterfall.md

## Patches (branch local/litellm)
- [x] Tests first: `Local.test.ts` (anthropic_url config, Term default URL, update refused)
- [x] `Config.ts`: `anthropic_url` key (UNII_ANTHROPIC_URL), default https://api.anthropic.com
- [x] `Anthropic.ts`: messages and count_tokens URLs from `ANTHROPIC_URL`
- [x] `Term.ts`: default server http://127.0.0.1:8788; `update` refuses
- [x] `bun run test` passes; new tests fail with the patches reverted

- [x] `searches` config (UNII_SEARCHES=0): Bedrock behind LiteLLM rejects web_search_20260318

- [x] Hard block: loopback-only server, telemetry removed, installer refused, guard test
- [x] `search` tool: Search.ts on a local SearXNG (Docker, pinned digest, 127.0.0.1:8888)

## Run locally
- [x] Smoke test: LiteLLM /v1/messages + /v1/messages/count_tokens with x-api-key (status only)
- [x] `local/unii-local.sh` wrapper (serve, stop, default: start + terminal)
- [x] Alias in ~/.zshrc
- [ ] Server starts, sign-in, "hi" answered by Opus 5.5

- [x] Live rules: `@`-imports in `rules`; local/rules.md imports ~/.claude/CLAUDE.md + repo-file instruction
- [x] Skills index (local/skills.ts → ~/.unii/skills.md, 66 skills) imported by the rules
- [x] Rules: subagents get a git worktree only when their edits could collide (local/rules.md "Parallel work in git repos")
- [x] `stop` tool for the main agent (a `tell` "STOP" only reads between tool calls, so 3 hung agents could not be ended)
  - [x] Tests first (Tools.test.ts): stops the named, says which were not at work, refused to a subagent, listed for main only
  - [x] Tools.ts: `stop` spec in BOSS, `case "stop"` → Tools.stop; suite passes; tests fail with it reverted
  - [x] Proof: 3/3 Tools tests, suite 117/117; guard or stop call removed each fails a test
  - [ ] User: restart the server (`unii stop`, then `unii`) to load it
- [ ] Live check: two subagents editing one throwaway repo → two worktrees, main checkout untouched; one alone → no worktree
- [ ] MCP client, browsers, LSP: see "MCP, browsers, LSP" below
- [ ] Restart server after the import (loads live rules + skills)

## Prime the memory tree
- [x] `local/prime/collect.ts` → manifest.txt (user review)
- [x] `local/prime/redact.ts` + tests → ~/.unii-prime (user check-in)
- [x] `local/prime/export.ts` → ~/.unii-prime/context.json (587 chats)
- [x] `UNII_IMPORT_DIRS`: /import reads only the redacted copy (not ~/.claude, ~/.codex)
- [x] Local estimate: 763 sessions, 9,404 msgs, 10.2 MB ≈ $23.44
- [x] `/import` estimate → user go-ahead → import (running, started by the user; includes instruction files)
- [ ] Recall check

## MCP, browsers, LSP
Plan: ~/.claude/plans/can-you-make-me-idempotent-waterfall.md (check in with the user after each phase)
1. `Mcp.ts` → verify: `bun test Mcp.test.ts`; each test fails with its feature reverted
   - [x] Tests first: fake HTTP server (JSON, SSE), fake stdio server
   - [x] Paging, names (64-char cap, hash suffix, unique), schema cleanup
   - [x] Errors: won't start, missing ${VAR}, timeout, isError, bad JSON; one line, no secret
   - [x] Children: own process groups, killed by `Mcp.end()`; pid-file sweep (start time checked)
   - [x] Proof: 10/10 pass, full suite 72/72; 15 mutations, each fails ≥1 test; no leftover processes
   - Note: tests need `ps` and local ports, so they run outside the Claude Code sandbox
2. Wiring and browsers
   - [x] `local/mcp.ts` → ~/.unii/mcp.json: placeholders + paths into ~/.claude.json (user: read key from json, no Keychain)
   - [x] `Mcp.load`: secrets read at connect, never in env; children get PATH/HOME/locale only
   - [x] Tools: main + subagents get mcp__*, hands don't; Server: per-worker pid sweep, end() on exit
   - [x] claude-mem excluded (shared EXCLUDE); rules line; wrapper `mcp_make`; README `mcp` key
   - [x] local/tools lockfile (26 pkgs, integrity, no scripts), `npm ci --ignore-scripts` (user approved)
   - [x] Flags checked: Playwright origins need `:*` for any port; chrome-devtools telemetry + CrUX off, URL allow-list
   - [x] Live: context7 answers; Playwright page + screenshot image, example.com blocked; chrome-devtools console read, example.com blocked; 0 files in default Chrome profile; 0 processes left; 0 secret hits in mcp.json
   - [x] Proof: 80/80 tests; 4 new mutations each fail a test
   - [ ] User: `unii stop` then `unii` (restart loads MCP); then 0 secret hits in server.log
3. `Lsp.ts` and the `lsp` tool → verify: `bun test Lsp.test.ts`; live on this repo (TS) and a Python repo
   - [x] TS 7 has no tsserver.js, so typescript-language-server can't use it: use `tsc --lsp --stdio` (tsgo), dropped typescript-language-server (lock 26 → 25)
   - [x] Tests first: fake LSP server (split frames, multibyte), each operation, push and pull diagnostics, didChange on mtime, server requests answered, root detection, bad input
   - [x] `Lsp.ts`: one server per (root, language), idle close, children via `Mcp.child`/`Mcp.peer` (shared JSON-RPC, moved out of `Mcp.stdio`)
   - [x] Wiring: `lsp` section in mcp.json (local/mcp.ts), `lsp` tool for main + subagents
   - [x] Bug found by a flaky test: the idle timer could close a server mid-request → `busy` count, test with idle < request
   - [x] Bug found live: pyright 1.1.408 hangs after initialize if the client declares `workspace.workspaceFolders` → dropped; the fake hangs the same way
   - [x] Live: TS (this repo) definition/hover/references/workspaceSymbol/diagnostics < 1 s; Python (agent-foundations) definition 0.8 s, hover, symbols, diagnostics; 0 processes left; 0 files changed in either repo
   - [x] Proof: 89/89 tests; 5 mutations each fail a test
   - [x] pyright told the nearest `.venv` at or above the root (uv workspaces): agent-foundations unresolved imports 4 → 0
   - Later: `Mcp.ts` has the same idle-mid-request pattern (unreachable with defaults)
4. Atlassian OAuth: red zone, user drives
   - [x] Draft on branch `local/atlassian-oauth` (36e97d8): Auth.ts, `unii mcp-login`; spec, invariants I1-I9, checklist in tasks/atlassian-oauth.md there
   - [x] Proof: 99/99 tests; 10 invariant mutations each fail a test; live discovery passes all checks
   - [x] Merged into local/litellm at the user's request (2026-10-20), before the checklist was run
   - [ ] User: run the checklist in tasks/atlassian-oauth.md; answer the scope question

## Ask to import new Claude Code chats at each start
- [x] Tests first: `local/prime/logs.test.ts` (new/grown restaged, unchanged kept, claude-mem and manifest "-" skipped, env secret never staged)
- [x] `local/prime/logs.ts` + shared `stage_log` (redact.ts) and `mem_logs` (collect.ts)
- [x] Term: `UNII_IMPORT_ASK=1` runs the `/import claude` dry run at the first view, silent when nothing is new
- [x] Wrapper: plain `unii` runs `logs_make`, then the terminal with the ask on
- [x] Live: sync 25 restaged / 170 kept in 2.2 s, then 0 / 195 in 0.13 s; the terminal showed "Found 500 new messages … about $1.13 … /import claude go"
- [ ] Not checked live: the silent case (needs nothing new, i.e. after that import)
- [x] Bug (user): a key sent itself and the terminal quit. Cause: Bun 1.3.8 ends a raw stdin at the next key after Bun.file streams (the ask's log scan; a manual /import too). Fix: Term reads import files whole (`import_blob`); guard test; live: key + backspace, terminal stays open, nothing sent
- [ ] Ask user: upgrade Bun 1.3.8 → 1.3.14 (upstream's, per Term.ts note); may fix this and the zip_file hang at the root

## Knowledge import (OKF, graphify guides, repo digests and cards)
- [x] Tests first: `local/prime/knowledge.test.ts` (OKF from git at a branch, guides by name, digest contents/cap/no rules files/no credentials, cards, grouping)
- [x] `local/prime/knowledge.ts` → ~/.unii-prime/knowledge.json; `export.ts` groups cards into one chat (oldest first)
- [x] Found in the real data: OKF keeps copies of the 4 security audits → excluded from every source (AUDITS), with a test
- [x] Proof: 8/8 tests, 3 mutations each fail a test; real run 43 s, 0 skipped; 0 secret env values, 0 key shapes, 0 URL credentials, 0 audit sources
- [x] `unii knowledge` rebuilds it (not at every start: ~40 s)
- [x] Cards for OnCorps repos not cloned here (gh, read only): 51 (11 active, 40 archived); description, else README's first paragraph, else top-level files; archived: description only
- [ ] User: `/import ~/.unii-prime/knowledge.json` in the chat (estimate shown first)

## Ctrl+B background, /agent for the person
Plan: ~/.claude/plans/shall-we-consider-adding-quizzical-pine.md
- [x] Fix (user): Tab back to UniiChat showed the last agent's end; `term_went` reprints the page's last screen (`term_recap`)
- [x] Part 1 tests first (Machine.test.ts): `away` answers early, the file gets the rest and the exit; no `away` still waits (and writes no file when sent late); a stop still kills. Red before, green after
- [x] Part 1: `Machine.shell`/`run` take `away`; Term `t.jobs` keeps it (`Run`); `/bg`, Ctrl+B (`term_bg`)
- [x] Part 2 tests first (View.test.ts, Server.test.ts): `/agent` → spawn; a person's agent reports without a turn; the AI's still takes one. Red before; mutations (gate removed, `/agent` unmatched) each fail a test
- [x] Part 2: `spawn` Client act, `Tools.begin`, `Agent.user`, `Chat.report` gate, `/agent` row
- [x] Proof: full suite outside the sandbox, 120 pass, 2 fail (the known `local/prime/logs.test.ts` ones); tsc: no new errors in changed files
- [ ] By hand in unii (Ctrl+B on `sleep 60; echo done`, `/agent`, `/bg` idle): needs the user's terminal
- [ ] Ask user: rebuild `web/app.js` for the site's `/agent` (Bun 1.4.4's bundle renames ~180 unrelated lines)

Review: the test harness found that an idle chat with no view closes itself (`Chat.free`), so the Server test keeps a stand-in view open. Backgrounded jobs aren't stopped by `/stop`; quitting unii ends them. The output kept before Ctrl+B is the head and tail if it was already cut.

## Agent hierarchy (orchestrator → managers → workers), in place
Plan: ~/.claude/plans/can-we-totally-remake-precious-ripple.md · branch `feat/hierarchy`
- [x] 0. Pending work committed on local/litellm in 4 topic commits; baseline outside the sandbox 124 pass, 2 known logs fails
- [x] 1a. A Memory tree per agent (own view in `Tools.ask`, parent snapshot kept); old .jsonl logs read on; handover carries agent summaries. Proof: agents.test.ts 4/4, 4 mutations each fail a test; suite 128 pass, 2 known fails; tsc: no new errors
- [x] 1b. Brief (the view's latest 8 KB of lines) and the agent's own tree replace the parent snapshot; `zoom`/`date`: id own, `^id` the starter's chat, `Name`/`Name:id` Unii's or its own. Proof: agents.test.ts 6/6, 3 mutations each fail one test (re-run after a parse error made the first run void); suite 130 pass, 2 known fails; tsc: no new errors
- [x] 1c. Roll-over: past ROLL (150K tokens in, as the API tells them) a call ends after a tool step and is asked again from its tree view (agents and main chat); the task / user's message stays word for word. Proof: agents.test.ts 8/8 and the Server roll test; 5 mutations each fail one test (baseline 13/13 first); suite 133 pass, 2 known fails; tsc: no new errors
  - Edge: an entry held while an upload logs (Chat.hold) could land after a roll's next call is built; it's in the tree, just not in that call's raw tail
- [x] 2. Tiers: `manager`/`worker` config keys (sonnet-5.5 default; `agents` sets both), model override downward only (`Tools.child`), depth 3, spawn/tell/stop scoped to one's own (`Tools.under`), subtree stop, a worker's report wakes its manager (`Tools.up`), a manager reports only with no workers at work; the note carries tier, starter, model, effort (`Tools.note`/`noted`, older notes read as workers of Unii); prompt.txt: Unii orchestrates. Proof: Tools.test.ts + agents.test.ts 16/16; 8 mutations each fail a test (baseline first); suite 138 pass, 2 known fails; tsc: no new errors. Found by crash.test: a throwing hook after the run could skip its report; the report now goes first and the last hook is guarded
  - Unii's own model is still the chat's pick (`pick`, default sonnet-5.5): for Opus at the top, `/model opus-5.5` or `UNII_PICK=claude-api:opus-5.5:high:slow`
- [x] 3. View model: `state.crew` (each agent's starter, tier, model, status working/waiting/failed/stopped/done, since; `Tools.crew`), `view_crew` rows (under their starter, failed first) and `view_attention`; an agent's events only to views on its page (`Chat.to`, `sock.data.watch`); typing on an agent's page sends `tell`; `dismiss` hides a done agent; `Chat.afford` shared by spawn and tell. Proof: View/Tools/Server tests 19/19; 6 mutations each fail a test (baseline first); suite 140 pass, 2 known fails + 2 flaky Mcp (also on HEAD, 1 in 6 runs); tsc: no new errors
- [x] 4. Terminal UI: a crew panel in the footer (not a sidebar: that needs the alternate screen, which loses the terminal's scrollback): UniiChat as orchestrator, each agent under its starter with status mark, tier, model, age; page shown ▸ bold; failed red; 8 lines, rest counted (`Paint.crew_lines`). Tab cycles the crew in its order, `/tab` matches crew names (`View.view_named`), `/crew` toggles, `/dismiss [name]`; on an agent's page the input says "Tell Name" and sends to it. VERSION 1.0.139. Proof: View/Paint tests 7/7; 6 mutations each fail a test (one survived first: test tightened); suite 145 pass, 2 known fails; tsc: no new errors
  - [ ] By hand in unii: the panel at a real width, Tab through a crew, type to an agent
- [x] 5. Web UI: the footer nav shows the crew as rows (`Html.crew_html`: UniiChat, agents under their starters, page shown marked, failed red, done dim, × dismisses: a `Dismiss` Act shared in View.ts); typing on an agent's page tells it (View.ts, shared); web/app.js rebuilt (`bun run web`; most of its diff is the bundler's renaming). Proof: Html/View tests 7/7, 4 mutations each fail a test; suite 146 pass, 2 known fails + the Screen perf test under load (passes alone 3/3); tsc: no new errors
  - [ ] By hand on the site: the crew at a real width, click to zoom, × to dismiss
- [x] 5b. Desktop notifications (desktop only, as decided): alerts worked out by each client from the state it hears (`View.view_alerts`: an agent turning failed, Unii's turn ending; none on connect; each key at most once in 20 s), not a server event. Terminal: focus reporting (CSI ?1004h → FocusIn/FocusOut keys) so only a terminal in the back notifies, OSC 777 (default; Terax/Ghostty), OSC 9 (iTerm), osascript (Terminal.app; text as argv, script fixed), `UNII_NOTIFY` overrides or `off`; coming back to the front shows the alert's agent. Site: Notification API while hidden (asked at the first message), a click shows the agent. Notify.ts strips control characters (no escape injection from server text). VERSION 1.0.140; web/app.js rebuilt. Proof: View/Notify/Screen 20/20, 7 mutations each fail a test; suite 150 pass, 2 known + 2 flaky Mcp; tsc: only env noise added
  - [ ] By hand: a failed worker or a turn ending while Terax is in the back shows a notification; a terminal that tells no focus never notifies
- [x] Home repo (user's ask): `UNII_HOME_REPO` on a terminal; Unii's own jobs run there (agents keep `<work>/<Name>`); the Devices line names it and the devices doc says to read its AGENTS.md/CLAUDE.md, which point to the other repos. (`UNII_HOME` already meant ~/.unii.) VERSION 1.0.141. Proof: Machine/Tools tests, 2 mutations caught; suite 155 pass, 2 known
- [x] Status line (user's ask, as Claude Code's): under the input, offline · folder ⎇ branch · Unii's model · agents at work · today's LiteLLM spend (* stale). The spend is read from Claude Code's own cache (~/.cache/statusline/litellm-<day>.json), its refresher (~/.claude/hooks/litellm-cost.js) run detached when due: no key or fetch in unii (`UNII_COST_CACHE`, `UNII_COST_REFRESH`). VERSION 1.0.142. Proof: Cost.test 3/3, 4 mutations caught; real cache read ($498.11 today); suite 158 pass, 2 known
- [ ] 7. Hardening
  - [x] Memory `hold[0]` "never set": not a bug here (Billing.open is the free billing; the paid wallet holds its payee's mem, by the Payee contract). But agent trees (1a) had a `hold` of their own no wallet sets: a refused agent summary was asked in a hot loop (reproduced: the test hung). Agent trees now share the chat's `hold`, and the chat's pump pumps them (credit back: they go on). Proof: agents.test.ts 10/10, both mutants caught (one hangs); suite 153 pass, 2 known fails
  - [x] Failed children report "failed: …" (Tools.run's catch; crash.test) and show ✗ in the crew
  - [x] Subtree cost caps: not built (user: LiteLLM manages budgets)
  - [ ] Open agent trees are never closed (fds grow with agents in a chat): close idle ones, reopen on use (careful: a reopened tree's pending summaries vs a handover's take)
- [x] 6. Claude Code workers (decided with the user): headless `claude -p --permission-mode auto --output-format stream-json --verbose` (not a PTY: its events go into the worker's tree), in its own process group, in its work dir or the `dir` given; `spawn as: "claude"` (Unii or a manager) with `device`, `dir`. Each waits for the person: crew status `asking` (first, `?`), an alert, `/approve [name]` / `/deny [name]` or the site's ✓/×; denied or stopped before it starts, it reports so. Transcript (unii/tool/echo lines, end kept under 1 MB) logged as an echo in its tree, its result its report. Tell is refused (Claude Code takes no messages). Opus at the top: already, `local/unii-local.sh` sets UNII_PICK opus-5.5:high and the chat saved no pick. VERSION 1.0.143; web/app.js rebuilt. Proof: agents/View/Machine/Html/Tools tests, 5 mutations caught (one survived first: test tightened); suite 163 pass, 2 known
  - Note: `-p` skips Claude Code's workspace-trust dialog: the person's approval is the gate. A chat moving to another process while one runs: its job runs on, but its report is lost (it has no call to move)
  - [ ] By hand: `spawn as claude` on a real repo, /approve, the report
- [ ] By hand: `UNII_HOME_REPO=~/repos/home unii`; the status line's branch and spend

## Later
- `Mcp.test.ts` process-group tests ("children have their own process groups…", "the next start kills children…") fail 2 of 13 about 1 run in 6, at HEAD too: timing.
- Upstream test `Cloud.test.ts` "link_ask caps links … a day" fails in the full suite at some times of day (also at HEAD without local changes); passes alone.
- SearXNG engines: DuckDuckGo (captcha), Brave and Wikipedia fail; only Google CSE answers. Tune engines in ~/.unii/searxng/settings.yml.
- Upstream bug to report: Bun 1.3.8 DecompressionStream hangs on a Bun.file slice stream (Import.ts zip_file).
- Bigger import: tool I/O, older/full chat history, more pdf/xlsx, subagent transcripts.

## Review
