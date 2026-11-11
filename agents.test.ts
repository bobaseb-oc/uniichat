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

async function vendor(_url: string, init: any): Promise<Response> {
  asked += 1;
  const content = JSON.parse(init.body).messages[0].content;
  const task: string = content[content.length - 1].text;
  if (hold) {
    await new Promise<void>((ok) => held.push(ok));
  }
  return answer("line for " + task.split("\n")[0]);
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
  const text = (blocks as Array<{ text: string }>).map((b) => b.text).join("");
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
