// Lsp test
// ========
// `bun test Lsp.test.ts`. The `lsp` tool's client: a fake language
// server (a bun script) spoken to in Content-Length frames, a reply split
// over writes and counted in bytes; each operation's request and output,
// positions 1-based for the model and 0-based on the wire; diagnostics
// pulled or pushed; a file changed on disk sent anew; the server's own
// requests answered; one server per project root, closed when idle.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Lsp } from "./Lsp.ts";
import { Mcp } from "./Mcp.ts";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-lsp-");
Mcp.sweep(DIR + "/children.pids");

const FAKE = DIR + "/fake.ts";
fs.writeFileSync(FAKE, `
const PUSH = process.env.FAKE_PUSH === "1";
const docs = new Map();
let configured = false;
let hang = false; // as pyright 1.1.408 does for a client that says it supports workspace folders
const send = async (msg, split = false) => {
  const body = new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  const frame = new Uint8Array([...new TextEncoder().encode("Content-Length: " + body.length + "\\r\\n\\r\\n"), ...body]);
  if (!split) { process.stdout.write(frame); return; }
  const cut = frame.length - 5;
  process.stdout.write(frame.subarray(0, cut));
  await Bun.sleep(30);
  process.stdout.write(frame.subarray(cut));
};
const at = (line, character) => ({ start: { line, character }, end: { line, character } });
let buf = new Uint8Array(0);
for await (const chunk of Bun.stdin.stream()) {
  buf = new Uint8Array([...buf, ...chunk]);
  for (;;) {
    const head = new TextDecoder().decode(buf).match(/^Content-Length: (\\d+)\\r\\n\\r\\n/);
    if (!head) break;
    const start = new TextEncoder().encode(head[0]).length, n = Number(head[1]);
    if (buf.length < start + n) break;
    const m = JSON.parse(new TextDecoder().decode(buf.subarray(start, start + n)));
    buf = buf.subarray(start + n);
    const p = m.params ?? {};
    const doc = docs.get(p.textDocument?.uri);
    if (hang && m.method !== "initialize") continue;
    if (m.id === 99 && m.method === undefined) { configured = Array.isArray(m.result) && m.result.length === 1; continue; }
    switch (m.method) {
      case "initialize": hang = p.capabilities?.workspace?.workspaceFolders === true;
        send({ id: m.id, result: { capabilities: { textDocumentSync: 1, ...(PUSH ? {} : { diagnosticProvider: {} }) } } }); break;
      case "initialized": send({ id: 99, method: "workspace/configuration", params: { items: [{ section: "fake" }] } }); break;
      case "textDocument/didOpen":
        docs.set(p.textDocument.uri, { version: p.textDocument.version, text: p.textDocument.text });
        if (PUSH) setTimeout(() => send({ method: "textDocument/publishDiagnostics", params: { uri: p.textDocument.uri, diagnostics: [{ range: at(2, 0), severity: 2, message: "push v" + p.textDocument.version }] } }), 50);
        break;
      case "textDocument/didChange": docs.set(p.textDocument.uri, { version: p.textDocument.version, text: p.contentChanges[0].text }); break;
      case "textDocument/definition": {
        const t0 = Date.now();
        const reply = () => configured || Date.now() - t0 > 1000 ? send({ id: m.id, result: configured ? [{ uri: p.textDocument.uri, range: at(p.position.line + 1, p.position.character) }] : null }) : setTimeout(reply, 10);
        reply();
        break;
      }
      case "textDocument/references": send({ id: m.id, result: p.context?.includeDeclaration ? [{ uri: p.textDocument.uri, range: at(0, 6) }, { uri: p.textDocument.uri, range: at(2, 9) }] : [] }); break;
      case "textDocument/hover": send({ id: m.id, result: { contents: { kind: "markdown", value: "é— v" + doc.version + " pid=" + process.pid + " " + doc.text.split("\\n")[0] } } }, true); break;
      case "textDocument/documentSymbol": send({ id: m.id, result: [{ name: "Outer", kind: 5, range: at(0, 0), selectionRange: at(0, 0), children: [{ name: "inner", kind: 6, range: at(1, 2), selectionRange: at(1, 2) }] }] }); break;
      case "workspace/symbol": if (p.query === "slow") { setTimeout(() => send({ id: m.id, result: [] }), 300); break; }
        send({ id: m.id, result: [{ name: "Thing_" + p.query, kind: 12, location: { uri: "file:///x/y.ts", range: at(9, 0) } }] }); break;
      case "textDocument/diagnostic": send({ id: m.id, result: { kind: "full", items: [{ range: at(0, 4), severity: 1, message: "pull v" + doc.version, source: "fake", code: 7 }] } }); break;
      case "shutdown": send({ id: m.id, result: null }); break;
      case "exit": process.exit(0);
    }
  }
}
`);

