// Machine test
// ============
// `bun test Machine.test.ts`. The device tools' answers at their edges.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { ENV, Machine } from "./Machine.ts";

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

// Security review (M2, M3, M4): what a job may reach on this device
// ================================================================

// M2: a job's shell and a claude worker get an allowlisted environment:
// none of this unii's secrets (its gateway key, the vendors', a token)
test("a job's shell and a claude worker get none of this unii's secrets", async () => {
  const fake = { LITELLM_API_KEY: "fake-1", ANTHROPIC_API_KEY: "fake-2", OPENAI_API_KEY: "fake-3", GH_TOKEN: "fake-4", RESEND_API_KEY: "fake-5", ANTHROPIC_BASE_URL: "http://gw.example" };
  const was = Object.fromEntries(Object.keys(fake).map((k) => [k, process.env[k]]));
  Object.assign(process.env, fake);
  const bin = fs.mkdtempSync(os.tmpdir() + "/unii-bin-");
  const seen = bin + "/env";
  fs.writeFileSync(bin + "/claude", "#!/bin/sh\nenv | cut -d= -f1 > " + seen + "\n");
  fs.chmodSync(bin + "/claude", 0o755);
  const path = process.env.PATH;
  process.env.PATH = bin + ":" + path;
  try {
    const live = new AbortController().signal;
    // names only: a value is never printed
    const out = await Machine.run({ name: "shell", input: { command: "env | cut -d= -f1" }, cwd: "Env" }, DIR + "/work", live, undefined, undefined, []);
    const names = out.text.split("\n").slice(0, -1).filter((n) => !["PWD", "OLDPWD", "SHLVL", "_"].includes(n)); // the shell's own
    for (const k of ["LITELLM_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GH_TOKEN", "RESEND_API_KEY", "ANTHROPIC_BASE_URL"]) {
      expect([k, names.includes(k)]).toEqual([k, false]);
    }
    expect(names).toEqual(expect.arrayContaining(["PATH", "HOME", "UNII_RUN"]));
    expect(names.every((n) => ENV.test(n))).toBe(true);
    await Machine.run({ name: "claude", input: { task: "x" }, cwd: "Env" }, DIR + "/work", live);
    const told = fs.readFileSync(seen, "utf8").split("\n").filter((n) => n !== "");
    for (const k of ["LITELLM_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GH_TOKEN", "RESEND_API_KEY"]) {
      expect([k, told.includes(k)]).toEqual([k, false]);
    }
    // the gateway's address (not a secret) it may need; its key comes from Claude Code's apiKeyHelper
    expect(told).toEqual(expect.arrayContaining(["PATH", "HOME", "UNII_RUN", "ANTHROPIC_BASE_URL"]));
  } finally {
    process.env.PATH = path;
    for (const [k, v] of Object.entries(was)) {
      v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
  }
});

// M4: read, grep and glob refuse a secret's path (a key, credentials, a
// token, ~/.ssh, ~/.aws, a repo's .git/config), its real path too (a
// symlink); a grep over a dir leaves secrets' files out
test("read, grep and glob refuse secrets' paths; a grep over a dir leaves them out", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-secret-"));
  fs.mkdirSync(root + "/Ann/.ssh", { recursive: true });
  fs.mkdirSync(root + "/Ann/.aws");
  fs.mkdirSync(root + "/Ann/repo/.git", { recursive: true });
  fs.writeFileSync(root + "/Ann/.ssh/id_ed25519", "PRIVATE pass\n");
  fs.writeFileSync(root + "/Ann/.aws/credentials", "aws pass\n");
  fs.writeFileSync(root + "/Ann/repo/.git/config", "[remote] url = https://u:pass@h\n");
  fs.writeFileSync(root + "/Ann/token", "pass\n");
  fs.writeFileSync(root + "/Ann/sa-key.json", "{\"pass\": 1}\n");
  fs.writeFileSync(root + "/Ann/my-service-account.json", "{\"pass\": 1}\n");
  fs.writeFileSync(root + "/Ann/credentials.json", "{\"pass\": 1}\n");
  fs.writeFileSync(root + "/Ann/notes.md", "pass\n");
  fs.writeFileSync(root + "/Ann/keyboard.json", "{\"pass\": 1}\n");
  fs.symlinkSync(root + "/Ann/.ssh/id_ed25519", root + "/Ann/innocent.txt");
  const live = new AbortController().signal;
  const run = (name: string, input: object) => Machine.run({ name, input, cwd: "Ann" }, root, live, undefined, undefined, []);
  for (const p of [".ssh/id_ed25519", root + "/Ann/.aws/credentials", "repo/.git/config", "token", "sa-key.json", "my-service-account.json", "credentials.json", "innocent.txt"]) {
    const r = await run("read", { path: p });
    expect([p, r.fail, r.text]).toEqual([p, true, expect.stringContaining("secret")]);
  }
  expect((await run("read", { path: "notes.md" })).text).toContain("pass");
  expect((await run("read", { path: "keyboard.json" })).fail).toBe(false);
  expect((await run("grep", { pattern: "pass", path: ".ssh" })).text).toContain("secret");
  expect((await run("glob", { pattern: "*", path: root + "/Ann/.aws" })).text).toContain("secret");
  for (const rg of [Bun.which("rg"), null]) {
    for (const mode of ["files", "content", "count"]) {
      const g = await Machine.grep(root + "/Ann", { pattern: "pass", mode }, live, rg);
      expect([rg, mode, g.text.includes("notes.md"), g.text.includes("keyboard.json"), /token|sa-key|service-account|credentials|innocent/.test(g.text)]).toEqual([rg, mode, true, true, false]);
    }
  }
  // content mode keeps grep's own separators
  expect((await Machine.grep(root + "/Ann", { pattern: "pass", mode: "content", glob: "notes.md" }, live, Bun.which("rg"))).text).toBe("notes.md:1:pass");
});

