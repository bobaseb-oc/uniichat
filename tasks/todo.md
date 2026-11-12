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
  - [x] Open agent trees: at most `OPEN` (16) per chat; past that the idle one (no summary running) used longest ago closes, files too (`Memory.agent_trim`); used again it opens anew whole; its pending summaries go on as the chat's pump or a call's `agent_blocks` starts them (opening never pumps: a handover's take attaches first). Proof: agents.test.ts, 4 mutations caught (one survived first: test tightened); suite 165 pass, 2 known
- [x] 6. Claude Code workers (decided with the user): headless `claude -p --permission-mode auto --output-format stream-json --verbose` (not a PTY: its events go into the worker's tree), in its own process group, in its work dir or the `dir` given; `spawn as: "claude"` (Unii or a manager) with `device`, `dir`. Each waits for the person: crew status `asking` (first, `?`), an alert, `/approve [name]` / `/deny [name]` or the site's ✓/×; denied or stopped before it starts, it reports so. Transcript (unii/tool/echo lines, end kept under 1 MB) logged as an echo in its tree, its result its report. Tell is refused (Claude Code takes no messages). Opus at the top: already, `local/unii-local.sh` sets UNII_PICK opus-5.5:high and the chat saved no pick. VERSION 1.0.143; web/app.js rebuilt. Proof: agents/View/Machine/Html/Tools tests, 5 mutations caught (one survived first: test tightened); suite 163 pass, 2 known
  - Note: `-p` skips Claude Code's workspace-trust dialog: the person's approval is the gate. A chat moving to another process while one runs: fixed: its job moves with the device, and the new process's take has its worker wait on it there, so its report comes from where the chat is (agents.test.ts; mutation caught)
- [x] `export UNII_HOME_REPO=~/repos/home` in ~/.zshrc (user's ask); ~/repos/home doesn't exist yet: clone the home repo there (an empty one is made at Unii's first job)
  - [ ] By hand: `spawn as claude` on a real repo, /approve, the report
- [ ] By hand: `UNII_HOME_REPO=~/repos/home unii`; the status line's branch and spend

## Crew UI and local sign-in (branch feat/crew-ui, off feat/hierarchy; user's ask 2026-11-12)
Intent: the web is much more dynamic. Toggle Chat | Crew; Crew lets you watch and steer every agent's session.
Before that: no email sign-in locally, and no phone features (phones aren't allowed at OnCorps).
Decided with the user: watch and steer both; about 5-10 managers with an unknown number of workers;
no cost display; desktop only.
- [x] A. `unii web` (RED ZONE: sign-in; a draft for the user's review, not merged without them).
      The terminal's Bearer token mints a 60 s, single-use ticket bound to its user id. /auth?t= uses
      it up and sets the cookie for that same account. The cookie can't mint one, nor can someone
      signed out. Proof: Cloud tests, incl. negative cases (cookie, no auth, reuse, expiry).
      Done as a draft, AWAITING USER REVIEW (Red Zone). Cloud.web_link / Cloud.web_auth, Term.ts `web`,
      launcher `web)`, web hint. Proof: Cloud.test.ts 7/7; 6 mutants (cookie accepted, reusable ticket,
      15-min ttl, counted as a mailed link, web ticket via billing path, GET allowed) each 6 pass 1 fail,
      unmutated 7/7 first (the "counted" mutant survived at first: test tightened to 3 open tickets).
      Full suite 166 pass, the 3 baseline fails. tsc on changed files 71 → 72, the one new is the same
      no-@types/node noise (process.platform). app.js rebuild: HEAD reproducible, +3 lines.
- [x] B. Phone features hidden behind a setting (UNII_PHONE, default off): no APNs pushes,
      no AASA, no phone-pairing UI. The code stays, so it's easy to undo.
      Done: Config.PHONE (UNII_PHONE=1), cloud.phone gates Cloud.push, /api/push, AASA. No pairing UI
      existed; the web's iOS bridge (APP) is only in the iOS web view, so desktop shows none.
      Proof: Cloud.test.ts 8/8; mutants (push route ungated, default on) each 7 pass 1 fail. The AASA and
      APNs-send gates aren't test-killable (tests have no APPLE/APNS set); covered by reading.
- [x] C1. Web Crew view: a Chat|Crew toggle (#chat, #crew, #crew/<name>, keys g c / g m); a tree
      with managers collapsed and their workers rolled up; a focus pane with the agent's live
      session and its actions (tell, stop, approve/deny, dismiss); a "needs you" lane on top.
      In Chat mode, a pill shows "N working, M need you".
      Done: View.view_tree/view_needs/view_pill/view_route/view_hash, acts Stop and Expand; Html.tree_html,
      needs_html, focus_html, mode_html; #crew column, header switch, hash routes, keys g c / g m; the
      focus's session is its agent page (live transcript, tools folded, tell by typing).
      Proof: View.test.ts 12/12, Html.test.ts 9/9; View mutants (all open, no focus ancestors, needs order,
      no decode, expand never folds, stop all) each kill one test (needs order survived at first: test
      tightened); Html mutants (no stop, pill unmarked, no roll-up, raw name) killed; "href unescaped" is
      equivalent (encodeURIComponent already escapes " < > &). Suite 178 pass, 3 baseline fails; tsc on
      changed files 8 → 8. Headless Chrome render of a demo crew (8 managers, 40 workers) checked: the
      first had no status glyphs (.mark clashed with the logo's class: renamed .st) and roll-ups cut off
      (a folded manager now shows only its roll-up; tier and model in the tooltip).
- [x] C2. A pulse per agent for every view (status, current activity, last line); a view can
      watch several agents at once (the visible tiles).
      Done: Tools.pulse/status ({status, act, last}, lines ≤ 120, thoughts as "thinking…"); Chat.pulse sends it
      to every socket once PULSE (1 s) after an agent's first delta or entry (a burst: one); a socket's
      `watch` replaces its watch set (known agents, ≤ 16); the web keeps pulses (v.pulses), shows each tree
      row's activity line, and watches its focus (View.view_watch; C3's tiles join it).
      Proof: Tools.test.ts pulse test; Server.test.ts pulse/watch test (20 deltas → 1 pulse to each socket,
      20 deltas only to the watcher, none after watch []); View/Html tests 23/23. Mutants killed: no
      coalescing, pulse to watchers only, unknown names watched, watch adds (re-run: the first try didn't
      parse; both versions checked with Bun.Transpiler), always act, watch nothing, first pulse kept.
      Not killed by a test: the 16 cap (it needs 17 live agents). Suite 182 pass, 3 baseline fails; tsc
      75 → 75 (one new error, an unknown[] in watch, fixed).
- [x] C3. A grid of manager tiles with dots for their workers; a timeline lane per agent;
      the terminal's full-screen Crew mode (/crew full, Esc goes back to scrollback); a demo crew
      (8 managers, 40 workers) for layout and tests.
      - [x] Grid and demo: Demo.ts (8 managers × 5 workers, a sub-manager, a Claude Code worker asking);
        View.view_tiles, view_watch(v, tiles) (focus + tiles in sight, ≤ 16), act Tell; Html.grid_html;
        #crew with no focus shows the grid (the footer keeps only toasts; a tile's box tells its agent);
        /?demo=1#crew draws the demo crew locally. Fix found end to end: boot() cleaned the URL to "/"
        and dropped #crew, so a link to the Crew opened the chat; it keeps the hash now. Also
        `$("form")` bound the first form on the page: now `form.composer` (tiles add forms).
        Proof: View 17/17, Html 12/12; suite 188 pass, 3 baseline fails; tsc on changed files: the same
        one pre-existing error. End to end on a throwaway server (port 9555, temp UNII_DIR): sign-in by
        /api/web-link with a Bearer (a cookie-only mint: 401), headless Chrome over CDP on /?demo=1#crew:
        9 tiles, pill "18 working, 7 need you", g m → #chat, g c → #crew grid, the tree's caret opens a
        manager; no page errors.
      - [x] Timeline lane: View.view_lane (messages with a date by kind, thoughts left out; a spawn per
        agent it started; a stall per gap past 2 min, and a quiet end while at work), Html.lane_html under
        the focus card; a message's mark jumps to its row (one row per message: page_rows). The server's
        agent entries now carry their date. Proof: lane tests (View, Html); mutants (no stalls, always to
        now, no spawns, thoughts marked, no jump, label raw) each kill one; suite 190 pass, 3 baseline
        fails; tsc on changed files 62 → 62 (the earlier "0 → 0"s were void: see lessons.md, zsh).
      - [x] Terminal: /crew full: the alternate screen with Paint.crew_full (head with the pill and keys,
        who needs you, at most a third of the screen, the tree with activity lines, the selection kept in
        sight); keys by View.view_full (↑↓/jk, →←/hl/Space, Enter focus, s, a/d, x, Esc/q/Ctrl+C);
        Screen.grab sends every key to Term while it shows; Esc gives back the scrollback as it was.
        Proof: View keys test, Paint test (24 and 8 rows: the first try had no room for the tree on 8
        rows: the needs lane is capped to a third); suite 192 pass, 3 baseline fails; tsc on changed files
        71 → 76, all 5 the no-@types/node noise (process). PTY smoke (script, throwaway server, token
        file): /crew full enters the alternate screen and draws its head, j moves, q leaves, the footer
        is drawn again.
- [x] D. Headless device mode (user's question: the web can't run shell commands without a TUI open):
      a background process that connects as a device and runs jobs (Machine.run), with no screen.
      It gets the same approvals as the terminal.
      Done: Device.ts holds the job rules both use (Term.ts's term_jobs/term_run moved there): run once,
      computer use only with UNII_COMPUTER=1, an output over the frame refused by its size, a job the
      server drops stopped; approvals stay server-side (a Claude Code worker waits for ✓ from any view).
      `unii device [url]` (Term.ts word; launcher `device)`) connects as this device with no screen; the
      server gives a job to the newest live tab of a device, so it and a terminal can both be open.
      (`serve` was checked first: it runs a server, not a device.)
      Proof: Device.test.ts 5/5 against a fake server socket (Bearer and device name sent, once, refused
      computer job never runs, size cap, stop on a dropped id); mutants (computer allowed, no size cap,
      runs twice, never stops, stops all) each 4 pass 1 fail, unmutated 5/5. Suite 197 pass, 3 baseline
      fails. tsc: only missing Bun/Node type noise (Buffer moved with the code). Live: signed out it
      refuses ("sign in first"); signed in it connects and stays up, no errors.

## Agent labels (user's ask 2026-11-12: names that say the work, its repos and goal)
Decided with the user: keep the short name as the handle (memory, tell/stop, #crew/<name>), and show a
title (the goal) and repos as labels on top of it; the parent sets them at spawn and changes them on the
fly, and an agent can relabel itself.
- [x] L1. Server: Agent.title / repos; spawn's titles and repos (by task, in order); a Claude Code
      worker's repo defaults to its dir's folder; a `label` tool (itself, or an agent under it: name);
      inputs trimmed and capped (title ≤ 80, ≤ 8 repos ≤ 60 each, no newlines); in the crew (Tools.crew).
      Proof: tests incl. refusing another's agent and capping.
      Done: Agent.title/repos, Tools.labels (cleans and caps), Tools.label (the crew's agents; itself, or
      one under it), `label` in every thinking agent's tools, spawn's titles/repos, the Claude Code
      worker's dir folder as its repo. Proof: Tools.test.ts label test, agents.test.ts spawn labels and
      the Claude worker's default repo; mutants (anyone labels anyone, no caps, dupes kept, spawn ignores
      labels, no default repo, empty label accepted) each 24 pass 1 fail (the first "anyone" try hit
      zoom's same text and didn't parse: redone on the label line, checked with Bun.Transpiler).
- [x] L2. Views: the title as the main line, repo chips, the name under it (web tree, tiles, focus,
      needs; terminal panel and /crew full); the demo crew labelled. Proof: View/Html/Paint tests, a
      demo-crew render.
      Done: Html.who_html/repos_html (title or name, repo chips), tiles get a row of repo chips, the
      focus card and needs lane lead with the title; the narrow tree shows the title and roll-up, its
      name and repos in the row's tooltip (the first render showed chips crowding out the roll-up);
      View.view_label for the terminal ("Fix login tests (FireAnt) [auth-api]"), used by the panel and
      /crew full; Demo.ts labelled. Proof: View/Html/Paint 35/35; mutants (name not title, repo raw,
      terminal no title, tile no repos, tree tooltip no repos) killed; suite 199 pass, 3 known fails;
      headless renders of the labelled demo crew checked.

## Claude Code parity: guard hooks, tools, `!` (feat/crew-ui)
Intent: Legion's device tools get gated by the same Claude Code hooks as Claude Code itself (above all the
OnCorps guard in managed settings), it gains the Claude Code tools it lacks, and `!cmd` runs a shell
command from the input box. Decided with the user 2026-11-12: hooks from managed + user + project
settings (no plugin hooks yet); fail closed only for managed hooks; tools glob, grep, todo (no webfetch:
SearXNG search covers finding pages); `!` in the TUI and on the web.
Constraints: device side only (Machine.ts imports nothing of the server); guard.py runs unchanged (it
sees Claude Code tool names and input shapes); the `claude` worker is real Claude Code, already guarded.
- [x] H1 (RED ZONE: 7c3c5fe, signed off by the user 2026-11-12) Hooks.ts: load PreToolUse/PostToolUse from
      /Library/Application Support/ClaudeCode/managed-settings.json (+ managed-settings.d),
      ~/.claude/settings.json, <repo>/.claude/settings.json and settings.local.json; match by tool regex;
      run each with Claude Code's stdin JSON ({hook_event_name, tool_name, tool_input, cwd, session_id});
      exit 2 or permissionDecision "deny" refuses the call with the reason; systemMessage shown as a
      warning; 60 s timeout. A managed hook that can't run (missing, crash, timeout) refuses; others warn.
      Names: shell→Bash {command}, read→Read {file_path, offset, limit}, write→Write {file_path, content},
      edit→Edit {file_path, old_string, new_string, replace_all} once per edit, glob→Glob, grep→Grep.
      Wired into Machine.run before the tool; PostToolUse after. → verify: Hooks.test.ts with fake hooks
      (deny exit 2, deny JSON, warn, crash managed vs user, timeout, matcher miss) + the real guard.py
      refusing `git push --force origin main`-class critical commands; mutants killed.
      Proof: Hooks.test.ts 10/10 written before Hooks.ts (incl. the installed guard.py refusing a critical
      command); 10/10 mutants killed (managed fails open, exit 2 ignored, deny/ask ignored,
      allowManagedHooksOnly ignored, user disableAllHooks drops managed, no timeout, unreadable managed
      file ignored, only first edit gated, Machine.run ignores deny); live Machine.run with default
      sources: the real managed guard refuses `echo … rm -rf /`, allows `echo hello`; suite 209 pass,
      the 3 known fails; tsc: Machine.ts 18 → 18, Hooks.ts only missing bun/node type noise.
      Invariants for review: a managed hook that can't run, an unreadable managed file, a managed
      non-command hook or a bad managed matcher refuse (closed); user/project hooks can't switch off
      managed ones; OC_GUARD_BYPASS is read from the device's env, never the command's.
- [x] T1 glob + grep device tools (Machine.ts TOOLS): glob by pattern sorted by mtime; grep via rg if on
      PATH, else a JS walk; output capped like read. → verify: Machine.test.ts cases.
      Proof: Machine.test.ts glob/grep (rg and the walk, same answers: files, content with context,
      count, case, glob filter, no match, bad regex; via Machine.run) + Hooks mapping to Glob/Grep; 7/7
      mutants killed (the "not routed" one after adding the run test); suite 213 pass, 3 known fails;
      tsc: only missing bun/node type errors. Found: rg's -g lets hidden files back in, so `!.*` goes last.
- [x] B1+B2 `!cmd` in the TUI and on the web, one path: View.view_act turns a Send of "!cmd" (any page)
      into a "bang" act; the server (Chat.bang) runs it as main's shell job on the device it came from
      (a terminal), else the only one open, else says which are; its command and output come back as a
      note the AI reads, no turn. Changed from the plan: it goes through the hook gate like any shell
      job (a job flag to skip hooks would be a bypass anything that sends jobs could set); the user's
      own destructive commands run in a plain terminal. Proof: View.test.ts and an in-process
      Server.test.ts fixture (fake devices: no device, the only one, the sender's over another, empty
      command, the note's text, no turn); 5/5 mutants killed; suite 215 pass, 3 known fails; web/app.js
      rebuilt (+5 lines). By hand still: `!git status` in a live TUI and in the web chat.
- [x] T2 todo: a per-agent checklist tool (set the whole list, as TodoWrite) for managers and workers (not
      the orchestrator: no hands-on work), cleaned (one line, 120 chars, 20 items, unknown status
      pending), in the crew; the web focus card lists it, a tile says done/all, /crew full says
      "1/3: the step". Demo workers carry one. Proof: Tools/Html/Paint tests; 9/9 mutants killed; suite
      218 pass, 3 known fails; tsc: nothing new; headless render of the focus card checked.

## Questions backlog (feat/crew-ui)
Intent: the orchestrator's questions for the user collect in a backlog the user can answer in due course,
without scrolling the chat. Decided with the user 2026-11-12: a new `ask` tool (orchestrator only;
managers ask it); an answer box per question, the answer sent to the orchestrator as a message quoting
it; shown in a web side pane beside Chat, in the Crew "needs you" lane, and in the terminal
(/questions, a count in the status line).
- [x] Q1 server: Memory keeps the open questions (view.json, beside goal); `ask` (question, options;
      close: id withdraws one) for main only, capped; state carries them; an "answer" act (id, text)
      logs a user message quoting the question and starts a turn, or with no text dismisses it (a
      note, no turn). → verify: agents.test (ask, caps, persisted across a reload), Server fixture
      (answer: message + turn; dismiss: note; unknown id refused), mutants.
      Proof: agents.test (ask: main only, cleaned, capped at 20 open, refused past them, close, ids
      never reused across a reload) + Server fixture (state lists them; answer = the user's message
      quoting it + a turn; dismiss = a note, no turn; unknown refused); 8/8 mutants killed; suite 221
      pass, 3 known fails. tsc caught two real bugs the tests didn't (lessons.md): a second
      `Chat.answer` replacing the socket handler (now Chat.reply), and the act's `id` field clashing
      with the act's own (now `q`). Prompt: the orchestrator files waiting questions with ask.
- [x] Q2 web: a side pane in Chat (count badge, each question with its options as quick answers and
      an answer box, dismiss), and the questions first in the Crew "needs you" lane.
      → verify: View/Html tests, headless render.
      Proof: View.test (Answer/Drop acts, pill counts questions with and without a crew) + Html.test
      (pane escaped with lines kept, quick answers, box, dismiss; needs lane lists them first linking
      to #chat; the ? n toggle); 5/5 mutants killed (pill after a fix to the test); suite 223 pass,
      3 known fails; headless render of the pane checked; main.ts tsc: only its known error.
- [x] Q3 terminal: /questions lists them; /answer <n> <text> (a bare number picks an offered answer),
      /drop <n>; "N questions (/questions)" in the status line. Parsing and listing are View functions
      (view_questions_note, view_answer, view_drop). Proof: View/Paint tests; 4/4 mutants killed; suite
      225 pass, 3 known fails; tsc 2 → 2; Term.ts builds. By hand still: the commands in a live TUI.

## Permission modes: plan / auto / full (feat/crew-ui) - RED ZONE, drafts until the user signs off
Intent: Claude Code's plan and auto modes for Legion's agents, chat-wide. Decided with the user
2026-11-12: modes plan / auto / full (full = today: hooks only; new chats auto); plan mode's shell is a
read-only allowlist; when auto's reviewer can't answer, the call waits for the user's yes/no; Shift+Tab
cycles the mode (speed keeps /speed and the pick menu). The gate runs on the server before a job goes
to a device (it knows the mode and has the models); the device's hooks still run after it.
- [x] M1 (DRAFT, awaiting sign-off) plan mode: Modes.ts (the mode type; readonly(cmd): the allowlist, quotes-aware, no redirects,
      substitutions or writers; which tools a mode allows); the mode kept with the chat (view.json),
      in the state, set by a "mode" act; Tools.call refuses what plan mode doesn't allow (write, edit,
      a non-read-only shell, computer, Claude Code workers) saying so; the orchestrator's `plan` tool
      files its plan for approval; approve: the mode the user picks, the orchestrator told; reject
      with feedback: stays plan, the feedback a message. → verify: Modes.test (allowlist cases incl.
      bypass attempts), Tools/Server tests, mutants.
      Proof: Modes.test (14 read-only lines pass; 36 refused incl. $() in double quotes, backticks,
      <(), redirects, &, newline, env/path, find -exec/-delete, rg --pre, sort -o, tree -o, uniq out,
      git commit/push/-c/--output); Tools.test (plan refuses write, edit, mutating shell, computer, MCP,
      Claude Code workers before any device; reading goes on; the devices block says the mode);
      agents.test (plan tool: main only, plan mode only, kept across a reload); Server fixture (switch
      = a note, no turn; approve = the picked mode + a turn; reject = plan mode + feedback + a turn).
      Mutants: 11 killed; 4 equivalent (env/path/git -c also fail the list check; fd>/dev/null is
      harmless). Suite 231 pass, 3 known fails; tsc 5 → 5. Invariants for review: the gate is on the
      server, before any job/MCP call; an unknown or missing mode reads as auto, never full;
      rejecting a plan never leaves plan mode; only the orchestrator files plans.
- [ ] M2 auto mode: a reviewer call (cheap model) per shell/write/edit: the user's latest message,
      the agent's task, the call → allow, or refuse with a reason (the agent sees it); no answer
      (error, timeout, bad reply) → the call waits for the user's yes/no in Needs you. → verify:
      faked-model tests (allow, refuse, error → asks, yes runs, no refuses), mutants.
- [ ] M3 views: mode chip (web header, terminal status), Shift+Tab and /mode, the plan card
      (approve as auto/full, or reject with feedback), pending calls in Needs you and /approve-call.

## Later
- Web page reading: webfetch doesn't work on Bedrock; agents read pages with curl in the (guarded) shell. Our own fetch tool only if it can be made safe (results as data, SSRF/local-address refusal).
- `Mcp.test.ts` process-group tests ("children have their own process groups…", "the next start kills children…") fail 2 of 13 about 1 run in 6, at HEAD too: timing.
- Upstream test `Cloud.test.ts` "link_ask caps links … a day" fails in the full suite at some times of day (also at HEAD without local changes); passes alone.
- SearXNG engines: DuckDuckGo (captcha), Brave and Wikipedia fail; only Google CSE answers. Tune engines in ~/.unii/searxng/settings.yml.
- Upstream bug to report: Bun 1.3.8 DecompressionStream hangs on a Bun.file slice stream (Import.ts zip_file).
- Bigger import: tool I/O, older/full chat history, more pdf/xlsx, subagent transcripts.

## Review
- 2026-11-12, Crew UI and local sign-in (feat/crew-ui, A → D, one commit each, nothing pushed):
  `unii web` (Red Zone, reviewed and approved by the user), phones off by default, the web Crew view
  (Chat | Crew, tree with roll-ups, needs-you lane, focus card with actions, grid of tiles, timeline
  lane, pulses, multi-watch, demo crew at /?demo=1#crew), /crew full in the terminal, `unii device`.
  Suite 164 → 197 pass, the same 3 known fails. Found only end to end: boot() dropped the #crew hash.
  By hand still: a real crew (managers with workers) watched and steered from the web.
- 2026-11-12 fix (user report: "can't switch back to chat after clicking Crew"): with a crew, Chat mode drew
  the old footer crew list (Html.crew_html, from feat/hierarchy), one row per agent: with the demo crew it
  was taller than the window and covered the chat and the header (elementFromPoint at the Chat/Crew links
  hit footer rows). The footer shows no list with a crew now (the pill and Crew view do); crew_html, its
  CSS and its 3 tests removed (escaping and approve/deny are covered by the tree's tests). Proof: real
  clicks over CDP with the demo crew, Chat ↔ Crew 4 times, each hit the header link; footer 112 px in Chat;
  Html.test.ts 10/10; full suite below.
- 2026-11-12 fix 2 (user: still stuck on #crew, no agents): crew_bars rewrote the hash to the Crew's on
  every paint, so a paint between the click's new hash and its hashchange put #crew back, and the late
  hashchange read it. The mode is now read from the address at each paint, never written there;
  crew_sync writes it only when an act (Goto) or the server ("agent": none) moves the focus. Proof:
  CDP repro (replaceState to #chat with no event, a paint, then the hashchange): before, "#crew |
  crewmode"; after, "#chat"; an unknown agent and the logo still bring the address back to #crew; demo
  crew clicks Chat ↔ Crew ×4 pass; suite as before.
- 2026-11-12 rename (user: "Legion"; scope: name + command, keep data): "UniiChat" → "Legion" wherever it is
  shown (web, terminal, mail, greeting, README, tests); the command is `legion` (local/legion, a symlink
  to unii-local.sh; `unii` still works), and every "run unii …" a person is told says legion. Kept as
  they were: ~/.unii, UNII_* settings, the cookie, localStorage keys, the OAuth client name (MCP grants),
  the "unii" message kind, server log prefixes, ios/ (phones off), and the AI's own name "Unii" in its
  prompt and memories (asked separately). Proof: no "UniiChat" left outside ios/ and history; suite 194
  pass, the 3 known fails; `local/legion version` / `help` print legion, aligned.
