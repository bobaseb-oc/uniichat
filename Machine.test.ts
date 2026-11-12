// Machine test
// ============
// `bun test Machine.test.ts`. The device tools' answers at their edges.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Machine } from "./Machine.ts";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-machine-");

test("a read past a file's end says so, never an empty range", () => {
  const file = DIR + "/three";
  fs.writeFileSync(file, "a\nb\nc\n");
  expect(Machine.read(file, 3, Infinity, 0)).toEqual({ text: "c\n[lines 3-3 of 3]", fail: false });
  expect(Machine.read(file, 9, Infinity, 0)).toEqual({ text: "No lines from line 9: the file has 3.", fail: true });
  expect(Machine.read(file, 2, 0, 0)).toEqual({ text: "No lines from line 2: the file has 3.", fail: true });
});

test("a shell's output is decoded whole: a char split over writes, a broken one at its end", async () => {
  const live = new AbortController().signal;
  const split = await Machine.shell(DIR, "printf 'a\\303'; sleep 0.1; printf '\\251b'", live);
  expect(split.text).toStartWith("aéb\n(exit 0 in ");
  const broken = await Machine.shell(DIR, "printf 'ab\\303'", live);
  expect(broken.text).toStartWith("ab�\n(exit 0 in ");
});

test("a shell sent away answers at once; its file gets the rest and the exit", async () => {
  const stop = new AbortController();
  const away = new AbortController();
  const run  = Machine.shell(DIR, "echo early; sleep 0.5; echo late", stop.signal, away.signal);
  await Bun.sleep(150);
  away.abort();
  const out  = await run;
  const file = DIR + "/" + /bg-\d+\.log/.exec(out.text)![0];
  expect(out.fail).toBe(false);
  expect(out.text).toContain("still running");
  expect(fs.readFileSync(file, "utf8")).toBe("early\n");
  await Bun.sleep(700);
  expect(fs.readFileSync(file, "utf8")).toMatch(/^early\nlate\n\(exit 0 in [\d.]+ s\)\n$/);
});

test("a shell not sent away waits for its command to end", async () => {
  const away = new AbortController();
  const out  = await Machine.shell(DIR, "sleep 0.3; echo done", new AbortController().signal, away.signal);
  expect(out.text).toStartWith("done\n(exit 0 in ");
  const logs = () => fs.readdirSync(DIR).filter((f) => f.startsWith("bg-")).length;
  const was  = logs();
  away.abort();
  expect(logs()).toBe(was);
});

test("a stop still kills a shell that may be sent away", async () => {
  const stop = new AbortController();
  const run  = Machine.shell(DIR, "sleep 5; echo never", stop.signal, new AbortController().signal);
  setTimeout(() => stop.abort(), 100);
  const out  = await run;
  expect(out.text).not.toContain("never");
  expect(out.text).toContain("(stopped in ");
});

// Unii's jobs (cwd "main") run in the device's home repo when it has one;
// an agent's in its own dir under the work dir, home or not
test("Unii's jobs run in the home repo; an agent's in its own work dir", async () => {
  const home = fs.mkdtempSync(os.tmpdir() + "/unii-home-");
  const work = DIR + "/work";
  const pwd = async (cwd: string, h?: string) => (await Machine.run({ name: "shell", input: { command: "pwd -P" }, cwd }, work, new AbortController().signal, undefined, h)).text.split("\n")[0].trim();
  expect(await pwd("main", home)).toBe(fs.realpathSync(home));
  expect(await pwd("FireAnt", home)).toBe(fs.realpathSync(work) + "/FireAnt");
  expect(await pwd("main")).toBe(fs.realpathSync(work) + "/main");
});

// a Claude Code worker: `claude -p` in auto mode, its stream-json events
// read into transcript lines, its result last; a stop kills it. A fake
// claude on PATH tells its arguments and its directory
test("claude runs headless in auto mode; its events come back as a transcript, its result last", async () => {
  const bin = fs.mkdtempSync(os.tmpdir() + "/unii-bin-");
  const seen = bin + "/args";
  const events = [
    { type: "system", subtype: "init" },
    { type: "assistant", message: { content: [{ type: "text", text: "Looking." }, { type: "tool_use", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "a.txt" }] } },
    { type: "result", subtype: "success", is_error: false, result: "Found a.txt.", total_cost_usd: 0.0123 },
  ];
  fs.writeFileSync(bin + "/claude", "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + seen + "\npwd -P >> " + seen + "\n" + events.map((e) => "echo '" + JSON.stringify(e) + "'").join("\n") + "\n");
  fs.chmodSync(bin + "/claude", 0o755);
  const path = process.env.PATH;
  process.env.PATH = bin + ":" + path;
  try {
    const work = DIR + "/work";
    const out = await Machine.run({ name: "claude", input: { task: "find files" }, cwd: "Bot" }, work, new AbortController().signal);
    expect(out.fail).toBe(false);
    expect(out.text).toBe("unii: Looking.\ntool: Bash({\"command\":\"ls\"})\necho: a.txt\n\nResult ($0.0123): Found a.txt.");
    const args = fs.readFileSync(seen, "utf8").split("\n");
    expect(args.slice(0, 7)).toEqual(["-p", "find files", "--permission-mode", "auto", "--output-format", "stream-json", "--verbose"]);
    expect(args[7]).toBe(fs.realpathSync(work) + "/Bot");
    const there = fs.mkdtempSync(os.tmpdir() + "/unii-repo-");
    await Machine.run({ name: "claude", input: { task: "x", dir: there }, cwd: "Bot" }, work, new AbortController().signal);
    expect(fs.readFileSync(seen, "utf8").split("\n")[7]).toBe(fs.realpathSync(there));
  } finally {
    process.env.PATH = path;
  }
});

test("a claude transcript past its cap keeps its end and says it was cut; no result is a failure", () => {
  const lines = Array.from({ length: 50 }, (_, k) => "echo: " + k + " " + "z".repeat(100));
  const out = Machine.claude_out(lines, null, 1000);
  expect(out.fail).toBe(true);
  expect(out.text.startsWith("(earlier steps cut)\n")).toBe(true);
  expect(out.text).toContain("echo: 49 ");
  expect(out.text).not.toContain("echo: 0 ");
  expect(out.text.length).toBeLessThan(1200);
  expect(Machine.claude_line({ type: "result" })).toBeNull();
  expect(Machine.claude_line({ type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "x" }] }] } })).toBe("echo: x");
});

