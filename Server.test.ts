// Server test
// ===========
// `bun test Server.test.ts`. `./Server.ts <port>` alone serves the site
// (its prices only if it bills); with workers set, it is their
// supervisor, which only routes (a proxy in front sends each request to
// the worker it names).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

// `./Server.ts <port>` on a fresh dir, with `env`: its answer to `path`,
// read whole, once it answers
async function server_get(port: number, env: Record<string, string>, path: string): Promise<Response> {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  const site = "http://127.0.0.1:" + port;
  const proc = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", String(port)], {
    env    : { ...process.env, UNII_DIR: dir, UNII_SITE: site, ...env },
    stdout : "ignore",
    stderr : "inherit",
  });
  try {
    for (let k = 0; k < 100; k++) {
      const res = await fetch(site + path).catch(() => null);
      if (res !== null) {
        return new Response(await res.text(), res);
      }
      await Bun.sleep(50);
    }
    throw new Error("no answer on " + site);
  } finally {
    proc.kill();
    await proc.exited;
  }
}

test("Server.ts alone serves the page", async () => {
  const res = await server_get(9461, {}, "/");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<title>");
});

test("with workers, Server.ts routes to them", async () => {
  const res = await server_get(9471, { UNII_WORKERS: "2" }, "/");
  expect(res.headers.get("x-unii-worker")).toMatch(/^127\.0\.0\.1:947[23]$/);
  expect(await res.text()).toBe("");
});

// a server says whether it bills (Billing.ts): this one doesn't, so it
// serves no prices or terms
test("a free server bills nothing: it says so, and shows no prices or terms", async () => {
  expect(await (await server_get(9481, {}, "/api/hello")).json()).toMatchObject({ bills: false, github: false });
  expect((await server_get(9482, {}, "/pricing")).status).toBe(404);
  expect((await server_get(9483, {}, "/terms.html")).status).toBe(404);
});

// a /model while the turn's call runs picks the next call's: the wait
// names the model the running one asked. Its own process, as config is
// read once a process (another test file's dir is not this one's)
const TURN = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
AskAI.ask = (ask, on) => AskAI.tie(on, ask.bill, () => {}, () => {})[0];
Chat.take(chat, Chat.push(chat, null, "user", "hi"));
await Bun.sleep(10);
const model = chat.pick.model;
const waited = Chat.waits(chat);
const to = { ...chat.pick, model: model === "opus-5.5" ? "haiku-5.5" : "opus-5.5" };
const acted = await Chat.act(chat, "pick", { $: "pick", to }, "");
console.log(JSON.stringify({ model, waited, acted, picked: chat.pick.model, to: to.model, after: Chat.waits(chat) }));
process.exit(0);
`;

test("a turn's wait names the model it runs on, not one picked since", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/turn.ts", TURN);
  const proc = Bun.spawn([process.execPath, dir + "/turn.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.model).toMatch(/\w/);
  expect(out.to).not.toBe(out.model);
  expect(out.waited).toBe(out.model);
  expect(out.acted).toEqual({});
  expect(out.picked).toBe(out.to);
  expect(out.after).toBe(out.model);
});

// an agent the person starts (/agent) reports into the chat and starts no
// turn; one the AI started takes a turn with its report. Its own process,
// as TURN's: every call is stubbed (summaries' too), an agent's ended by
// the test, found by its tools' address
const SPAWN = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
chat.socks.add({ send: () => {}, data: { seen: new Set(), watch: new Set() } }); // a view open: an idle chat with none ends
const works = [];
const push = Chat.push;
Chat.push = (c, agent, kind, ...rest) => (agent === null && kind === "work" && works.push(rest[0]), push(c, agent, kind, ...rest));
const calls = [];
AskAI.ask = (ask, on) => {
  const [call, sink] = AskAI.tie(on, ask.bill, () => {}, () => {});
  calls.push({ server: String(ask.server ?? ""), sink });
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10);
  return f();
};
const end = async (name, text) => {
  await until(() => calls.some((c) => c.server.includes(name)));
  calls.find((c) => c.server.includes(name)).sink.end({ ok: true, text, left: [] });
};
const acted = await Chat.act(chat, "s1", { $: "spawn", task: "count to 3" }, "");
const started = Chat.state(chat).agents;
await end(started[0], "1 2 3");
const reported = await until(() => works.length === 1);
await Bun.sleep(100);
const mine = { reported, busy: chat.busy, working: Chat.state(chat).agents.length };
const ai = Tools.start(chat.tools, "main", { $: "sub", tier: "worker", effort: null, model: null }, "count to 2");
await end(ai, "1 2");
const ais = { reported: await until(() => works.length === 2), busy: await until(() => chat.busy) };
console.log(JSON.stringify({ acted, started, mine, ais }));
process.exit(0);
`;

