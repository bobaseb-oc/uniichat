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

// A person's !command: a shell job on the device it came from (else the
// only one open), its command and output a note the AI reads, no turn
const BANG = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
let asks = 0;
AskAI.ask = () => { asks += 1; throw new Error("no turn expected"); };
const none = await Chat.act(chat, "b0", { $: "bang", command: "ls" }, "");
const jobs = { mac: [], pc: [] };
const link = (k) => ({ send: (x) => { if (x.$ === "job") jobs[k].push(x); }, live: () => true, computer: false, work: "~/w" });
Tools.attach(chat.tools, "t1", "mac", "u1", link("mac"));
const two = await Chat.act(chat, "b1", { $: "bang", command: "ls" }, "");
Tools.attach(chat.tools, "t2", "pc", "u1", link("pc"));
const empty = await Chat.act(chat, "b2", { $: "bang", command: "  " }, "pc");
const ran = await Chat.act(chat, "b3", { $: "bang", command: "echo hi" }, "pc");
const job = jobs.pc.at(-1);
Tools.done(chat.tools, "pc", job.id, { text: "hi\\n(exit 0 in 0.0 s)", fail: false });
for (let k = 0; k < 100 && !chat.mem.count; k++) await Bun.sleep(10);
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
const last = Memory.message(chat.mem, chat.mem.count - 1);
console.log(JSON.stringify({ none, two: "error" in two, empty: "error" in empty, ran, job: job && { name: job.job.name, input: job.job.input, cwd: job.job.cwd }, mac: jobs.mac.length, kind: last?.kind, text: last?.text, asks }));
process.exit(0);
`;

// A device's status (Device.device_status): its folder, branch and today's
// spend, kept as the latest and told every view in the state; only from a
// device, its fields checked
const STATUS = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const none = Chat.state(chat).status;
const web = await Chat.act(chat, "s0", { $: "status", dir: "x", branch: null, spend: null, stale: false }, "");
const ok = await Chat.act(chat, "s1", { $: "status", dir: "uniichat", branch: "main", spend: 0.25, stale: false, junk: 1 }, "mac");
const kept = Chat.state(chat).status;
const bad = await Chat.act(chat, "s2", { $: "status", dir: 5, branch: "main", spend: "lots", stale: false }, "mac");
console.log(JSON.stringify({ none, web: "error" in web, ok, kept, bad: "error" in bad, after: Chat.state(chat).status }));
process.exit(0);
`;

test("a device's status is kept and told in the state; only a device's, its fields checked", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/status.ts", STATUS);
  const proc = Bun.spawn([process.execPath, dir + "/status.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  const mac = { device: "mac", dir: "uniichat", branch: "main", spend: 0.25, stale: false };
  expect(out).toEqual({ none: null, web: true, ok: {}, kept: mac, bad: true, after: mac });
});

// A device's inbox (Device.device_inbox): only a device's, checked
// (Inbox.inbox_check), kept and told every view; a view's "fetch" asks
// every socket (the devices) to read it anew
const INBOX = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const sent = [];
chat.socks.add({ send: (s) => sent.push(JSON.parse(s)), data: { watch: new Set() } });
const inbox = { at: 1, login: "me", reviews: [], mine: [], merged: 2, today: 0, tickets: null, clean: [], notes: [], errors: [] };
const web = await Chat.act(chat, "i0", { $: "inbox", inbox }, "");
const ok = await Chat.act(chat, "i1", { $: "inbox", inbox: { ...inbox, extra: 1 } }, "mac");
const bad = await Chat.act(chat, "i2", { $: "inbox", inbox: { ...inbox, merged: "many" } }, "mac");
const fetch = await Chat.act(chat, "i3", { $: "fetch" }, "");
console.log(JSON.stringify({ web: "error" in web, ok, bad: "error" in bad, fetch, kept: chat.inbox, sent: sent.filter((m) => m.$ === "inbox" || m.$ === "fetch") }));
process.exit(0);
`;

test("a device's inbox is checked, kept and told every view; a view's fetch asks the devices", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/inbox.ts", INBOX);
  const proc = Bun.spawn([process.execPath, dir + "/inbox.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  const kept = { at: 1, login: "me", reviews: [], mine: [], merged: 2, today: 0, tickets: null, clean: [], notes: [], errors: [] };
  expect(out).toEqual({ web: true, ok: {}, bad: true, fetch: {}, kept, sent: [{ $: "inbox", inbox: kept }, { $: "fetch" }] });
});

// A call waiting for the user (auto's reviewer couldn't check it): in the
// state; the user's yes or no answers it; an unknown one is refused
const CONSENT = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const asked = Tools.ask_user(chat.tools, "Wkr", "shell", { device: "mac", command: "make deploy" }, new AbortController().signal);
const listed = Chat.state(chat).calls;
const unknown = await Chat.act(chat, "c0", { $: "consent", n: 9, yes: true }, "");
const yes = await Chat.act(chat, "c1", { $: "consent", n: listed[0].id, yes: true }, "");
console.log(JSON.stringify({ listed, unknown, yes, answered: await asked, after: Chat.state(chat).calls }));
process.exit(0);
`;

test("a call waiting for the user is in the state; their yes answers it", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/consent.ts", CONSENT);
  const proc = Bun.spawn([process.execPath, dir + "/consent.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({
    listed: [{ id: 1, who: "Wkr", tool: "shell", what: "make deploy (on mac)" }], unknown: { error: "No call 9 waits for you." }, yes: {}, answered: true, after: [],
  });
});

