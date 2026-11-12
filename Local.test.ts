// Local test
// ==========
// `bun test Local.test.ts`. This build's local-only changes: the Claude
// API's origin set by `anthropic_url` (a proxy, e.g. LiteLLM), and a
// `unii` that opens 127.0.0.1 unless told otherwise and never updates
// itself by `curl | sh`. Each runs in its own process, as Config reads
// the environment once, at its import.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-local-");

// `code` run by bun in this dir, with `env`: its output, trimmed
function run(code: string, env: Record<string, string> = {}): string {
  const out = Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...process.env, UNII_DIR: DIR, ...env } });
  return (out.stdout.toString() + out.stderr.toString()).trim();
}

// `bun Term.ts <args>` with `env` (no UNII_URL): its exit code and output
function term(args: string[], env: Record<string, string> = {}): { code: number; text: string } {
  const { UNII_URL, ...rest } = process.env;
  const out = Bun.spawnSync([process.execPath, import.meta.dir + "/Term.ts", ...args], { env: { ...rest, UNII_HOME: DIR, UNII_NO_TELEMETRY: "1", ...env } });
  return { code: out.exitCode, text: out.stdout.toString() + out.stderr.toString() };
}

test("the Claude API's origin is api.anthropic.com unless anthropic_url sets it", () => {
  const { UNII_ANTHROPIC_URL, ...rest } = process.env;
  const code = 'import { ANTHROPIC_URL } from "./Config.ts"; console.log(ANTHROPIC_URL)';
  const out = Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...rest, UNII_DIR: DIR } });
  expect(out.stdout.toString().trim()).toBe("https://api.anthropic.com");
  expect(run(code, { UNII_ANTHROPIC_URL: "https://proxy.example/" })).toBe("https://proxy.example");
});

test("messages and token counts both go to anthropic_url, with the key", async () => {
  const seen: string[] = [];
  const proxy = Bun.serve({
    hostname : "127.0.0.1",
    port     : 0,
    fetch    : (req) => {
      seen.push(new URL(req.url).pathname + " " + req.headers.get("x-api-key"));
      return Response.json({ input_tokens: 7 });
    },
  });
  const origin = "http://127.0.0.1:" + proxy.port;
  const code = [
    'import { Anthropic } from "./Anthropic.ts";',
    "console.log(Anthropic.wire.url);",
    'console.log(await Anthropic.count("k-test", { speed: "slow" } as any, { max_tokens: 1, stream: true, messages: [] }));',
  ].join("\n");
  const out = Bun.spawn([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...process.env, UNII_DIR: DIR, UNII_ANTHROPIC_URL: origin }, stdout: "pipe" });
  const text = (await new Response(out.stdout).text()).trim();
  proxy.stop(true);
  expect(text).toBe(origin + "/v1/messages\n7");
  expect(seen).toEqual(["/v1/messages/count_tokens k-test"]);
});

test("unii opens the local server unless told another", () => {
  const help = term(["help"]);
  expect(help.text).toContain("else http://127.0.0.1:8788");
  expect(help.text).not.toContain("uniichat.com");
});

test("unii update refuses, and never runs curl", () => {
  const bin = fs.mkdtempSync(os.tmpdir() + "/unii-bin-");
  const mark = bin + "/ran";
  fs.writeFileSync(bin + "/curl", "#!/bin/sh\ntouch '" + mark + "'\n", { mode: 0o755 });
  const out = term(["update"], { PATH: bin + ":" + process.env.PATH });
  expect(out.code).not.toBe(0);
  expect(out.text).toContain("disabled");
  expect(fs.existsSync(mark)).toBe(false);
});

test("web searches per request: 10 unless `searches` sets them (0: no web tool)", () => {
  const { UNII_SEARCHES, ...rest } = process.env;
  const code = 'import { SEARCHES } from "./Tools.ts"; console.log(SEARCHES)';
  const out = Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...rest, UNII_DIR: DIR } });
  expect(out.stdout.toString().trim()).toBe("10");
  expect(run(code, { UNII_SEARCHES: "0" })).toBe("0");
});

test("unii refuses a server not on this computer, given or from UNII_URL", () => {
  for (const [args, env] of [[["https://uniichat.invalid"], {}], [[], { UNII_URL: "https://example.invalid" }]] as const) {
    const out = term([...args], env);
    expect(out.code).not.toBe(0);
    expect(out.text).toContain("this computer only");
  }
});

