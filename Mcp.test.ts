// Mcp test
// ========
// `bun test Mcp.test.ts`. The MCP client: a fake server over stdio (a
// bun script) and one over HTTP (JSON or SSE answers); tools listed by
// page, renamed mcp__<server>__<tool>, their schemas cleaned; results as
// text and images; a server that fails skipped, said once in a line with
// no secret; children in their own process groups, killed as unii ends,
// and those a crashed unii left killed at the next start.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Mcp, type Server } from "./Mcp.ts";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-mcp-");
const PIDS = DIR + "/children.pids";
const SECRET = "sk-test-0123456789";

Mcp.sweep(PIDS);

// the stdio stand-in: two pages of tools; calls answer at once, never
// (slow), or after a line that is no JSON (noise)
const FAKE = DIR + "/fake.ts";
fs.writeFileSync(FAKE, `
const LONG = "a_very_long_tool_name_that_goes_on_and_on_past_the_limit_";
let tools = [
  { name: "echo", description: "Echo it", inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", properties: { s: { type: "string" } } } },
  { name: "pic", description: "x".repeat(2000), inputSchema: { type: "object" } },
  { name: "bad", inputSchema: { type: "object" } },
  { name: "slow", inputSchema: { type: "object" } },
  { name: "noise", inputSchema: { type: "object" } },
  { name: "pid", inputSchema: { type: "object" } },
  { name: "grow", inputSchema: { type: "object" } },
  { name: "dot.ted", inputSchema: { type: "object" } },
  { name: LONG + "one", inputSchema: { type: "object" } },
  { name: LONG + "two", inputSchema: { type: "object" } },
];
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\\n");
const text = (t) => ({ content: [{ type: "text", text: t }] });
for await (const line of console) {
  const m = JSON.parse(line);
  if (m.id === undefined) continue;
  const a = m.params?.arguments ?? {};
  switch (m.method === "tools/call" ? m.params.name : m.method) {
    case "initialize": send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: "fake", version: "1" } } }); break;
    case "tools/list": send({ id: m.id, result: m.params?.cursor === "p2" ? { tools: tools.slice(5) } : { tools: tools.slice(0, 5), nextCursor: "p2" } }); break;
    case "echo": send({ id: m.id, result: text(a.s + " env=" + process.env.FAKE_ENV) }); break;
    case "pic": send({ id: m.id, result: { content: [{ type: "text", text: "a pic" }, { type: "image", data: "iVBOR", mimeType: "image/png" }, { type: "audio", data: "x" }] } }); break;
    case "bad": send({ id: m.id, result: { ...text("it broke"), isError: true } }); break;
    case "slow": break;
    case "noise": process.stdout.write("not json\\n"); send({ id: m.id, result: text("quiet") }); break;
    case "pid": {
      const kid = Bun.spawn(["sleep", "60"]);
      send({ id: m.id, result: text(process.pid + " " + kid.pid) });
      break;
    }
    case "grow": tools = [...tools, { name: "new", inputSchema: { type: "object" } }]; send({ method: "notifications/tools/list_changed" }); send({ id: m.id, result: text("grown") }); break;
    case "long": break;
  }
}
`);

const fake = (more: Partial<Server> = {}): Server => ({ name: "fake", command: process.execPath, args: [FAKE], env: { FAKE_ENV: "${FAKE_VAR}" }, ...more });

// the HTTP stand-in: answers as JSON or SSE; what each request carried
function http(sse: boolean, broken = false) {
  const seen: Array<{ method: string; session: string | null; version: string | null; auth: string | null }> = [];
  const srv = Bun.serve({
    hostname : "127.0.0.1",
    port     : 0,
    async fetch(req) {
      if (req.method !== "POST") {
        return new Response(null, { status: 405 });
      }
      const m = await req.json() as any;
      seen.push({ method: m.method, session: req.headers.get("mcp-session-id"), version: req.headers.get("mcp-protocol-version"), auth: req.headers.get("authorization") });
      if (m.id === undefined) {
        return new Response(null, { status: 202 });
      }
      if (broken && m.method === "tools/call") {
        const junk = SECRET + " <html>oops</html>";
        return new Response(sse ? "data: " + junk + "\n\n" : junk, { headers: { "content-type": sse ? "text/event-stream" : "application/json" } });
      }
      const result = m.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "h", version: "1" } }
        : m.method === "tools/list" ? { tools: [{ name: "hi", description: "Say hi", inputSchema: { type: "object" } }] }
        : { content: [{ type: "text", text: "hi " + m.params.arguments.who }] };
      const body = JSON.stringify({ jsonrpc: "2.0", id: m.id, result });
      const headers: Record<string, string> = m.method === "initialize" ? { "mcp-session-id": "s-1" } : {};
      if (sse) {
        const note = JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: {} });
        return new Response("event: message\ndata: " + note + "\n\nevent: message\ndata: " + body + "\n\n", { headers: { ...headers, "content-type": "text/event-stream" } });
      }
      return new Response(body, { headers: { ...headers, "content-type": "application/json" } });
    },
  });
  const server: Server = { name: "web", url: "http://127.0.0.1:" + srv.port + "/mcp", headers: { Authorization: "Bearer ${TOKEN}" } };
  return { seen, server, stop: () => srv.stop(true) };
}

