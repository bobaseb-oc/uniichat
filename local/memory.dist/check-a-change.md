---
name: check-a-change
description: "How a Legion change is checked before it ships: tests first, mutants, tsc on added lines, an end-to-end run for web routing, Red Zone as a signed-off draft"
metadata:
  type: feedback
---

Changes to Legion are checked the same way each time, and the proof goes into `tasks/todo.md` beside the plan:

1. **Tests first.** Write the failing test, see it fail for the right reason, then make it pass. Server behaviour is tested by spawning a small script against Server.ts (see Server.test.ts); a socket fixture needs `data: { watch: new Set(), seen: new Set() }`.
2. **Mutants.** For each invariant the change promises (a check, a cap, a refusal), break it on purpose and confirm a test fails. Keep the mutation script in an untracked `work-tasks/` and quote its count ("11/11 killed"). A check counts only if the unmutated file passes first.
3. **tsc on added lines.** Strict `bunx tsc --noEmit --strict --target esnext --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck <files>`, then read every error on lines the change added. Missing Bun/node types (`process`, `Buffer`, `unref` on a number) are environment noise; name clashes and missing fields are real. `tasks/lessons.md` has the cases tests missed.
4. **End to end for the web.** A change that touches routing or start-up gets one headless-Chrome run against a throwaway server, with the demo crew (`/?demo=1`), by real clicks.
5. **Red Zone** (auth, OAuth scopes, tokens, money such as timesheets, permission rules): commit as `DRAFT (Red Zone, awaiting review)` with the design and its invariants written in the file's header, and merge only after the user signs off.
6. Before a PR: the pre-ship polish pass (deletion test, functions over 50 lines), then `bun run test` again.

**Why:** in this repo, passing tests have repeatedly missed real bugs (shadowed names, routing races) that mutants, tsc or an end-to-end run caught. Related: [[tests-need-local-binding]]
