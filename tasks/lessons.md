# Lessons

- 2026-10-20: I told the user agent shells inherit the server's environment. They don't: `shell`/`read`/`write`/`edit` run on the device (Term.ts, Machine.ts), so they get the terminal's environment. Rule: before claiming what a tool's process can see, find which process runs it (Tools.ts header: device tools vs server tools).
- 2026-11-11: A mutation check "passed" (each mutant failed a test) while the file didn't even parse, so every run failed for that reason. Rule: a mutation check counts only if the unmutated file passes first and each mutant shows "N-1 pass, 1 fail", not just "fail".
- 2026-11-12: A new Cloud test hard-coded "http://127.0.0.1" as SITE; it passed alone and failed in the full suite, where another file loads Config first with its own UNII_SITE. Rule: tests compare against config.SITE (imported), never a literal site, since every test file shares one process and one Config.