const env = { FAKE_VAR: "from-env", TOKEN: SECRET };
const go = () => new AbortController().signal;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

test("a stdio server's tools come by page, renamed, described and cleaned; a call reaches it with its env resolved", async () => {
  const pool = Mcp.pool([fake()], { env });
  const specs = await Mcp.list(pool, go());
  const names = specs.map((s) => s.name);
  expect(names).toContain("mcp__fake__echo");
  expect(names).toContain("mcp__fake__pid"); // from the second page
  expect(names).toContain("mcp__fake__dot_ted");
  expect(names.every((n) => /^[a-zA-Z0-9_-]{1,64}$/.test(n))).toBe(true);
  expect(new Set(names).size).toBe(names.length);
  const echo = specs.find((s) => s.name === "mcp__fake__echo")!;
  expect(echo.info).toBe("[fake] Echo it");
  expect(echo.schema).toEqual({ type: "object", properties: { s: { type: "string" } } });
  expect(specs.find((s) => s.name === "mcp__fake__pic")!.info.length).toBeLessThanOrEqual(1000);
  expect(await Mcp.call(pool, "mcp__fake__echo", { s: "hello" }, go())).toEqual({ text: "hello env=from-env", fail: false, imgs: [] });
  Mcp.end();
});

test("long names are cut with a hash, unique; a tools list limits what is offered", async () => {
  const all = await Mcp.list(Mcp.pool([fake()], { env }), go());
  const long = all.map((s) => s.name).filter((n) => n.includes("very_long"));
  expect(long.length).toBe(2);
  expect(long.every((n) => n.length === 64)).toBe(true);
  expect(long[0]).not.toBe(long[1]);
  const some = await Mcp.list(Mcp.pool([fake({ tools: ["echo", "bad"] })], { env }), go());
  expect(some.map((s) => s.name).sort()).toEqual(["mcp__fake__bad", "mcp__fake__echo"]);
  Mcp.end();
});

test("results: images apart, other parts named, isError a failure, a JSON-less line ignored", async () => {
  const pool = Mcp.pool([fake()], { env });
  await Mcp.list(pool, go());
  expect(await Mcp.call(pool, "mcp__fake__pic", {}, go())).toEqual({ text: "a pic\n[audio]", fail: false, imgs: [{ type: "image/png", data: "iVBOR" }] });
  expect(await Mcp.call(pool, "mcp__fake__bad", {}, go())).toEqual({ text: "it broke", fail: true, imgs: [] });
  expect((await Mcp.call(pool, "mcp__fake__noise", {}, go())).text).toBe("quiet");
  expect(await Mcp.call(pool, "mcp__nope__x", {}, go())).toEqual({ text: "No tool mcp__nope__x.", fail: true });
  Mcp.end();
});

test("a call with no answer times out, a stopped one says so, both in a line", async () => {
  const pool = Mcp.pool([fake()], { env, call: 200 });
  await Mcp.list(pool, go());
  expect(await Mcp.call(pool, "mcp__fake__slow", {}, go())).toEqual({ text: "fake: no answer in 0.2 s.", fail: true });
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 50);
  expect(await Mcp.call(pool, "mcp__fake__slow", {}, stop.signal)).toEqual({ text: "fake: (stopped)", fail: true });
  expect((await Mcp.call(pool, "mcp__fake__echo", { s: "still" }, go())).text).toBe("still env=from-env");
  Mcp.end();
});

