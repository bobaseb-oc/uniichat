# Atlassian sign-in (OAuth) — red-zone draft

**Branch:** `local/atlassian-oauth`, not merged. **Status:** draft for the user to review, run and merge (AGENTS.md red zone: authentication flows, token and session handling).

**Risk level: High.** The code gets a token that acts as the user in Jira and Confluence, and hands it to an MCP server that agents call.

## What it does
1. `unii mcp-login atlassian` (local/mcp-login.ts → Auth.login):
   - Finds the authorization server from the MCP server itself: the 401's `resource_metadata` (RFC 9728), then the server's metadata (RFC 8414).
   - Registers a public client (RFC 7591, `token_endpoint_auth_method: none`) for a loopback redirect.
   - Opens the browser at the authorize URL (PKCE S256, `state`, `resource`).
   - Waits up to 5 minutes for one callback on `http://127.0.0.1:<random port>/callback`, swaps the code for tokens, and stores them in the Keychain.
2. The server (Mcp.ts): for a server marked `oauth`, each request gets `Authorization: Bearer <token>` from `Auth.token`. That refreshes the token 2 minutes before it expires.
3. `unii mcp-logout atlassian` deletes the Keychain item.

## Invariants (each has a test that fails without it)
| # | Invariant | Test |
|---|---|---|
| I1 | Tokens are kept only in the Keychain (`Bun.secrets`, service `unii-mcp-atlassian`). They are never in a file, argv, the environment, a log line or an error text. | `Auth.test.ts`: "no token in any file, error or log" |
| I2 | Every endpoint is `https:`. The only exception is a test-only option for `http://127.0.0.1`, which config cannot set. | "metadata is refused when…" |
| I3 | The metadata `issuer` must equal the authorization server URL it was fetched for (mix-up defense). The protected resource's `resource` must equal the MCP URL. | same |
| I4 | PKCE uses S256 only. If the server doesn't offer S256, sign-in fails; there is no fallback to `plain`. | same |
| I5 | `state` is 32 random bytes and compared in constant time. A callback with a wrong `state`, an `error`, or no `code` ends the sign-in with no token stored. | "a callback with a wrong state…" |
| I6 | The callback listens on 127.0.0.1 only, accepts one request on `/callback`, and stops after it or after 5 minutes. | same, plus "a sign-in nobody completes…" |
| I7 | The `resource` parameter (RFC 8707) is sent on authorize, token and refresh, so the token is bound to the MCP server. | "a sign-in…" (fake checks it) |
| I8 | Fail closed: if there is no token, or the refresh fails, the server is skipped with one log line ("sign in: unii mcp-login atlassian"). Nothing is sent without a token. | "an oauth server without a token is skipped" |
| I9 | Concurrent requests share one refresh, so a rotated refresh token is never used twice. | "two requests at once refresh once" |

## Proof (run by Claude, 2026-10-20)
- `bun test`: 99/99 pass (Auth.test.ts 8, plus the Mcp/config tests).
- One mutation per invariant (I1-I9, 10 in all): each one fails at least one test.
- `Auth.discover` against the live `https://mcp.atlassian.com/v2/mcp` passes every check. Issuer `https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3`; authorize `https://auth.atlassian.com/authorize`; token `…/oauth/token`; register `…/dcr/register`.
- Not run: a real sign-in, which needs you at the browser.

## Files
- `Auth.ts`: discovery, sign-in, token and refresh, logout, the Keychain store.
- `Mcp.ts`: `oauth` servers get `Authorization: Bearer` on every HTTP request. The token is fetched before each `fetch`, so a missing token throws before anything is sent.
- `local/mcp.extra.json`: `atlassian` (`https://mcp.atlassian.com/v2/mcp`, the URL Claude Code's plugin uses).
- `local/mcp.ts`: extra servers given by URL.
- `local/mcp-login.ts`, `local/unii-local.sh`: the `unii mcp-login S` and `unii mcp-logout S` commands.

## Review checklist for you
- [ ] Read `Auth.ts` (the whole file) and the invariants above.
- [ ] `bun test Auth.test.ts`: all pass.
- [ ] Run `unii mcp-login atlassian`. In the browser, check that the consent screen is Atlassian's (`auth.atlassian.com`) and lists the scopes you expect.
- [ ] Run `security find-generic-password -s unii-mcp-atlassian` to check the item exists, without `-w`, so the secret isn't printed.
- [ ] Run `grep -r` for the first 8 characters of the token over `~/.unii` (you can see them in Keychain Access); expect 0 hits.
- [ ] Restart unii and ask the chat for your open Jira tickets.
- [ ] Run `unii mcp-logout atlassian`, restart, and check that the Atlassian tools are gone and `server.log` says to sign in.

## Open questions
1. **Scopes.** The draft asks for none, so Atlassian grants its default for the client. The resource lists 20+ scopes, including `write:` and `delete:` ones. Should sign-in ask only for read and search scopes plus `offline_access`?
2. **Jira prefix.** GITHUB.md wants `PLP-1000:`-style prefixes on commits and branches. This skunkworks repo has none so far. Is that OK, or is there a ticket for this?
