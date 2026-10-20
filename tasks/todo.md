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

## Prime the memory tree
- [x] `local/prime/collect.ts` → manifest.txt (user review)
- [x] `local/prime/redact.ts` + tests → ~/.unii-prime (user check-in)
- [x] `local/prime/export.ts` → ~/.unii-prime/context.json (587 chats)
- [x] `UNII_IMPORT_DIRS`: /import reads only the redacted copy (not ~/.claude, ~/.codex)
- [x] Local estimate: 763 sessions, 9,404 msgs, 10.2 MB ≈ $23.44
- [ ] `/import` estimate → user go-ahead → import
- [ ] Recall check

## Later
- SearXNG engines: DuckDuckGo (captcha), Brave and Wikipedia fail; only Google CSE answers. Tune engines in ~/.unii/searxng/settings.yml.
- Upstream bug to report: Bun 1.3.8 DecompressionStream hangs on a Bun.file slice stream (Import.ts zip_file).
- Bigger import: tool I/O, older/full chat history, more pdf/xlsx, subagent transcripts.

## Review
