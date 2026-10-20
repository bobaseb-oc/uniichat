# Lessons

- 2026-10-20: I told the user agent shells inherit the server's environment. They don't: `shell`/`read`/`write`/`edit` run on the device (Term.ts, Machine.ts), so they get the terminal's environment. Rule: before claiming what a tool's process can see, find which process runs it (Tools.ts header: device tools vs server tools).
