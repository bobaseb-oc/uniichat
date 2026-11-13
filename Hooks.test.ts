// Hooks test
// ==========
// `bun test Hooks.test.ts`. Claude Code's PreToolUse/PostToolUse hooks
// gating the device tools: what each hook is told, what refuses a call,
// which failures refuse it (a managed hook's) and which only warn.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Hooks, type Source } from "./Hooks.ts";
import { Machine } from "./Machine.ts";

const DIR = fs.mkdtempSync(os.tmpdir() + "/legion-hooks-");
const live = () => new AbortController().signal;

// a hook script: its body (sh), made executable; a settings file with these
// PreToolUse (and PostToolUse) groups
function script(name: string, body: string): string {
  const file = DIR + "/" + name;
  fs.writeFileSync(file, "#!/bin/sh\n" + body + "\n");
  fs.chmodSync(file, 0o755);
  return file;
}
function settings(name: string, pre: object[], post: object[] = [], more: object = {}): string {
  const file = DIR + "/" + name + ".json";
  fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: pre, PostToolUse: post }, ...more }));
  return file;
}
const group = (matcher: string, command: string, timeout?: number) => ({ matcher, hooks: [{ type: "command", command, timeout }] });

test("Legion's tools are told to hooks under Claude Code's names and input shapes", () => {
  const cwd = "/r";
  expect(Hooks.calls({ name: "shell", input: { command: "ls" }, cwd: "x" }, cwd)).toEqual([{ tool: "Bash", input: { command: "ls" } }]);
  expect(Hooks.calls({ name: "read", input: { path: "a.ts", offset: 2, limit: 5 }, cwd: "x" }, cwd)).toEqual([{ tool: "Read", input: { file_path: "/r/a.ts", offset: 2, limit: 5 } }]);
  expect(Hooks.calls({ name: "write", input: { path: "/abs/b", content: "hi" }, cwd: "x" }, cwd)).toEqual([{ tool: "Write", input: { file_path: "/abs/b", content: "hi" } }]);
  expect(Hooks.calls({ name: "edit", input: { edits: [{ path: "a", old: "1", new: "2" }, { path: "b", old: "3", new: "4", all: true }] }, cwd: "x" }, cwd)).toEqual([
    { tool: "Edit", input: { file_path: "/r/a", old_string: "1", new_string: "2", replace_all: false } },
    { tool: "Edit", input: { file_path: "/r/b", old_string: "3", new_string: "4", replace_all: true } },
  ]);
  expect(Hooks.calls({ name: "glob", input: { pattern: "**/*.ts", path: "src" }, cwd: "x" }, cwd)).toEqual([{ tool: "Glob", input: { pattern: "**/*.ts", path: "/r/src" } }]);
  expect(Hooks.calls({ name: "grep", input: { pattern: "a+", mode: "content", ignore_case: true, glob: "*.ts", context: 2 }, cwd: "x" }, cwd)).toEqual([{ tool: "Grep", input: { pattern: "a+", path: "/r", output_mode: "content", glob: "*.ts", "-i": true, "-C": 2 } }]);
  // computer and claude (Claude Code itself, with its own hooks) are not told
  expect(Hooks.calls({ name: "computer", input: { action: "screenshot" }, cwd: "x" }, cwd)).toEqual([]);
  expect(Hooks.calls({ name: "claude", input: { task: "t" }, cwd: "x" }, cwd)).toEqual([]);
});

