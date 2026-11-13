---
name: tests-need-local-binding
description: "Legion's bun test suite binds local ports; inside the Claude Code sandbox about 40 tests fail with \"Failed to start server\""
metadata:
  type: reference
---

`bun run test` (it runs `bun test --isolate`) binds local ports: Bun.serve on port 0, lock sockets, fake vendors and fake Google/Harvest servers. Inside the Claude Code sandbox, about 40 tests fail with "Failed to start server. Is port 0 in use?" (EADDRINUSE). That's the sandbox, not the code. Run the suite with the sandbox off, or set `sandbox.network.allowLocalBinding: true`.

- Use `bun run test`, not a bare `bun test`: without `--isolate`, test files share one process and Config, and half a dozen more tests fail from interference.
- Known baseline: everything passes except two `local/prime/logs.test.ts` tests (log staging). Any other failure is new.
- `$TMPDIR` differs between sandboxed and unsandboxed shells. A file written to `$TMPDIR` in one is missing in the other, so keep scratch files that cross over inside the repo (e.g. an untracked `work-tasks/`).
- Some guard hooks refuse Bash commands that write files with a python heredoc. Use the Edit/Write tools, or a script file, for those edits.

Related: [[check-a-change]]