const LANGS = {
  typescript : { command: process.execPath, args: [FAKE] },
  python     : { command: "/usr/bin/env", args: ["FAKE_PUSH=1", process.execPath, FAKE] },
};

// a project: a.ts and b.py under a git root
const PROJ = DIR + "/proj";
fs.mkdirSync(PROJ + "/.git", { recursive: true });
fs.mkdirSync(PROJ + "/src");
const A = PROJ + "/src/a.ts";
const B = PROJ + "/b.py";
fs.writeFileSync(A, "const one = 1;\nconst two = one + 1;\nexport { two };\n// é— sent in bytes\n");
fs.writeFileSync(B, "x = 1\ny = x\nprint(y)\n");

const go = () => new AbortController().signal;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("definition: 1-based in, 0-based on the wire, path:line:col and its source line out; the server's request answered", async () => {
  const pool = Lsp.pool(LANGS);
  const out = await Lsp.run(pool, { operation: "definition", file: A, line: 1, character: 1 }, go());
  expect(out).toEqual({ text: A + ":2:1\n    const two = one + 1;", fail: false });
  Mcp.end();
});

test("references, hover (split over writes, multibyte), symbols of a file and of the workspace", async () => {
  const pool = Lsp.pool(LANGS);
  const refs = await Lsp.run(pool, { operation: "references", file: A, line: 1, character: 7 }, go());
  expect(refs.text).toBe(A + ":1:7\n    const one = 1;\n" + A + ":3:10\n    export { two };");
  const hover = await Lsp.run(pool, { operation: "hover", file: A, line: 1, character: 7 }, go());
  expect(hover.text).toMatch(/^é— v1 pid=\d+ const one = 1;$/);
  const syms = await Lsp.run(pool, { operation: "documentSymbol", file: A }, go());
  expect(syms.text).toBe("Outer (class) line 1\n  inner (method) line 2");
  const ws = await Lsp.run(pool, { operation: "workspaceSymbol", file: A, query: "abc" }, go());
  expect(ws.text).toBe("Thing_abc (function) /x/y.ts:10:1");
  Mcp.end();
});

test("diagnostics pulled where the server offers it, else waited for; a file changed on disk is sent anew", async () => {
  const pool = Lsp.pool(LANGS);
  expect((await Lsp.run(pool, { operation: "diagnostics", file: A }, go())).text).toBe(A + ":1:5 error: pull v1 (fake 7)");
  expect((await Lsp.run(pool, { operation: "diagnostics", file: B }, go())).text).toBe(B + ":3:1 warning: push v1");
  fs.writeFileSync(A, "const uno = 1;\nconst two = uno + 1;\nexport { two };\n");
  fs.utimesSync(A, new Date(), new Date(Date.now() + 5000));
  expect((await Lsp.run(pool, { operation: "diagnostics", file: A }, go())).text).toBe(A + ":1:5 error: pull v2 (fake 7)");
  expect((await Lsp.run(pool, { operation: "hover", file: A, line: 1, character: 7 }, go())).text).toMatch(/ v2 pid=\d+ const uno = 1;$/);
  Mcp.end();
});

test("a project's root: the nearest folder up with .git, pyproject.toml, package.json or tsconfig.json", () => {
  fs.mkdirSync(PROJ + "/pkg/src", { recursive: true });
  fs.writeFileSync(PROJ + "/pkg/package.json", "{}");
  expect(Lsp.root(PROJ + "/pkg/src/x.ts")).toBe(PROJ + "/pkg");
  expect(Lsp.root(A)).toBe(PROJ);
  expect(Lsp.root("/no-such-dir-unii/x.py")).toBe("/no-such-dir-unii");
});