// M3: write and edit refuse the files that gate the hooks: any
// .claude/settings*.json (a project's: its hooks, disableAllHooks) and
// anything under ~/.claude, by the path given or its real one
test("write and edit refuse Claude Code's settings files and ~/.claude", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-guard-"));
  fs.mkdirSync(root + "/Ann/.claude", { recursive: true });
  fs.writeFileSync(root + "/Ann/.claude/settings.local.json", "{}");
  fs.symlinkSync(root + "/Ann/.claude", root + "/Ann/cfg");
  const live = new AbortController().signal;
  const run = (name: string, input: object) => Machine.run({ name, input, cwd: "Ann" }, root, live, undefined, undefined, []);
  const off = "{\"disableAllHooks\":true}";
  expect((await run("write", { path: ".claude/settings.json", content: off })).text).toContain("hooks");
  expect((await run("write", { path: "cfg/settings.json", content: off })).fail).toBe(true);
  expect(fs.existsSync(root + "/Ann/.claude/settings.json")).toBe(false);
  expect((await run("edit", { edits: [{ path: "notes", old: "a", new: "b" }, { path: ".claude/settings.local.json", old: "{}", new: off }] })).fail).toBe(true);
  expect(fs.readFileSync(root + "/Ann/.claude/settings.local.json", "utf8")).toBe("{}");
  const mine = os.homedir() + "/.claude/legion-guard-" + crypto.randomUUID();
  try {
    expect((await run("write", { path: mine + "/x.md", content: "x" })).fail).toBe(true);
    expect(fs.existsSync(mine)).toBe(false);
  } finally {
    fs.rmSync(mine, { recursive: true, force: true });
  }
  expect((await run("write", { path: ".claude/notes.md", content: "ok" })).fail).toBe(false);
});

// RED ZONE (security review follow-up, DRAFT awaiting the user's
// sign-off): macOS's disk is case-insensitive, so .claude/SETTINGS.json,
// .Claude/settings.local.json and ~/.CLAUDE are the same files: refused
// too, made or not
test("write and edit refuse the settings files and ~/.claude in any case", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-case-"));
  fs.mkdirSync(root + "/Ann/.claude", { recursive: true });
  const live = new AbortController().signal;
  const run = (name: string, input: object) => Machine.run({ name, input, cwd: "Ann" }, root, live, undefined, undefined, []);
  for (const p of [".claude/SETTINGS.LOCAL.JSON", ".Claude/settings.local.json", "newproj/.CLAUDE/Settings.json", os.homedir() + "/.CLAUDE/legion-case-" + crypto.randomUUID() + "/x.md"]) {
    expect([p, (await run("write", { path: p, content: "{}" })).fail]).toEqual([p, true]);
  }
  expect(fs.readdirSync(root + "/Ann/.claude")).toEqual([]);
  expect(fs.existsSync(root + "/Ann/newproj")).toBe(false);
});

