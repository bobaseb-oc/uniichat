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
2. [ ] Wiring: Tools/Config, local/mcp.ts, mcp.extra.json, local/tools lockfile, claude-mem excluded
3. [ ] `Lsp.ts` and the `lsp` tool
4. [ ] Atlassian OAuth draft (red zone, separate branch, user drives)

## Later
- SearXNG engines: DuckDuckGo (captcha), Brave and Wikipedia fail; only Google CSE answers. Tune engines in ~/.unii/searxng/settings.yml.
- Upstream bug to report: Bun 1.3.8 DecompressionStream hangs on a Bun.file slice stream (Import.ts zip_file).
- Bigger import: tool I/O, older/full chat history, more pdf/xlsx, subagent transcripts.

## Review