test("bad input fails in a line: unknown language, relative or missing file, unknown operation, no position", async () => {
  const pool = Lsp.pool(LANGS);
  fs.writeFileSync(PROJ + "/c.rs", "fn main() {}\n");
  const cases: Array<[object, string]> = [
    [{ operation: "hover", file: PROJ + "/c.rs", line: 1, character: 1 }, "No language server for .rs files here (Python, TypeScript, JavaScript)."],
    [{ operation: "hover", file: "src/a.ts", line: 1, character: 1 }, "Give the file's absolute path on this computer: src/a.ts"],
    [{ operation: "hover", file: PROJ + "/gone.ts", line: 1, character: 1 }, "No file " + PROJ + "/gone.ts on this computer."],
    [{ operation: "rename", file: A }, "No operation rename; one of definition, references, hover, documentSymbol, workspaceSymbol, diagnostics."],
    [{ operation: "hover", file: A }, "hover needs line and character (from 1)."],
  ];
  for (const [args, text] of cases) {
    expect(await Lsp.run(pool, args as any, go())).toEqual({ text, fail: true });
  }
  const none = Lsp.pool({ typescript: { command: DIR + "/no-such-server", args: [] } });
  const out = await Lsp.run(none, { operation: "hover", file: A, line: 1, character: 1 }, go());
  expect(out.fail).toBe(true);
  expect(out.text).toStartWith("typescript language server: ");
  expect(out.text).not.toContain("\n");
});

test("a server idle past its time closes, its process with it; the next call starts one anew", async () => {
  const pool = Lsp.pool(LANGS, { idle: 200 });
  const pid = Number((await Lsp.run(pool, { operation: "hover", file: A, line: 1, character: 1 }, go())).text.match(/pid=(\d+)/)![1]);
  await Bun.sleep(2600);
  expect(alive(pid)).toBe(false);
  const again = Number((await Lsp.run(pool, { operation: "hover", file: A, line: 1, character: 1 }, go())).text.match(/pid=(\d+)/)![1]);
  expect(again).not.toBe(pid);
  Mcp.end();
});

test("Tools: lsp is offered to the chat and its subagents when mcp.json names a server, not to computer use", () => {
  const file = DIR + "/mcp.json";
  fs.writeFileSync(file, JSON.stringify({ servers: [], lsp: { typescript: LANGS.typescript } }));
  const code = `
    import { Tools } from "./Tools.ts";
    import { Mcp } from "./Mcp.ts";
    const tools = { agents: new Map([["Sub", { role: { $: "sub", effort: null } }], ["Hands", { role: { $: "hands", device: "d" } }]]) } as any;
    const go = new AbortController().signal;
    const has = async (who) => (await Tools.answer(tools, who, "tools/list", {}, go, "")).tools.some((t) => t.name === "lsp");
    const call = async (who) => (await Tools.answer(tools, who, "tools/call", { name: "lsp", arguments: { operation: "documentSymbol", file: ${JSON.stringify(A)} } }, go, "")).content[0].text;
    console.log(JSON.stringify({ main: await has("main"), sub: await has("Sub"), hands: await has("Hands"), call: await call("main"), refused: await call("Hands") }));
    Mcp.end();
    process.exit(0);
  `;
  const { UNII_MCP, ...rest } = process.env;
  const run = (mcp: string) => JSON.parse(Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...rest, UNII_DIR: DIR, UNII_MCP: mcp } }).stdout.toString());
  expect(run(file)).toEqual({ main: true, sub: true, hands: false, call: "Outer (class) line 1\n  inner (method) line 2", refused: "No tool lsp." });
  expect(run(DIR + "/none.json")).toEqual({ main: false, sub: false, hands: false, call: "No tool lsp.", refused: "No tool lsp." });
});

test("a server is not closed while a request to it is still waiting, however short its idle time", async () => {
  const pool = Lsp.pool(LANGS, { idle: 50 });
  expect(await Lsp.run(pool, { operation: "workspaceSymbol", file: A, query: "slow" }, go())).toEqual({ text: "No symbols.", fail: false });
  Mcp.end();
});