test("list_changed lists the tools anew", async () => {
  const pool = Mcp.pool([fake()], { env });
  expect((await Mcp.list(pool, go())).some((s) => s.name === "mcp__fake__new")).toBe(false);
  await Mcp.call(pool, "mcp__fake__grow", {}, go());
  expect((await Mcp.list(pool, go())).some((s) => s.name === "mcp__fake__new")).toBe(true);
  Mcp.end();
});

test("an HTTP server answering JSON or SSE: session and version headers kept, header placeholders resolved", async () => {
  for (const sse of [false, true]) {
    const h = http(sse);
    const pool = Mcp.pool([h.server], { env });
    expect((await Mcp.list(pool, go())).map((s) => s.name)).toEqual(["mcp__web__hi"]);
    expect(await Mcp.call(pool, "mcp__web__hi", { who: "you" }, go())).toEqual({ text: "hi you", fail: false, imgs: [] });
    h.stop();
    expect(h.seen.map((s) => s.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(h.seen[0].session).toBe(null);
    expect(h.seen.slice(1).every((s) => s.session === "s-1" && s.version === "2025-06-18")).toBe(true);
    expect(h.seen.every((s) => s.auth === "Bearer " + SECRET)).toBe(true);
  }
});

test("a server that fails is skipped and said once, the others go on; no secret in any line", async () => {
  const log: string[] = [];
  const h = http(false, true);
  const gone: Server = { name: "gone", command: DIR + "/no-such-binary" };
  const needs: Server = { name: "needs", url: "http://127.0.0.1:1/mcp", headers: { "X-Key": "${MISSING_KEY}" } };
  const pool = Mcp.pool([gone, needs, h.server, fake()], { env, log: (l) => log.push(l) });
  const names = (await Mcp.list(pool, go())).map((s) => s.name);
  await Mcp.list(pool, go());
  expect(names).toContain("mcp__web__hi");
  expect(names).toContain("mcp__fake__echo");
  expect(names.some((n) => n.startsWith("mcp__gone") || n.startsWith("mcp__needs"))).toBe(false);
  expect(log.length).toBe(2);
  expect(log.find((l) => l.startsWith("mcp: needs"))).toContain("MISSING_KEY");
  const bad = await Mcp.call(pool, "mcp__web__hi", { who: "x" }, go());
  h.stop();
  expect(bad.fail).toBe(true);
  for (const line of [...log, bad.text]) {
    expect(line).not.toContain("\n");
    expect(line).not.toContain(SECRET);
  }
  Mcp.end();
});

test("an answer that is no JSON, as JSON or SSE, is said as such, none of its body passed on", async () => {
  for (const sse of [false, true]) {
    const h = http(sse, true);
    const pool = Mcp.pool([h.server], { env });
    await Mcp.list(pool, go());
    expect(await Mcp.call(pool, "mcp__web__hi", { who: "x" }, go())).toEqual({ text: "web: bad JSON answer.", fail: true });
    h.stop();
  }
});

test("children have their own process groups: end() kills them and theirs; idle ones close and start again", async () => {
  const pool = Mcp.pool([fake()], { env, idle: 300 });
  await Mcp.list(pool, go());
  const [srv, kid] = (await Mcp.call(pool, "mcp__fake__pid", {}, go())).text.split(" ").map(Number);
  expect(fs.readFileSync(PIDS, "utf8")).toContain(srv + "\t");
  await wait(600);
  expect(alive(srv)).toBe(false);
  expect(alive(kid)).toBe(false);
  const [again] = (await Mcp.call(pool, "mcp__fake__pid", {}, go())).text.split(" ").map(Number);
  expect(again).not.toBe(srv);
  Mcp.end();
  await wait(100);
  expect(alive(again)).toBe(false);
});

test("the next start kills children a crashed unii left, only if each is still the process it was", async () => {
  const left = Bun.spawn(["sleep", "60"], { detached: true });
  const other = Bun.spawn(["sleep", "60"], { detached: true });
  const start = (pid: number) => Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)]).stdout.toString().trim();
  const file = DIR + "/crashed.pids";
  fs.writeFileSync(file, left.pid + "\t" + start(left.pid) + "\n" + other.pid + "\tMon Jan  1 00:00:00 2001\n");
  Mcp.sweep(file);
  await left.exited;
  await wait(200);
  expect(left.signalCode).toBe("SIGKILL");
  expect(other.signalCode).toBe(null); // a killed child stays a zombie (alive) until reaped
  expect(fs.readFileSync(file, "utf8")).toBe("");
  other.kill();
});