test("a hook gets Claude Code's stdin JSON, runs in the tool's dir, and allows on exit 0", async () => {
  const seen = DIR + "/seen.json";
  const hook = script("echo.sh", `cat > ${seen}; pwd >> ${seen}.cwd; echo "$CLAUDE_PROJECT_DIR" >> ${seen}.cwd`);
  const src: Source[] = [{ file: settings("echo", [group("Bash", hook)]), managed: true }];
  const gate = await Hooks.pre(src, "Bash", { command: "ls -la" }, DIR, "Ann", live());
  expect(gate).toEqual({ deny: null, warn: [] });
  const told = JSON.parse(fs.readFileSync(seen, "utf8"));
  expect(told).toMatchObject({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls -la" }, cwd: DIR, session_id: "Ann" });
  const [pwd, proj] = fs.readFileSync(seen + ".cwd", "utf8").trim().split("\n");
  expect(fs.realpathSync(pwd!)).toBe(fs.realpathSync(DIR));
  expect(proj).toBe(DIR);
});

test("exit 2 refuses with the hook's stderr; deny JSON refuses with its reason; ask refuses too", async () => {
  const two  = script("two.sh", `echo "no force pushes" >&2; exit 2`);
  const json = script("json.sh", `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"blocked by guard"}}'`);
  const ask  = script("ask.sh", `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"confirm?"}}'`);
  const s = (f: string): Source[] => [{ file: settings(f, [group("Bash", DIR + "/" + f + ".sh")]), managed: false }];
  expect((await Hooks.pre(s("two"), "Bash", { command: "x" }, DIR, "A", live())).deny).toBe("no force pushes");
  expect((await Hooks.pre(s("json"), "Bash", { command: "x" }, DIR, "A", live())).deny).toBe("blocked by guard");
  expect((await Hooks.pre(s("ask"), "Bash", { command: "x" }, DIR, "A", live())).deny).toContain("confirm?");
  void two; void json; void ask;
});

test("a systemMessage warns and allows; a matcher that misses runs nothing", async () => {
  const warn = script("warn.sh", `echo '{"systemMessage":"careful: rm"}'`);
  const boom = script("boom.sh", `exit 2`);
  const src: Source[] = [{ file: settings("warn", [group("Bash", warn), group("Edit|Write", boom)]), managed: true }];
  expect(await Hooks.pre(src, "Bash", { command: "rm x" }, DIR, "A", live())).toEqual({ deny: null, warn: ["careful: rm"] });
  expect((await Hooks.pre(src, "Write", { file_path: "/a", content: "" }, DIR, "A", live())).deny).not.toBeNull();
  expect((await Hooks.pre(src, "Read", { file_path: "/a" }, DIR, "A", live())).deny).toBeNull();
  // "*" and "" match every tool
  const all: Source[] = [{ file: settings("all", [group("*", boom), group("", boom)]), managed: false }];
  expect((await Hooks.pre(all, "Read", { file_path: "/a" }, DIR, "A", live())).deny).not.toBeNull();
});

test("a managed hook that can't run refuses (fail closed); a user hook that can't run only warns", async () => {
  const crash = script("crash.sh", `exit 7`);
  const slow  = script("slow.sh", `sleep 5`);
  const gone  = DIR + "/no-such-hook";
  for (const cmd of [crash, gone]) {
    const m = await Hooks.pre([{ file: settings("m", [group("Bash", cmd)]), managed: true }], "Bash", { command: "x" }, DIR, "A", live());
    expect(m.deny).toContain("managed hook");
    const u = await Hooks.pre([{ file: settings("u", [group("Bash", cmd)]), managed: false }], "Bash", { command: "x" }, DIR, "A", live());
    expect(u.deny).toBeNull();
    expect(u.warn.length).toBe(1);
  }
  const t0 = Date.now();
  const timed = await Hooks.pre([{ file: settings("t", [group("Bash", slow, 0.3)]), managed: true }], "Bash", { command: "x" }, DIR, "A", live());
  expect(timed.deny).toContain("timed out");
  expect(Date.now() - t0).toBeLessThan(3000);
});

test("a managed settings file that can't be read refuses; a missing one is no hooks", async () => {
  const bad = DIR + "/bad.json";
  fs.writeFileSync(bad, "{ not json");
  expect((await Hooks.pre([{ file: bad, managed: true }], "Bash", { command: "x" }, DIR, "A", live())).deny).toContain("managed");
  expect((await Hooks.pre([{ file: bad, managed: false }], "Bash", { command: "x" }, DIR, "A", live())).deny).toBeNull();
  expect(await Hooks.pre([{ file: DIR + "/none.json", managed: true }], "Bash", { command: "x" }, DIR, "A", live())).toEqual({ deny: null, warn: [] });
});

test("allowManagedHooksOnly drops user hooks; a user's disableAllHooks can't drop managed ones", async () => {
  const deny = script("deny.sh", `echo user >&2; exit 2`);
  const mdeny = script("mdeny.sh", `echo managed >&2; exit 2`);
  const only: Source[] = [
    { file: settings("only", [], [], { allowManagedHooksOnly: true }), managed: true },
    { file: settings("user1", [group("Bash", deny)]), managed: false },
  ];
  expect((await Hooks.pre(only, "Bash", { command: "x" }, DIR, "A", live())).deny).toBeNull();
  const off: Source[] = [
    { file: settings("man", [group("Bash", mdeny)]), managed: true },
    { file: settings("user2", [group("Bash", deny)], [], { disableAllHooks: true }), managed: false },
  ];
  expect((await Hooks.pre(off, "Bash", { command: "x" }, DIR, "A", live())).deny).toBe("managed");
});

// security review M3: an agent may write its project's settings (a shell
// can), so a project's disableAllHooks drops nothing: the user's hooks
// and the project's own still run; the user's still drops theirs
test("a project's disableAllHooks drops no hook; the project's settings are marked as its", async () => {
  const deny = script("pdeny.sh", `echo user >&2; exit 2`);
  const proj = script("pown.sh", `echo project >&2; exit 2`);
  const repo = fs.mkdtempSync(DIR + "/proj-");
  expect(Hooks.sources(repo).filter((s) => s.project === true).map((s) => s.file)).toEqual([repo + "/.claude/settings.json", repo + "/.claude/settings.local.json"]);
  expect(Hooks.sources(repo).filter((s) => s.project !== true && !s.managed).map((s) => s.file)).toEqual([os.homedir() + "/.claude/settings.json"]);
  const src: Source[] = [
    { file: settings("puser", [group("Bash", deny)]), managed: false },
    { file: settings("pproj", [], [], { disableAllHooks: true }), managed: false, project: true },
  ];
  expect((await Hooks.pre(src, "Bash", { command: "x" }, DIR, "A", live())).deny).toBe("user");
  const own: Source[] = [{ file: settings("pproj2", [group("Bash", proj)], [], { disableAllHooks: true }), managed: false, project: true }];
  expect((await Hooks.pre(own, "Bash", { command: "x" }, DIR, "A", live())).deny).toBe("project");
});

test("PostToolUse hooks get the tool's response; exit 2 gives the model their stderr", async () => {
  const seen = DIR + "/post.json";
  const post = script("post.sh", `cat > ${seen}; echo "lint failed" >&2; exit 2`);
  const src: Source[] = [{ file: settings("post", [], [group("Write", post)]), managed: false }];
  const note = await Hooks.post(src, "Write", { file_path: "/a", content: "x" }, { text: "ok", fail: false }, DIR, "A", live());
  expect(note).toEqual(["lint failed"]);
  expect(JSON.parse(fs.readFileSync(seen, "utf8"))).toMatchObject({ hook_event_name: "PostToolUse", tool_name: "Write", tool_response: { text: "ok" } });
});

test("Machine.run refuses a denied shell before it runs, and runs an allowed one", async () => {
  const mark = DIR + "/ran";
  const guard = script("guard.sh", `grep -q force && { echo "force push blocked" >&2; exit 2; }; exit 0`);
  const src: Source[] = [{ file: settings("run", [group("Bash", guard)]), managed: true }];
  const no = await Machine.run({ name: "shell", input: { command: "touch " + mark + " # --force" }, cwd: "Ann" }, DIR, live(), undefined, undefined, src);
  expect(no).toEqual({ text: "Refused by a hook: force push blocked", fail: true });
  expect(fs.existsSync(mark)).toBe(false);
  const yes = await Machine.run({ name: "shell", input: { command: "touch " + mark }, cwd: "Ann" }, DIR, live(), undefined, undefined, src);
  expect(yes.fail).toBe(false);
  expect(fs.existsSync(mark)).toBe(true);
  // an edit is refused whole when one of its files is denied: no file changes
  fs.mkdirSync(DIR + "/Ann", { recursive: true });
  fs.writeFileSync(DIR + "/Ann/a", "1");
  const eg = script("eg.sh", `grep -q secret && exit 2; exit 0`);
  const es: Source[] = [{ file: settings("edit", [group("Edit", eg)]), managed: true }];
  const edit = await Machine.run({ name: "edit", input: { edits: [{ path: "a", old: "1", new: "2" }, { path: "secret", old: "x", new: "y" }] }, cwd: "Ann" }, DIR, live(), undefined, undefined, es);
  expect(edit.fail).toBe(true);
  expect(fs.readFileSync(DIR + "/Ann/a", "utf8")).toBe("1");
});

// the real OnCorps guard, where it is installed: a critical command refused
const GUARD = "/Library/Application Support/OnCorps/claude-guard/guard.py";
test.skipIf(!fs.existsSync(GUARD))("the installed OnCorps guard refuses a critical command through Legion", async () => {
  const src: Source[] = [{ file: settings("oncorps", [group("Bash", `'${GUARD}'`)]), managed: true }];
  const bad = await Hooks.pre(src, "Bash", { command: "rm -rf /" }, DIR, "A", live());
  expect(bad.deny).toContain("OnCorps guard");
  expect((await Hooks.pre(src, "Bash", { command: "ls" }, DIR, "A", live())).deny).toBeNull();
});

// RED ZONE (security review follow-up, DRAFT awaiting the user's
// sign-off): Claude Code reads the user's settings from $CLAUDE_CONFIG_DIR
// when it is set (else ~/.claude): so does Hooks.sources, and write and
// edit refuse all of it, by its path or real one, in any case
test("the user's settings come from $CLAUDE_CONFIG_DIR, and write and edit refuse it", async () => {
  const was = process.env.CLAUDE_CONFIG_DIR;
  const conf = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-conf-"));
  fs.symlinkSync(conf, DIR + "/conflink");
  const repo = fs.mkdtempSync(DIR + "/cproj-");
  try {
    process.env.CLAUDE_CONFIG_DIR = DIR + "/conflink";
    expect(Hooks.sources(repo).filter((s) => s.project !== true && !s.managed).map((s) => s.file)).toEqual([DIR + "/conflink/settings.json"]);
    for (const p of [conf + "/settings.json", conf.toUpperCase() + "/hooks/x.sh", DIR + "/conflink/agents/x.md", os.homedir() + "/.claude/x.md"]) {
      expect([p, Machine.gating(p)]).toEqual([p, true]);
    }
    const run = await Machine.run({ name: "write", input: { path: conf + "/Settings.json", content: "{}" }, cwd: "C" }, DIR, live(), undefined, undefined, []);
    expect(run.fail).toBe(true);
    expect(fs.readdirSync(conf)).toEqual([]);
    expect(Machine.gating(repo + "/notes.md")).toBe(false);
    process.env.CLAUDE_CONFIG_DIR = "";
    expect(Hooks.sources(repo).filter((s) => s.project !== true && !s.managed).map((s) => s.file)).toEqual([os.homedir() + "/.claude/settings.json"]);
  } finally {
    was === undefined ? delete process.env.CLAUDE_CONFIG_DIR : (process.env.CLAUDE_CONFIG_DIR = was);
  }
});