// one secret list (Modes.ts) for read, grep, glob, the files pane and the
// shell: the dotfiles that hold a login, in any case
test("read refuses every dotfile that holds a login, in any case", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-dots-"));
  const files = [".git-credentials", ".pgpass", ".claude.json", ".npmrc", ".pypirc", ".kube/config", ".docker/config.json", ".config/gh/hosts.yml"];
  for (const f of files) {
    fs.mkdirSync(root + "/Ann/" + f.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(root + "/Ann/" + f, "pass\n");
  }
  const live = new AbortController().signal;
  const run = (name: string, input: object) => Machine.run({ name, input, cwd: "Ann" }, root, live, undefined, undefined, []);
  for (const p of [...files, ".GIT-CREDENTIALS", ".Kube/config", ".SSH/id_rsa", ".config/GH/hosts.yml"]) {
    expect([p, Machine.secret(root + "/Ann/" + p), (await run("read", { path: p })).fail]).toEqual([p, true, true]);
  }
  // not made yet: no real path to canonicalize its case
  for (const p of ["/nowhere/.KUBE/config", "/nowhere/.Ssh/known", "/nowhere/repo/.GIT/Config", "/nowhere/.GIT-Credentials"]) {
    expect([p, Machine.secret(p)]).toEqual([p, true]);
  }
});

// M2: a job keeps the proxy and CA settings it needs to reach the
// network (none a secret, but a proxy's URL may hold its login)
test("a job's environment keeps proxies, CA bundles and CLAUDE_CONFIG_DIR", () => {
  for (const k of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "ALL_PROXY", "all_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CLAUDE_CONFIG_DIR"]) {
    expect([k, ENV.test(k)]).toEqual([k, true]);
  }
  for (const k of ["GH_TOKEN", "HTTPS_PROXY_PASSWORD", "CLAUDE_CODE_OAUTH_TOKEN", "AWS_SECRET_ACCESS_KEY"]) {
    expect([k, ENV.test(k)]).toEqual([k, false]);
  }
});

// the Mac's disk folds Unicode lookalikes too (ſ is s, K is K): a
// settings file spelled with them is still refused (round-2 check)
test("write refuses a settings file spelled with Unicode lookalikes", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-fold-"));
  fs.mkdirSync(root + "/Ann/.claude", { recursive: true });
  const live = new AbortController().signal;
  const run = (name: string, input: object) => Machine.run({ name, input, cwd: "Ann" }, root, live, undefined, undefined, []);
  for (const p of [".claude/ſettings.local.json", ".claude/ＳＥＴＴＩＮＧＳ.json", ".claude/settings.local.json".normalize("NFD")]) {
    expect([p, (await run("write", { path: p, content: "{}" })).fail]).toEqual([p, true]);
  }
  expect(fs.readdirSync(root + "/Ann/.claude")).toEqual([]);
});

test("read refuses a secret path spelled with Unicode lookalikes", () => {
  for (const p of [os.homedir() + "/.ſsh/github_ed25519", os.homedir() + "/.pgpaſſ", os.homedir() + "/.ＡＷＳ/credentials"]) {
    expect([p, Machine.secret(p)]).toEqual([p, true]);
  }
});

// Legion's own config (~/.unii, or $UNII_DIR): config.json holds mcp_reads
// (what auto mode skips and plan mode runs), mcp.json the commands started;
// an agent's write or edit reaches none of them, in any case
test("write and edit refuse Legion's config.json, mcp.json and mcp.local.json", () => {
  for (const f of ["config.json", "mcp.json", "mcp.local.json", "MCP.json"]) {
    expect([f, Machine.gating(os.homedir() + "/.unii/" + f)]).toEqual([f, true]);
  }
  expect(Machine.gating(os.homedir() + "/.unii/okf-gaps.jsonl")).toBe(false);
  expect(Machine.gating(os.homedir() + "/.unii/work/config.json")).toBe(false);
});