// the code this build runs (not docs, tests, nor the iOS app it never
// builds), each line not a comment
test("no code names uniichat.com or bend-lang.com", () => {
  const files = Bun.spawnSync(["git", "ls-files"], { cwd: import.meta.dir }).stdout.toString().split("\n")
    .filter((f) => /\.(ts|js|html|sh|txt|swift|css)$|^hello\.md$/.test(f) && !f.endsWith(".test.ts") && !f.startsWith("ios/"));
  const hits = files.flatMap((f) => fs.readFileSync(import.meta.dir + "/" + f, "utf8").split("\n")
    .map((line, n) => [f + ":" + (n + 1), line] as const)
    .filter(([, line]) => /uniichat\.com|bend-lang\.com/.test(line) && !/^\s*(\/\/|#)/.test(line))
    .map(([at]) => at));
  expect(hits).toEqual([]);
});

test("import reads Claude Code's and Codex's folders, unless UNII_IMPORT_DIRS names others", () => {
  const code = 'import { import_dirs } from "./Import.ts"; console.log(JSON.stringify(import_dirs(process.env, "/h")))';
  const { UNII_IMPORT_DIRS, CLAUDE_CONFIG_DIR, CODEX_HOME, ...rest } = process.env;
  const out = (env: Record<string, string>) => JSON.parse(Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...rest, ...env } }).stdout.toString());
  expect(out({})).toEqual(["/h/.claude/projects", "/h/.codex/sessions", "/h/.codex/archived_sessions"]);
  expect(out({ UNII_IMPORT_DIRS: "/s/claude/projects:/t" })).toEqual(["/s/claude/projects", "/t"]);
});

// Tools.rules on a tree of files in its own process (Config reads
// UNII_RULES once): its text at each `step` (files written before it)
function rules_at(files: Record<string, string>, steps: Record<string, string>[]): string[] {
  const root = fs.mkdtempSync(os.tmpdir() + "/unii-rules-");
  const write = (fs_: Record<string, string>) => Object.entries(fs_).forEach(([f, text]) => (fs.mkdirSync(require("node:path").dirname(root + "/" + f), { recursive: true }), fs.writeFileSync(root + "/" + f, text.replaceAll("$ROOT", root))));
  write(files);
  fs.writeFileSync(root + "/steps.json", JSON.stringify(steps));
  const code = [
    'import { Tools } from "./Tools.ts"; import * as fs from "node:fs";',
    "const root = " + JSON.stringify(root) + "; const out = [];",
    'for (const step of JSON.parse(fs.readFileSync(root + "/steps.json", "utf8"))) {',
    '  for (const [f, t] of Object.entries(step)) fs.writeFileSync(root + "/" + f, t);',
    "  out.push(Tools.rules());",
    "}",
    "console.log(JSON.stringify(out));",
  ].join("\n");
  const run = Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...process.env, UNII_DIR: DIR, UNII_RULES: root + "/top.md" } });
  return JSON.parse(run.stdout.toString() || '["' + run.stderr.toString().replace(/["\\\n]/g, " ") + '"]');
}

test("rules expand @imports as Claude Code's: relative, absolute, nested; fences, missing files and loops kept", () => {
  const [text] = rules_at({
    "top.md"      : "Top\n@sub/a.md\n@$ROOT/abs.md\n```\n@sub/a.md\n```\n@nowhere.md\nmail me @ noon",
    "sub/a.md"    : "A\n@b.md",
    "sub/b.md"    : "B\n@../top.md",
    "abs.md"      : "Abs",
  }, [{}]);
  expect(text).toBe("Top\nA\nB\n@../top.md\nAbs\n```\n@sub/a.md\n```\n@nowhere.md\nmail me @ noon");
});

test("rules are read anew at each call: an edited import shows at the next", () => {
  const [before, after] = rules_at({ "top.md": "@inc.md", "inc.md": "old rule" }, [{}, { "inc.md": "new rule" }]);
  expect(before).toBe("old rule");
  expect(after).toBe("new rule");
});

test("rules stop expanding at depth 5", () => {
  const files: Record<string, string> = { "top.md": "@d1.md" };
  for (let i = 1; i <= 7; i++) files["d" + i + ".md"] = "L" + i + "\n@d" + (i + 1) + ".md";
  const [text] = rules_at(files, [{}]);
  expect(text).toBe("L1\nL2\nL3\nL4\nL5\n@d6.md");
});

// Bun 1.3.8: a Bun.file streamed (the importer reads a session's file as
// a stream) ends a raw stdin at its next key, so the terminal sent what
// was typed and quit; Term reads import files whole into memory instead
test("the terminal reads import files whole, never as Bun.file streams", () => {
  const term = fs.readFileSync(import.meta.dir + "/Term.ts", "utf8");
  const body = (name: string) => term.slice(term.indexOf("async function " + name), term.indexOf("\n}\n", term.indexOf("async function " + name)));
  for (const name of ["term_sessions", "export_sessions"]) {
    expect(body(name)).not.toContain("Bun.file(");
    expect(body(name)).toContain("import_blob(");
  }
});