test("a person's agent reports without a turn; the AI's takes one", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/spawn.ts", SPAWN);
  const proc = Bun.spawn([process.execPath, dir + "/spawn.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.acted).toEqual({});
  expect(out.started).toHaveLength(1);
  expect(out.mine).toEqual({ reported: true, busy: false, working: 0 });
  expect(out.ais).toEqual({ reported: true, busy: true });
});

// a turn's call past ROLL tokens ends rolled (Agent.ts): the turn asks
// again from the chat's tree, the user's message word for word and what
// the turn did since raw, never ending on it. Its own process, as TURN's
const ROLL = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
chat.socks.add({ send: () => {}, data: { seen: new Set(), watch: new Set() } });
const asks = [];
AskAI.ask = (ask, on) => {
  const [call, sink] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push({ ask, sink });
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10);
  return f();
};
const main = () => asks.filter((a) => String(a.ask.server ?? "").endsWith("/main"));
Chat.take(chat, Chat.push(chat, null, "user", "the user's own words"));
await until(() => main().length === 1);
Chat.push(chat, null, "tool", "shell(ls)");
Chat.push(chat, null, "echo", "a.txt b.txt");
main()[0].sink.end({ ok: true, text: "", left: [], roll: true });
const again = await until(() => main().length === 2);
const blocks = again ? main()[1].ask.blocks.map((b) => b.text).join("") : "";
const busy = chat.busy;
if (again) main()[1].sink.end({ ok: true, text: "done", left: [] });
await until(() => !chat.busy);
console.log(JSON.stringify({ again, busy, words: blocks.includes("the user's own words"), echo: /\\|echo: a\\.txt b\\.txt/.test(blocks), rolled: blocks.includes("rolled over") }));
process.exit(0);
`;

test("a turn past ROLL tokens rolls over: asked again from the tree, the user's words and its steps kept", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/roll.ts", ROLL);
  const proc = Bun.spawn([process.execPath, dir + "/roll.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({ again: true, busy: true, words: true, echo: true, rolled: true });
});

// an agent's events go only to the views that asked for its page (the
// `agent` read); the chat's go to all. A tell and a dismiss from a view
// reach the agent. Its own process, as TURN's
const WATCH = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const got = { a: [], b: [] };
const sock = (k) => ({ send: (m) => got[k].push(JSON.parse(m)), data: { seen: new Set(), watch: new Set() } });
const [a, b] = [sock("a"), sock("b")];
chat.socks.add(a);
chat.socks.add(b);
const asks = [];
AskAI.ask = (ask, on) => {
  const [call, sink] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push({ ask, sink, sent: [] });
  call.send = (say) => asks.at(-1).sent.push(say.text);
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10);
  return f();
};
const name = Tools.start(chat.tools, "main", { $: "sub", tier: "worker", effort: null, model: null }, "a task");
await until(() => asks.length === 1);
Chat.ask(chat, a, { $: "agent", name });
got.a.length = 0;
got.b.length = 0;
Chat.push(chat, chat.tools.agents.get(name), "unii", "agent words");
Chat.push(chat, null, "note", "chat words");
const seen = (k, text) => got[k].some((m) => m.$ === "entry" && m.text === text);
const told = await Chat.act(chat, "t1", { $: "tell", name, text: "one more thing" }, "");
const crewed = Chat.state(chat).crew.map((c) => c.name);
asks[0].sink.end({ ok: true, text: "done", left: [] });
await until(() => !chat.tools.agents.get(name).runs);
const dismissed = await Chat.act(chat, "d1", { $: "dismiss", name }, "");
console.log(JSON.stringify({
  a: [seen("a", "agent words"), seen("a", "chat words")],
  b: [seen("b", "agent words"), seen("b", "chat words")],
  told, sent: asks[0].sent, crewed: crewed.includes(name), dismissed, after: Chat.state(chat).crew.map((c) => c.name).includes(name),
}));
process.exit(0);
`;

test("an agent's events go only to views on its page; a view's tell and dismiss reach it", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/watch.ts", WATCH);
  const proc = Bun.spawn([process.execPath, dir + "/watch.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({ a: [true, true], b: [false, true], told: {}, sent: ["one more thing"], crewed: true, dismissed: {}, after: false });
});
