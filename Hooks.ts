// Hooks
// =====
// Claude Code's hooks, gating Legion's device tools as they gate Claude
// Code's: the PreToolUse and PostToolUse hooks of its settings files
// (managed, the user's, the project's), each run with the stdin JSON
// Claude Code gives it, under the tool's Claude Code name and input shape
// (calls), so a hook written for Claude Code (the OnCorps guard) works
// unchanged. A hook refuses a call by exit 2 (its stderr the reason) or by
// a "deny" (or "ask": no one answers here) permissionDecision; its
// systemMessage only warns. A managed hook that can't run (missing,
// crashed, timed out, its settings unreadable) refuses the call: the
// org's gate fails closed. The others' failures only warn, as in Claude
// Code. The `claude` worker is Claude Code itself, with its own hooks.
// Device side: imports nothing of the server's (Machine.ts).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Out } from "./Agent.ts";
import type { Job } from "./Machine.ts";

// Types
// =====

// a settings file, and whether it is the org's (managed)
export type Source = { file: string; managed: boolean };

// a tool call as Claude Code names it: its tool, its input
export type Call = { tool: string; input: Record<string, unknown> };

// a gate's answer: why the call is refused (null: allowed), what to warn
export type Gate = { deny: string | null; warn: string[] };

// a hook to run: its shell command, its timeout (s), whether managed
type Hook = { command: string; timeout: number; managed: boolean };

// a hook's run: its exit code (null: it never ran or was killed), its
// output, and why it failed to run
type Ran = { code: number | null; out: string; err: string; failed: string | null };

type Event = "PreToolUse" | "PostToolUse";

// Constants
// =========

// where Claude Code's managed settings live
const MANAGED = process.platform === "darwin" ? "/Library/Application Support/ClaudeCode" : "/etc/claude-code";

// a hook's timeout when its settings give none, as Claude Code's (s)
const TIMEOUT = 60;

// the longest hook output kept, of a reason or warning (characters)
const SAY = 2000;

// Hooks
// =====

export namespace Hooks {

  // the settings files Claude Code reads hooks from, for a project dir:
  // managed (managed-settings.json, then managed-settings.d/*.json in
  // order), the user's, the project's and its local one. A drop-in dir
  // that can't be listed is kept as a source, so it fails to read: closed.
  export function sources(project: string): Source[] {
    const drop = MANAGED + "/managed-settings.d";
    let drops: Source[] = [];
    if (fs.existsSync(drop)) {
      try {
        drops = fs.readdirSync(drop).filter((f) => f.endsWith(".json")).sort().map((f) => ({ file: drop + "/" + f, managed: true }));
      } catch {
        drops = [{ file: drop, managed: true }];
      }
    }
    return [
      { file: MANAGED + "/managed-settings.json", managed: true },
      ...drops,
      { file: os.homedir() + "/.claude/settings.json", managed: false },
      { file: project + "/.claude/settings.json", managed: false },
      { file: project + "/.claude/settings.local.json", managed: false },
    ];
  }

