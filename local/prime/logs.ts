// Logs
// ====
// `bun local/prime/logs.ts`. Claude Code's logs (~/.claude/projects, top
// level: no subagents') staged again as redact.ts stages them, at each
// start of `unii` (local/unii-local.sh), so its import, asked at once
// (Term.ts UNII_IMPORT_ASK), finds what was said since: a log new or
// newer than its staged copy is copied again, one unchanged is kept. The
// projects the manifest leaves out ("-", collect.ts) and claude-mem's
// own sessions are never copied. The importer itself brings only the
// messages it has not (Import.ts import_new).

import * as fs from "node:fs";
import * as os from "node:os";
import { manifest_read, mem_logs, OUT } from "./collect.ts";
import { env_secrets, stage_log, type Hits } from "./redact.ts";

// whether a project folder is left out: claude-mem's, or one the
// manifest's text marks "-"
export function logs_skip(manifest: string): (dir: string) => boolean {
  const off = new Set(manifest_read(manifest).filter((l) => l.kind === "chatlog" && !l.take).map((l) => l.path.split("/").pop()));
  return (dir) => mem_logs(dir) || off.has(dir);
}

// stages each log of `src` (a projects folder) in `out` whose copy is
// missing or older; what it copied, kept, and redacted
export function logs_sync(src: string, out: string, skip: (dir: string) => boolean, secrets: string[]): { updated: number; kept: number; hits: Hits } {
  const run = { updated: 0, kept: 0, hits: {} as Hits };
  for (const dir of fs.readdirSync(src).filter((d) => !skip(d) && fs.statSync(src + "/" + d).isDirectory())) {
    for (const f of fs.readdirSync(src + "/" + dir).filter((f) => f.endsWith(".jsonl"))) {
      const from = src + "/" + dir + "/" + f;
      const to = out + "/" + dir + "/" + f;
      if (fs.existsSync(to) && fs.statSync(to).mtimeMs >= fs.statSync(from).mtimeMs) {
        run.kept += 1;
        continue;
      }
      fs.mkdirSync(out + "/" + dir, { recursive: true, mode: 0o700 });
      stage_log(from, to, secrets, run.hits);
      run.updated += 1;
    }
  }
  return run;
}

if (import.meta.main) {
  const manifest = fs.existsSync(OUT + "/manifest.txt") ? fs.readFileSync(OUT + "/manifest.txt", "utf8") : "";
  const run = logs_sync(os.homedir() + "/.claude/projects", OUT + "/claude/projects", logs_skip(manifest), env_secrets(process.env));
  const hits = Object.entries(run.hits).map(([k, n]) => k + "=" + n).join(" ");
  console.error("unii: Claude Code logs: " + run.updated + " staged anew, " + run.kept + " unchanged" + (hits === "" ? "" : ", redacted " + hits));
}