// The modes: the user switches the mode (a note, no turn); a plan filed
// in plan mode is in the state; approved, the mode becomes the one picked
// and the orchestrator is told (a turn); rejected, it stays plan mode and
// the orchestrator gets the feedback (a turn); no plan: refused
const MODE = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const asks = [];
AskAI.ask = (ask, on) => {
  const [call, sink] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push(sink);
  call.send = () => {};
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10);
  return f();
};
const msgs = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i));
// the switch on a chat of its own (its note would hold this one's turns
// for summaries this test never builds)
const other = Chat.open({ id: "u2", name: "c@d.e" });
Chat.chats.set("u2", other);
const first = Chat.state(other).mode;
const bad = await Chat.act(other, "m0", { $: "mode", mode: "nope" }, "");
const none = await Chat.act(other, "p0", { $: "plan", yes: true }, "");
await Chat.act(other, "m1", { $: "mode", mode: "plan" }, "");
const last = Memory.message(other.mem, other.mem.count - 1);
const switched = [Chat.state(other).mode, asks.length, last.kind, last.text];
chat.mem.mode = "plan";
await Tools.call(chat.tools, "main", "plan", { plan: "1. fix it" }, new AbortController().signal, "t");
const shown = Chat.state(chat).plan?.text;
await Chat.act(chat, "p1", { $: "plan", yes: false, text: "test first" }, "");
await until(() => asks.length === 1);
const rejected = [Chat.state(chat).mode, Chat.state(chat).plan, msgs().filter((m) => m.kind === "user").at(-1).text];
asks[0].end({ ok: true, text: "ok", left: [] });
await until(() => !chat.busy);
await Tools.call(chat.tools, "main", "plan", { plan: "1. test\\n2. fix" }, new AbortController().signal, "t2");
await Chat.act(chat, "p2", { $: "plan", yes: true, mode: "full" }, "");
await until(() => asks.length === 2);
const approved = [Chat.state(chat).mode, Chat.state(chat).plan, msgs().filter((m) => m.kind === "user").at(-1).text];
console.log(JSON.stringify({ first, bad: "error" in bad, none, switched, shown, rejected, approved }));
process.exit(0);
`;

test("the user switches the mode, and approves or rejects the orchestrator's plan", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/mode.ts", MODE);
  const proc = Bun.spawn([process.execPath, dir + "/mode.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({
    first: "auto", bad: true, none: { error: "No plan is waiting for approval." },
    switched: ["plan", 0, "note", "The user switched to plan mode: agents only read, until you approve a plan."],
    shown: "1. fix it",
    rejected: ["plan", null, "The user didn't approve your plan: test first\nStill in plan mode: revise it and file it again with plan."],
    approved: ["full", null, "The user approved your plan; now in full mode: every call runs (hooks only). Go ahead with it."],
  });
});

// The question backlog: the orchestrator's open questions in the state;
// an answer is the user's message quoting the question, and a turn; no
// text dismisses it (a note, no turn); an unknown one is refused
const ANSWER = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const asks = [];
AskAI.ask = (ask, on) => {
  const [call] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push(ask);
  call.send = () => {};
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10);
  return f();
};
const go = new AbortController().signal;
await Tools.call(chat.tools, "main", "ask", { question: "Ship on Friday?" }, go, "q1");
await Tools.call(chat.tools, "main", "ask", { question: "Rename the repo?" }, go, "q2");
const listed = Chat.state(chat).questions.map((q) => q.id);
const unknown = await Chat.act(chat, "a0", { $: "answer", q: 9, text: "x" }, "");
const answered = await Chat.act(chat, "a1", { $: "answer", q: 1, text: " Yes, ship it " }, "");
await until(() => asks.length === 1);
const msgs = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i));
const said = msgs().filter((m) => m.kind === "user" && m.text.includes("question")).map((m) => m.text);
const dismissed = await Chat.act(chat, "a2", { $: "answer", q: 2 }, "");
await Bun.sleep(100);
const notes = msgs().filter((m) => m.kind === "note").map((m) => m.text);
console.log(JSON.stringify({ listed, unknown, answered, said, dismissed, notes, asks: asks.length, left: Chat.state(chat).questions }));
process.exit(0);
`;