  // the project of a dir: the nearest one up holding .git, else the dir
  export function project(cwd: string): string {
    for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
      if (fs.existsSync(d + "/.git")) {
        return d;
      }
      if (path.dirname(d) === d) {
        return path.resolve(cwd);
      }
    }
  }

  // a job's tool calls as Claude Code's (one Edit per edit), paths made
  // absolute from its dir; none for tools Claude Code has no name for
  // (computer; claude, which is Claude Code)
  export function calls(job: Job, cwd: string): Call[] {
    const input = job.input ?? {};
    const file = (p: unknown) => path.resolve(cwd, String(p));
    switch (job.name) {
      case "shell": {
        return [{ tool: "Bash", input: { command: String(input.command) } }];
      }
      case "read": {
        const range = { ...(input.offset !== undefined ? { offset: input.offset } : {}), ...(input.limit !== undefined ? { limit: input.limit } : {}) };
        return [{ tool: "Read", input: { file_path: file(input.path), ...range } }];
      }
      case "write": {
        return [{ tool: "Write", input: { file_path: file(input.path), content: String(input.content) } }];
      }
      case "edit": {
        const edits: any[] = Array.isArray(input.edits) ? input.edits : [];
        return edits.map((e) => ({ tool: "Edit", input: { file_path: file(e?.path), old_string: String(e?.old ?? ""), new_string: String(e?.new ?? ""), replace_all: e?.all === true } }));
      }
      case "glob": {
        return [{ tool: "Glob", input: { pattern: String(input.pattern), path: file(input.path ?? ".") } }];
      }
      case "grep": {
        const mode = { files: "files_with_matches", content: "content", count: "count" }[String(input.mode ?? "files")] ?? "files_with_matches";
        const more = { ...(input.glob !== undefined ? { glob: String(input.glob) } : {}), ...(input.ignore_case === true ? { "-i": true } : {}), ...(input.context !== undefined ? { "-C": Number(input.context) } : {}) };
        return [{ tool: "Grep", input: { pattern: String(input.pattern), path: file(input.path ?? "."), output_mode: mode, ...more } }];
      }
      default: {
        return [];
      }
    }
  }

  // the PreToolUse gate of a call: every matching hook run at once; the
  // first refusal (in settings order) refuses it
  export async function pre(src: Source[], tool: string, input: object, cwd: string, session: string, signal: AbortSignal): Promise<Gate> {
    const { hooks, broken } = load(src, "PreToolUse", tool);
    if (broken !== null) {
      return { deny: broken, warn: [] };
    }
    const told = { session_id: session, transcript_path: "", cwd, permission_mode: "default", hook_event_name: "PreToolUse", tool_name: tool, tool_input: input };
    const runs = await Promise.all(hooks.map((h) => exec(h, told, cwd, signal)));
    const warn: string[] = [];
    for (const [k, r] of runs.entries()) {
      const h = hooks[k]!;
      if (r.failed !== null || (r.code !== 0 && r.code !== 2)) {
        const why = r.failed ?? "exited " + r.code + (r.err.trim() ? ": " + say(r.err) : "");
        if (h.managed) {
          return { deny: "a managed hook (" + h.command + ") " + why, warn };
        }
        warn.push("hook " + h.command + " " + why);
        continue;
      }
      if (r.code === 2) {
        return { deny: say(r.err) || "refused by " + h.command, warn };
      }
      const out = answer(r.out);
      const spec = out?.hookSpecificOutput;
      if (spec?.permissionDecision === "deny") {
        return { deny: say(String(spec.permissionDecisionReason ?? "")) || "refused by " + h.command, warn };
      }
      if (spec?.permissionDecision === "ask") {
        return { deny: "a hook asks for approval, and no one answers here: " + say(String(spec.permissionDecisionReason ?? "")), warn };
      }
      if (out?.decision === "block" || out?.continue === false) {
        return { deny: say(String(out.reason ?? out.stopReason ?? "")) || "refused by " + h.command, warn };
      }
      if (typeof out?.systemMessage === "string") {
        warn.push(say(out.systemMessage));
      }
    }
    return { deny: null, warn };
  }

  // the PostToolUse hooks of a call that ran: what they tell the model
  // (exit 2's stderr, a "block" decision's reason); their failures, after
  // the fact, say nothing
  export async function post(src: Source[], tool: string, input: object, response: Out, cwd: string, session: string, signal: AbortSignal): Promise<string[]> {
    const { hooks } = load(src, "PostToolUse", tool);
    const told = { session_id: session, transcript_path: "", cwd, permission_mode: "default", hook_event_name: "PostToolUse", tool_name: tool, tool_input: input, tool_response: { text: response.text, fail: response.fail } };
    const runs = await Promise.all(hooks.map((h) => exec(h, told, cwd, signal)));
    const notes: string[] = [];
    for (const r of runs) {
      const out = r.code === 0 ? answer(r.out) : null;
      const note = r.code === 2 ? say(r.err) : out?.decision === "block" ? say(String(out.reason ?? "")) : "";
      if (note !== "") {
        notes.push(note);
      }
    }
    return notes;
  }

  // the hooks of an event matching a tool, from every source in order;
  // broken: why the gate can't be known (a managed source unreadable).
  // allowManagedHooksOnly (managed) or disableAllHooks drop the user's and
  // the project's; only a managed disableAllHooks drops managed ones.
  function load(src: Source[], event: Event, tool: string): { hooks: Hook[]; broken: string | null } {
    const read: { s: Source; json: any }[] = [];
    for (const s of src) {
      if (!fs.existsSync(s.file)) {
        continue;
      }
      try {
        read.push({ s, json: JSON.parse(fs.readFileSync(s.file, "utf8")) });
      } catch (err: any) {
        if (s.managed) {
          return { hooks: [], broken: "can't read the managed settings " + s.file + ": " + say(String(err?.message ?? err)) };
        }
      }
    }
    const managed = read.filter((r) => r.s.managed);
    const off_all = managed.some((r) => r.json?.disableAllHooks === true);
    const off_own = off_all || managed.some((r) => r.json?.allowManagedHooksOnly === true) || read.some((r) => !r.s.managed && r.json?.disableAllHooks === true);
    const hooks: Hook[] = [];
    for (const { s, json } of read) {
      if (s.managed ? off_all : off_own) {
        continue;
      }
      const groups: any[] = Array.isArray(json?.hooks?.[event]) ? json.hooks[event] : [];
      for (const g of groups) {
        if (!matches(String(g?.matcher ?? ""), tool, s.managed)) {
          continue;
        }
        for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
          if (h?.type === "command" && typeof h.command === "string") {
            hooks.push({ command: h.command, timeout: Number(h.timeout) > 0 ? Number(h.timeout) : TIMEOUT, managed: s.managed });
          } else if (s.managed) {
            // a managed hook of a kind not run here (prompt, http): can't run
            return { hooks: [], broken: "a managed " + String(h?.type) + " hook can't run here" };
          }
        }
      }
    }
    return { hooks, broken: null };
  }

  // whether a matcher takes a tool: "" or "*" every tool, else a regex of
  // the whole name ("Edit|Write"); a managed matcher that isn't a regex
  // takes every tool (closed), another none
  function matches(matcher: string, tool: string, managed: boolean): boolean {
    if (matcher === "" || matcher === "*") {
      return true;
    }
    try {
      return new RegExp("^(?:" + matcher + ")$").test(tool);
    } catch {
      return managed;
    }
  }

  // runs a hook: `sh -c` its command in the tool's dir, told its JSON on
  // stdin, in its own process group (a timeout or a stop kills it whole)
  async function exec(h: Hook, told: object, cwd: string, signal: AbortSignal): Promise<Ran> {
    let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
      proc = Bun.spawn(["/bin/sh", "-c", h.command], { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: Hooks.project(cwd) }, stdin: "pipe", stdout: "pipe", stderr: "pipe", detached: true });
    } catch (err: any) {
      return { code: null, out: "", err: "", failed: "can't start: " + say(String(err?.message ?? err)) };
    }
    let why: string | null = null;
    const kill = (reason: string) => {
      why ??= reason;
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => kill("timed out after " + h.timeout + " s"), h.timeout * 1000);
    const stop = () => kill("was stopped");
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) {
      stop();
    }
    try {
      proc.stdin.write(JSON.stringify(told));
      proc.stdin.end();
    } catch {}
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    if (why !== null) {
      return { code: null, out, err, failed: why };
    }
    if (code === 126 || code === 127) {
      return { code, out, err, failed: "can't run (exit " + code + ")" + (err.trim() ? ": " + say(err) : "") };
    }
    return { code, out, err, failed: null };
  }

  // a hook's stdout as JSON, if it is one
  function answer(out: string): any {
    const text = out.trim();
    if (!text.startsWith("{")) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function say(text: string): string {
    const t = text.trim();
    return t.length > SAY ? t.slice(0, SAY) + "…" : t;
  }
}