// a small tree for glob and grep: two .ts files (b newer), a .md, a hidden
// file and node_modules (left out), a binary
function tree(): string {
  const root = fs.mkdtempSync(os.tmpdir() + "/legion-find-");
  fs.mkdirSync(root + "/src/deep", { recursive: true });
  fs.mkdirSync(root + "/node_modules/x", { recursive: true });
  fs.writeFileSync(root + "/src/a.ts", "const Alpha = 1;\nconst beta = 2;\n");
  fs.writeFileSync(root + "/src/deep/b.ts", "// alpha here\nexport const gamma = 3;\n");
  fs.writeFileSync(root + "/README.md", "Alpha and beta\n");
  fs.writeFileSync(root + "/.hidden.ts", "alpha\n");
  fs.writeFileSync(root + "/node_modules/x/c.ts", "alpha\n");
  fs.writeFileSync(root + "/bin.dat", Buffer.from([0, 97, 108, 112, 104, 97, 0]));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(root + "/src/a.ts", old, old);
  return root;
}

test("glob finds files by pattern, newest first, without hidden files or node_modules", () => {
  const root = tree();
  expect(Machine.glob(root, "**/*.ts", undefined)).toEqual({ text: "src/deep/b.ts\nsrc/a.ts", fail: false });
  expect(Machine.glob(root, "*.ts", root + "/src")).toEqual({ text: "a.ts", fail: false });
  expect(Machine.glob(root, "**/*.py", undefined)).toEqual({ text: "No files match **/*.py.", fail: false });
  expect(Machine.glob(root, "*", root + "/nope").fail).toBe(true);
});

for (const [how, rg] of [["ripgrep", Bun.which("rg")], ["no ripgrep", null]] as const) {
  test.skipIf(how === "ripgrep" && rg === null)("grep (" + how + "): files, content with line numbers, counts, case, glob filter", async () => {
    const root = tree();
    const live = new AbortController().signal;
    const g = (input: object) => Machine.grep(root, input, live, rg);
    expect(await g({ pattern: "alpha" })).toEqual({ text: "src/deep/b.ts", fail: false });
    expect(await g({ pattern: "alpha", ignore_case: true })).toEqual({ text: "README.md\nsrc/a.ts\nsrc/deep/b.ts", fail: false });
    expect(await g({ pattern: "alpha", ignore_case: true, glob: "*.ts" })).toEqual({ text: "src/a.ts\nsrc/deep/b.ts", fail: false });
    expect(await g({ pattern: "const \\w+ =", mode: "content", path: "src" })).toEqual({ text: "a.ts:1:const Alpha = 1;\na.ts:2:const beta = 2;\ndeep/b.ts:2:export const gamma = 3;", fail: false });
    expect(await g({ pattern: "const", mode: "count" })).toEqual({ text: "src/a.ts:2\nsrc/deep/b.ts:1", fail: false });
    expect(await g({ pattern: "beta", mode: "content", context: 1, path: "src/a.ts" })).toEqual({ text: "a.ts-1-const Alpha = 1;\na.ts:2:const beta = 2;", fail: false });
    expect(await g({ pattern: "zzz" })).toEqual({ text: "No matches for zzz.", fail: false });
    expect((await g({ pattern: "(" })).fail).toBe(true);
  });
}

test("glob and grep run as device tools, in the agent's dir", async () => {
  const root = tree();
  fs.renameSync(root + "/src", root + "/Ann");
  const live = new AbortController().signal;
  const run = (name: string, input: object) => Machine.run({ name, input, cwd: "Ann" }, root, live, undefined, undefined, []);
  expect(await run("glob", { pattern: "**/*.ts" })).toEqual({ text: "deep/b.ts\na.ts", fail: false });
  expect(await run("grep", { pattern: "gamma" })).toEqual({ text: "deep/b.ts", fail: false });
});
