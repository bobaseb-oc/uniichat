// Agents' memory test
// ===================
// `bun test agents.test.ts`. An agent's log is a tree of its own
// (Memory.ts, docs/agent/<Name>/), compressed as the chat's is: its ask
// carries its summaries' lines and only its latest messages raw. An old
// agent's log (docs/agent/<Name>.jsonl) is still read, and moves onto a
// tree only when the agent logs again. A chat moving to another process
// takes its agents' running summaries along, as its own. The vendor is
// a fake Anthropic answering each summary with a line.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-agents-");

process.env.UNII_DIR = DIR;

const config = await import("./Config.ts");
config.KEYS.anthropic = "test";

const { Memory } = await import("./Memory.ts");
const { MASTER } = await import("./Tools.ts");

const SHARE = { vendor: "claude-api" as const, model: "claude-opus-5-5", effort: "medium", speed: "slow", system: MASTER, searches: 1, server: "" };

const real = { setTimeout, fetch };

// summaries asked, and those held unanswered till `release`
let asked = 0;
let hold = false;
const held: Array<() => void> = [];

function answer(text: string): Response {
  const events = [
    { type: "message_start", message: { usage: {} } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((ev) => "data: " + JSON.stringify(ev) + "\n\n").join(""));
}

// the requests that weren't summaries (an agent's calls): their bodies
const calls: any[] = [];

// rolling: an agent's first call asks the date tool, its request told
// as 200K tokens in (past config.ROLL)
let rolling = false;

// script: answers an agent's call by its body, instead of the above
let script: ((body: any) => Response) | null = null;

function tooled(name = "date", input: object = { id: 0 }, tokens = 200000): Response {
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 2000, cache_read_input_tokens: tokens - 2000 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t" + calls.length, name, input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((ev) => "data: " + JSON.stringify(ev) + "\n\n").join(""));
}

async function vendor(url: string, init: any): Promise<Response> {
  if (String(url).startsWith("http://127.0.0.1:")) {
    return real.fetch(url, init);
  }
  const body = JSON.parse(init.body);
  const content = body.messages[0].content;
  const task: string = content[content.length - 1].text;
  if (!task.startsWith("Compaction:")) {
    calls.push(body);
    if (script !== null) {
      return script(body);
    }
    return rolling && calls.length === 1 ? tooled() : answer("the report");
  }
  asked += 1;
  if (hold) {
    await new Promise<void>((ok) => held.push(ok));
  }
  return answer("line for " + task.split("\n")[0]);
}

// a request's text, its system prompt and messages
function said(body: any): string {
  const parts = (x: any): string => (typeof x === "string" ? x : Array.isArray(x) ? x.map(parts).join("") : x?.text ?? (x?.content ? parts(x.content) : ""));
  return parts(body.system) + parts(body.messages);
}

function sleep(ms: number): Promise<void> {
  return new Promise((ok) => real.setTimeout(ok, ms));
}

async function until(done: () => boolean): Promise<void> {
  for (let t = 0; t < 200 && !done(); t++) {
    await sleep(10);
  }
  expect(done()).toBe(true);
}

async function faked(go: () => Promise<void>): Promise<void> {
  globalThis.fetch = vendor as any;
  try {
    await go();
  } finally {
    globalThis.fetch = real.fetch;
  }
}

const LONG = (k: number) => k + " " + "word ".repeat(200);

test("an agent's log is a tree of its own: its ask has its summaries, only its latest messages raw", () => faked(async () => {
  const mem = Memory.load(DIR + "/chat", () => SHARE);
  const name = Memory.agent_new(mem);
  Memory.agent_push(mem, name, "user", "the task");
  for (let k = 0; k < 8; k++) {
    Memory.agent_push(mem, name, "unii", LONG(k));
  }
  Memory.agent_push(mem, name, "user", "go on");
  expect(fs.existsSync(DIR + "/chat/docs/agent/" + name + "/main.index")).toBe(true);
  expect(Memory.agent(mem, name)!.map((root) => root.text)).toEqual(["the task", ...Array.from({ length: 8 }, (_, k) => LONG(k)), "go on"]);

  const blocks = await Memory.agent_blocks(mem, name, new AbortController().signal);
  expect(typeof blocks).not.toBe("string");
  const seen = blocks as { view: Array<{ text: string }>; log: { text: string } };
  const text = [...seen.view, seen.log].map((b) => b.text).join("");
  expect(text).toContain("line for Compaction: compress message 1 ");
  expect(text).not.toContain(LONG(0));
  expect(text).toContain("go on");
  // the chat's own tree is untouched
  expect(mem.count).toBe(0);
  Memory.stop(mem);
}));

test("an old agent's log is read as it is, and moves onto a tree when it logs again", () => faked(async () => {
  const mem = Memory.load(DIR + "/old", () => SHARE);
  fs.mkdirSync(DIR + "/old/docs/agent", { recursive: true });
  const old = [Memory.root(0, { kind: "note", text: "a subagent" }), Memory.root(1, { kind: "user", text: "old task" })];
  fs.writeFileSync(DIR + "/old/docs/agent/OldOne.jsonl", old.map((r) => JSON.stringify(r) + "\n").join(""));
  const before = asked;

  expect(Memory.agent(mem, "OldOne")!.map((r) => r.text)).toEqual(["a subagent", "old task"]);
  expect(fs.existsSync(DIR + "/old/docs/agent/OldOne")).toBe(false);
  expect(asked).toBe(before);

  Memory.agent_push(mem, "OldOne", "user", "told again");
  expect(Memory.agent(mem, "OldOne")!.map((r) => r.text)).toEqual(["a subagent", "old task", "told again"]);
  expect(fs.existsSync(DIR + "/old/docs/agent/OldOne/main.index")).toBe(true);
  expect(fs.existsSync(DIR + "/old/docs/agent/OldOne.jsonl")).toBe(true);
  // a name is never a path
  expect(Memory.agent(mem, "../chat")).toBeNull();
  Memory.stop(mem);
}));

test("a chat moving takes its agents' running summaries along; none is asked again", () => faked(async () => {
  hold = true;
  const mem = Memory.load(DIR + "/moving", () => SHARE);
  const name = Memory.agent_new(mem);
  Memory.agent_push(mem, name, "unii", LONG(0));
  await until(() => held.length === 1);

  Memory.halt(mem);
  const given = Memory.give(mem, () => "call-1");
  expect(given).toEqual([[0, 0, "call-1", name]]);

  const there = Memory.load(DIR + "/moving", () => SHARE);
  const before = asked;
  const far = (_id: string) => ({ done: Promise.resolve({ ok: true, text: "the line from far", left: [] }), stop() {}, send() {}, move() {} }) as any;
  Memory.take(there, given, far);
  await until(() => Memory.node(Memory.agent_mem(there, name)!, { l: 0, i: 0 }) === "the line from far");
  expect(asked).toBe(before);

  hold = false;
  held.splice(0).forEach((ok) => ok());
  Memory.stop(mem);
  Memory.stop(there);
}));

test("an agent's summaries are paid by the chat's payer, even one set after the agent's tree opened", () => faked(async () => {
  const mem = Memory.load(DIR + "/paid", () => SHARE);
  const name = Memory.agent_new(mem);
  const paid: string[] = [];
  mem.pay = ((kind: string, what: string) => (paid.push(kind + " " + what), undefined)) as any;
  Memory.agent_push(mem, name, "unii", LONG(0));
  await until(() => paid.length > 0);
  expect(paid[0]).toBe("compactor 0+1");
  Memory.stop(mem);
}));

const { Tools } = await import("./Tools.ts");
const { Pick } = await import("./Pick.ts");

// a chat's tools, its agents' entries logged on their trees (as Chat.on
// does, in short), reports kept
function served(mem: any, reports: string[]) {
  const pick = Pick.load(null, config.OFFER, config.PICK);
  return Tools.serve(mem, {
    push   : (agent, kind, text) => void Memory.agent_push(mem, agent.name, kind, text),
    on     : (agent, ev: any) => void (ev.$ === "Entry" && ev.kind !== "user" && Memory.agent_push(mem, agent.name, ev.kind, ev.text)),
    report : (_agent, text) => void reports.push(text),
    change : () => {},
    pick   : () => pick,
    halt   : () => new AbortController().signal,
  });
}

test("a subagent sees its own tree and a brief of the chat's latest lines, never the chat's whole view", () => faked(async () => {
  const mem = Memory.load(DIR + "/brief", () => SHARE);
  Memory.push(mem, Array.from({ length: 40 }, (_, k) => ({ kind: "user" as const, text: "old chat " + k + " " + "x".repeat(380) })));
  const reports: string[] = [];
  const tools = served(mem, reports);
  calls.length = 0;
  expect(await Tools.spawn(tools, "main", ["do the thing"], null, null, "worker")).toContain("Started ");
  await until(() => reports.length === 1);
  expect(calls.length).toBe(1);
  const text = said(calls[0]);
  expect(text).toContain("do the thing");
  expect(text).toContain("old chat 39 ");
  expect(text).not.toContain("old chat 0 ");
  expect(text).toContain('zoom("^');
  expect(reports[0]).toContain("the report");
  Tools.close(tools);
  Memory.stop(mem);
}));

test("zoom from an agent: its own tree by id, its starter's chat by ^id; another agent's only for Unii", () => faked(async () => {
  const mem = Memory.load(DIR + "/zoom", () => SHARE);
  Memory.push(mem, [{ kind: "user", text: "the chat's first message" }]);
  const reports: string[] = [];
  const tools = served(mem, reports);
  await Tools.spawn(tools, "main", ["a task"], null, null, "worker");
  await until(() => reports.length === 1);
  const name = [...tools.agents.keys()][0];
  const zoom = (who: string, args: object) => Tools.call(tools, who, "zoom", args, new AbortController().signal, "1");

  expect((await zoom(name, { id: 1 })).text).toContain("a task");
  expect((await zoom(name, { id: "^0" })).text).toContain("the chat's first message");
  expect((await zoom("main", { id: name })).text).toContain("a task");
  expect((await zoom("main", { id: name + ":1" })).text).toContain("a task");
  const other = await zoom("Rogue", { id: name });
  expect(other.fail).toBe(true);
  expect(other.text).not.toContain("a task");
  Tools.close(tools);
  Memory.stop(mem);
}));

test("a call past ROLL tokens rolls over: asked again from its tree, its tool's result kept, its task word for word", () => faked(async () => {
  const mem = Memory.load(DIR + "/roll", () => SHARE);
  const reports: string[] = [];
  const tools = served(mem, reports);
  calls.length = 0;
  rolling = true;
  try {
    await Tools.spawn(tools, "main", ["the rolling task"], null, null, "worker");
    await until(() => reports.length === 1);
  } finally {
    rolling = false;
  }
  expect(calls.length).toBe(2);
  // the first call went on past its tool's result: a second step would
  // carry its first one's items; a roll asks anew, one message
  expect(calls[1].messages.length).toBe(1);
  const text = said(calls[1]);
  expect(text).toContain("the rolling task");
  expect(text).toMatch(/\|echo: /);
  expect(reports[0]).toContain("the report");
  Tools.close(tools);
  Memory.stop(mem);
}));

test("an agent's task stays word for word when its log since is too long to go raw", () => faked(async () => {
  const mem = Memory.load(DIR + "/longlog", () => SHARE);
  const name = Memory.agent_new(mem);
  Memory.agent_push(mem, name, "user", "the task to keep");
  for (let k = 0; k < 8; k++) {
    Memory.agent_push(mem, name, "echo", k + " " + "y".repeat(20000));
  }
  const seen = await Memory.agent_blocks(mem, name, new AbortController().signal);
  if (typeof seen === "string") {
    throw new Error(seen);
  }
  expect(seen.log.text).toContain("0|user: the task to keep");
  expect(seen.log.text).not.toContain("1|echo: ");
  Memory.stop(mem);
}));

test("a manager spawns workers; a worker's report wakes its manager, never Unii, and the manager's reaches Unii", () => faked(async () => {
  const mem = Memory.load(DIR + "/tiers", () => SHARE);
  const reports: string[] = [];
  const tools = served(mem, reports);
  calls.length = 0;
  const manager = (body: any) => said({ system: body.system }).includes("You are a manager");
  let managed = 0;
  script = (body) => {
    if (!manager(body)) {
      return answer("worker done");
    }
    managed += 1;
    return managed === 1 ? tooled("spawn", { tasks: ["the worker's part"] }, 1000) : managed === 2 ? answer("waiting on my worker") : answer("all managed");
  };
  try {
    expect(await Tools.spawn(tools, "main", ["manage it"], null, null, "manager")).toContain("Started ");
    await until(() => reports.length === 1);
  } finally {
    script = null;
  }
  const [mgr, wkr] = [...tools.agents.values()];
  expect(mgr.role).toMatchObject({ $: "sub", tier: "manager" });
  expect(wkr.role).toMatchObject({ $: "sub", tier: "worker" });
  expect(wkr.parent).toBe(mgr.name);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toContain("all managed");
  const log = Memory.agent(mem, mgr.name)!.map((r) => r.kind + ": " + r.text);
  expect(log.some((line) => line.startsWith("work: [" + wkr.name + "]") && line.includes("worker done"))).toBe(true);
  // a worker's request runs on the worker tier's model; the manager's on its own
  const model = (who: string) => calls.find((c) => said({ system: c.system }).includes(who))?.model;
  expect(model("You are a manager")).toBe("claude-sonnet-5-5");
  Tools.close(tools);
  Memory.stop(mem);
}));

// the payer holds the chat's summaries as its user runs out of credit
// (Billing.ts: the wallet holds its payee's mem): its agents' trees are
// held with it, each refused summary asked once, not again and again;
// with credit back, they build
test("a payer's refusal holds the agents' trees with the chat's: asked once, built once credit is back", () => faked(async () => {
  const mem = Memory.load(DIR + "/heldagents", () => SHARE);
  const name = Memory.agent_new(mem);
  let paid = 0;
  let credit = false;
  const grant = { max: 128000, cut: null, end: () => {} };
  mem.pay = (() => async () => {
    paid += 1;
    mem.hold[0] = credit ? null : "not enough credit";
    return credit ? grant : "not enough credit";
  }) as any;
  Memory.agent_push(mem, name, "unii", LONG(0));
  await sleep(200);
  expect(paid).toBe(1);
  const sub = Memory.agent_mem(mem, name)!;
  expect(Memory.node(sub, { l: 0, i: 0 })).toBeNull();
  await sleep(200);
  expect(paid).toBe(1);

  credit = true;
  mem.hold[0] = null;
  Memory.pump(mem);
  await until(() => Memory.node(sub, { l: 0, i: 0 }) !== null);
  Memory.stop(mem);
}));