test("an answer from the question backlog is a message quoting it, and a turn; no text dismisses it", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/answer.ts", ANSWER);
  const proc = Bun.spawn([process.execPath, dir + "/answer.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({
    listed: [1, 2], unknown: { error: "No open question 9." }, answered: {},
    said: ["Answer to your question 1 (Ship on Friday?):\nYes, ship it"], dismissed: {},
    notes: ["The user dismissed your question 2 (Rename the repo?)."], asks: 1, left: [],
  });
});

test("!command runs as a shell job on the device it came from; its output is a note, no turn", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/bang.ts", BANG);
  const proc = Bun.spawn([process.execPath, dir + "/bang.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({
    none: { error: "No device is open: run legion (or legion device) on one." }, two: false, empty: true, ran: {},
    job: { name: "shell", input: { command: "echo hi" }, cwd: "main" }, mac: 1, kind: "note",
    text: "The user ran on pc:\n$ echo hi\nhi\n(exit 0 in 0.0 s)", asks: 0,
  });
});

test("an agent's events go only to views on its page; a view's tell and dismiss reach it", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/watch.ts", WATCH);
  const proc = Bun.spawn([process.execPath, dir + "/watch.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({ a: [true, true], b: [false, true], told: {}, sent: ["one more thing"], crewed: true, dismissed: {}, after: false });
});

// Every view hears an agent's pulse (Tools.pulse) as it streams, at most
// one an agent a PULSE (a burst of deltas: one); only views watching it
// hear the deltas. A view's watch replaces what it watches: agents known,
// at most WATCH of them
const PULSE = `
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
  asks.push({ ask, sink });
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 300 && !f(); k++) await Bun.sleep(10);
  return f();
};
const name = Tools.start(chat.tools, "main", { $: "sub", tier: "worker", effort: null, model: null }, "a task");
await until(() => asks.length === 1);
Chat.ask(chat, a, { $: "watch", names: [name, "Nobody", ...Array.from({ length: 40 }, (_, k) => name)] });
const watched = [...a.data.watch];
got.a.length = 0;
got.b.length = 0;
const agent = chat.tools.agents.get(name);
for (let k = 0; k < 20; k++) Chat.on(chat, agent, { $: "Delta", kind: "work", text: k === 19 ? "\\nlast words" : "x" });
const pulses = (k) => got[k].filter((m) => m.$ === "pulse");
await until(() => pulses("b").length > 0);
await Bun.sleep(1200);
const deltas = (k) => got[k].filter((m) => m.$ === "delta").length;
const seen = { watched, pa: pulses("a").length, pb: pulses("b").length, pulse: pulses("b")[0], da: deltas("a"), db: deltas("b") };
Chat.ask(chat, a, { $: "watch", names: [] });
got.a.length = 0;
Chat.on(chat, agent, { $: "Delta", kind: "work", text: "more" });
console.log(JSON.stringify({ ...seen, after: deltas("a") }));
process.exit(0);
`;

test("every view hears an agent's pulse, a burst as one; a view's watch replaces what it watches", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/pulse.ts", PULSE);
  const proc = Bun.spawn([process.execPath, dir + "/pulse.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.watched).toHaveLength(1);
  expect(out.pa).toBe(1);
  expect(out.pb).toBe(1);
  expect(out.pulse).toMatchObject({ $: "pulse", status: "working", act: "last words", last: "" });
  expect(out.da).toBe(20);
  expect(out.db).toBe(0);
  expect(out.after).toBe(0);
});
