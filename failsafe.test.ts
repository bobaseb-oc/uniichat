// Fail-safe test
// ==============
// `bun test failsafe.test.ts`. A chat's summaries run through the real
// Memory, AskAI and Agent loop against a fake Anthropic out of credit
// (HTTP 400, "credit balance is too low"), then back: none is clipped, and
// the tree completes once credit is back; the one summary the model
// refuses is clipped (its input's doing); a turn in the outage says BUSY.
// A payer refusing summaries (the user out of credit) holds their side:
// each is asked once, none again, and none runs till credit comes; a
// turn waiting on them is told so at once. A request leads single flight
// only as it is sent. A rate limit's retries say BUSY too, the vendor's
// words logged once; imports share it alike. Timers run 1000 times fast.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-failsafe-");

process.env.UNII_DIR = DIR;

// a process reads Config once (maybe for another test)
const config = await import("./Config.ts");
config.KEYS.anthropic = "test";

const { Agent } = await import("./Agent.ts");
const { AskAI } = await import("./AskAI.ts");
const { Memory } = await import("./Memory.ts");
const { MASTER } = await import("./Tools.ts");

const SHARE = { vendor: "claude-api" as const, model: "claude-opus-5-5", effort: "medium", speed: "slow", system: MASTER, searches: 1, server: "" };

const BROKE = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
const LIMIT = "This request would exceed your organization's rate limit of 80,000 output tokens per minute.";
const BUSY  = "the AI service is busy or unavailable right now";
const SHORT = "not enough credit";

// messages, each too long to be its own summary; the one whose summary
// the model refuses
const COUNT   = 16;
const REFUSED = 5;
const MSGS    = Array.from({ length: COUNT }, (_, k) => ({ kind: "unii" as const, text: k + " " + "word ".repeat(200) }));

const real = { setTimeout, fetch, error: console.error };
const logged: string[] = [];

// the vendor: out of credit, or rate limited (`limited` requests more),
// or answering
let broke = true;
let limited = 0;
let refused = 0;

// a streamed answer: its text, how it stopped
function answer(text: string, stop: string): Response {
  const events = [
    { type: "message_start", message: { usage: {} } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 100 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((ev) => "data: " + JSON.stringify(ev) + "\n\n").join(""));
}

async function vendor(_url: string, init: any): Promise<Response> {
  const content = JSON.parse(init.body).messages[0].content;
  const task: string = content[content.length - 1].text;
  if (broke) {
    refused += 1;
    return Response.json({ type: "error", error: { type: "invalid_request_error", message: BROKE } }, { status: 400 });
  }
  if (limited > 0) {
    limited -= 1;
    return Response.json({ type: "error", error: { type: "rate_limit_error", message: LIMIT } }, { status: 429, headers: { "retry-after": "1" } });
  }
  const leaf = /compress message (\d+)/.exec(task)?.[1];
  return leaf === String(REFUSED) ? answer("", "refusal") : answer("line for " + task.split("\n")[0], "end_turn");
}

function sleep(ms: number): Promise<void> {
  return new Promise((ok) => real.setTimeout(ok, ms));
}

// every node of the tree: [part, its text or null]
function nodes(mem: any): Array<[{ l: number; i: number }, string | null]> {
  const out: Array<[{ l: number; i: number }, string | null]> = [];
  for (let l = 0; 2 ** l <= COUNT; l++) {
    for (let i = 0; i < COUNT / 2 ** l; i++) {
      out.push([{ l, i }, Memory.node(mem, { l, i })]);
    }
  }
  return out;
}

// once the vendor answers: the tree completes by itself, each node the
// model's line but the refused one, clipped
async function completes(mem: any): Promise<void> {
  for (let t = 0; t < 100 && nodes(mem).some(([, text]) => text === null); t++) {
    await sleep(50);
  }
  const source = Memory.flat(Memory.source(mem, 0, REFUSED)!);
  for (const [{ l, i }, text] of nodes(mem)) {
    expect(text).toEqual(l === 0 && i === REFUSED ? Memory.cut(source) : expect.stringMatching(/^line for Compaction:/));
  }
  expect(logged.filter((line) => line.includes("clipped"))).toEqual(["compactor: node 0/" + REFUSED + ": stopped: refusal; clipped"]);
  Memory.stop(mem);
}

// runs `go` with timers 1000 times fast, the fake vendor, the log kept
async function fast(go: () => Promise<void>): Promise<void> {
  globalThis.setTimeout = ((go: () => void, ms = 0) => real.setTimeout(go, ms / 1000)) as any;
  globalThis.fetch = vendor as any;
  console.error = (...args: unknown[]) => logged.push(args.join(" "));
  logged.length = 0;
  try {
    await go();
  } finally {
    Object.assign(globalThis, { setTimeout: real.setTimeout, fetch: real.fetch });
    console.error = real.error;
  }
}

test("an outage delays summaries, never clips them; a refusal clips", () => fast(async () => {
  const mem = Memory.load(DIR + "/chat", () => SHARE);
  Memory.push(mem, MSGS);
  await sleep(300);
  expect(refused).toBeGreaterThan(2 * COUNT);
  expect(nodes(mem).filter(([, text]) => text !== null)).toEqual([]);
  expect(logged.filter((line) => line.includes("clipped"))).toEqual([]);
  expect(logged.some((line) => line.includes(BROKE.slice(0, 40)))).toBe(true);

  const turn = await AskAI.ask({ ...SHARE, blocks: [{ text: "hi", mark: true }] }, () => {}).done;
  expect(turn).toMatchObject({ ok: false, stop: "down", text: BUSY });

  broke = false;
  await completes(mem);
}));

// the payer as Billing.ts book: out of credit, it holds the side
test("a summary its payer refuses holds its side: asked once, never again", () => fast(async () => {
  let paid = 0;
  let credit = false;
  const grant = { max: 128000, cut: null, end: () => {} };
  const mem = Memory.load(DIR + "/held", () => SHARE);
  mem.pay = () => async () => {
    paid += 1;
    mem.hold[0] = credit ? null : SHORT;
    return credit ? grant : SHORT;
  };
  Memory.push(mem, MSGS);
  await sleep(300);
  expect(paid).toBe(COUNT);
  expect(mem.busy.size).toBe(0);
  expect(nodes(mem).filter(([, text]) => text !== null)).toEqual([]);
  await sleep(300);
  expect(paid).toBe(COUNT);

  credit = true;
  mem.hold[0] = null;
  Memory.pump(mem);
  await completes(mem);
}));

// a turn (or agent) needs the summaries before it: held for credit, it is
// told why at once (Server.ts then answers "No reply: not enough credit")
test("a turn waiting on summaries held for credit is told so at once", () => fast(async () => {
  let credit = false;
  const grant = { max: 128000, cut: null, end: () => {} };
  const mem = Memory.load(DIR + "/short", () => SHARE);
  mem.pay = () => async () => {
    mem.hold[0] = credit ? null : SHORT;
    return credit ? grant : SHORT;
  };
  Memory.push(mem, MSGS);
  const signal = new AbortController().signal;
  const told = await Promise.race([Memory.settle(mem, mem.count, signal), sleep(300).then(() => "still waiting")]);
  expect(told).toBe(SHORT);

  credit = true;
  mem.hold[0] = null;
  Memory.pump(mem);
  expect(await Memory.settle(mem, mem.count, signal)).toBeNull();
  await completes(mem);
}));

// two calls of one prefix (as every new chat's first summaries share),
// the first held before it is sent: by its payer (its user's credit
// booked by their other requests), or yielding (an import's, its model
// busy: Agent.ts). It leads no single flight, so the second goes at once
test("a request leads single flight only as it is sent", () => fast(async () => {
  let pay = () => {};
  const grant = { max: 128000, cut: null, end: () => {} };
  const room = Agent.room(SHARE.model);
  const asked: string[] = [];
  const vend = globalThis.fetch;
  globalThis.fetch = ((url: string, init: any) => (asked.push(JSON.parse(init.body).messages[0].content.at(-1).text), vend(url, init))) as any;
  const holds = { payer: { bill: () => new Promise((ok) => (pay = () => ok(grant))) }, yields: { yields: DIR } };
  for (const [why, hold] of Object.entries(holds)) {
    const blocks = (who: string) => [{ text: "<chat>\n" + why + "\n", mark: true }, { text: "</chat>\n", mark: false }, { text: who + " " + why, mark: false }];
    room.busy = why === "yields" ? 1 : 0;
    const held = AskAI.ask({ ...SHARE, blocks: blocks("held"), ...hold }, () => {});
    await sleep(20);
    const free = AskAI.ask({ ...SHARE, blocks: blocks("free") }, () => {}).done;
    expect(await Promise.race([free, sleep(300).then(() => "still waiting")])).toMatchObject({ ok: true });
    pay();
    room.busy = 0;
    room.wait.splice(0).forEach((ok) => ok());
    expect(await held.done).toMatchObject({ ok: true });
  }
  expect(asked).toEqual(["free payer", "held payer", "free yields", "held yields"]);
}));

test("a rate limit's retries say BUSY; the vendor's words go to the log", () => fast(async () => {
  limited = 3; // the first two retries are quiet (retry.test.ts); the third says BUSY
  const before = Date.now();
  const minds: string[] = [];
  const on = (ev: any) => ev.kind === "mind" && minds.push(ev.text);
  const turn = await AskAI.ask({ ...SHARE, blocks: [{ text: "hi", mark: true }] }, on).done;
  expect(turn.ok).toBe(true);
  expect(minds).toEqual(["The AI service is busy: asking again in 1 s."]);
  expect(Agent.health.busy).toBeGreaterThanOrEqual(before); // the status line's "AI service busy" (Gateway.ts)
  expect(logged).toEqual([SHARE.model + ": HTTP 429: " + LIMIT + ": its requests ask again", SHARE.model + ": none asks again"]);
}));

// two imports at a rate-limited model, one running 4 requests, the other
// 1: each asks again by one request at a time, its others waiting on it,
// so past the first refusals both get the same tries at the limit
test("imports share a busy model alike", () => fast(async () => {
  limited = 9;
  const refusals: string[] = [];
  globalThis.fetch = ((url: string, init: any) => {
    const who = JSON.parse(init.body).messages[0].content.at(-1).text;
    refusals.push(...(limited > 0 ? [who[0]] : []));
    return vendor(url, init);
  }) as any;
  const ask = (who: string) => AskAI.ask({ ...SHARE, blocks: [{ text: who, mark: false }], yields: who[0] }, () => {}).done;
  const ends = await Promise.all(["a0", "a1", "a2", "a3", "b0"].map(ask));
  expect(ends.map((end) => end.ok)).toEqual([true, true, true, true, true]);
  expect(refusals.slice(5).sort()).toEqual(["a", "a", "b", "b"]);
  expect(logged.filter((line) => line.includes(LIMIT))).toHaveLength(1);
}));

// a stream of `events`, one each `gap` ms (real time) after a start, then
// its end (or none: forever); a stop ends it, as fetch does
function drip(events: object[], gap: number, forever: boolean, signal: AbortSignal): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      signal.addEventListener("abort", () => c.error(signal.reason));
      const say = (ev: object) => c.enqueue(new TextEncoder().encode("data: " + JSON.stringify(ev) + "\n\n"));
      say({ type: "message_start", message: { usage: {} } });
      for (let k = 0; forever || k < events.length; k++) {
        await sleep(gap);
        if (signal.aborted) {
          return;
        }
        say(forever ? { type: "ping" } : events[k]);
      }
      c.close();
    },
  });
  return new Response(body);
}

// a request through the real Anthropic wire, the stream `make`s; its step,
// or "hung" if it never ends
async function sent(make: (signal: AbortSignal) => Response): Promise<any> {
  const { Anthropic } = await import("./Anthropic.ts");
  globalThis.fetch = ((_url: string, init: any) => Promise.resolve(make(init.signal))) as any;
  const run = { ask: { ...SHARE, blocks: [] }, on: () => {}, sent: [], abort: new AbortController(), end: () => {} } as any;
  const grant = { max: 1000, cut: null, end: () => {} };
  const go = Agent.send(Anthropic.wire, run, "test", {}, grant, { begun: () => {}, end: () => {} }, []).then((r: any) => r.step);
  return Promise.race([go, sleep(3000).then(() => "hung")]);
}

test("a stream that only pings is stalled: its request ends as idle", () => fast(async () => {
  const step = await sent((signal) => drip([], 50, true, signal));
  expect(step).not.toBe("hung");
  expect(step.why).toContain("no word from the API in 300 s");
}));

test("a stream that writes, each piece within the idle time, is never cut, however long it runs", () => fast(async () => {
  const text = (t: string) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } });
  const events = [
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...["a", "b", "c", "d", "e"].map(text),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ];
  const step = await sent((signal) => drip(events, 100, false, signal));
  expect(step.stop).toBe("done");
}));

// the vendor down for good (as a gateway past its budget): a turn waits on
// the summaries before it SETTLE at most, then goes, each line not built
// shown as such (zoom opens it), the compactor's last words kept to say
// why; once the vendor answers the tree completes and they are let go
test("a turn waits on summaries a down vendor won't build only so long, told why", () => fast(async () => {
  broke = true;
  const mem = Memory.load(DIR + "/deadline", () => SHARE);
  Memory.push(mem, MSGS);
  const signal = new AbortController().signal;
  const told = await Promise.race([Memory.settle(mem, mem.count, signal), sleep(300).then(() => "still waiting")]);
  expect(told).toBeNull();
  expect(Memory.first(mem)).toBeLessThan(mem.count);
  const lines = Memory.view(mem).map((block) => block.text).join("").split("\n").filter((line) => /^\d+\+\d+\|/.test(line));
  expect(lines).toEqual(MSGS.map((_, k) => k + "+1|(not summarized yet: zoom it)"));
  expect(mem.trouble).toContain(BROKE.slice(0, 40));

  broke = false;
  await completes(mem);
  expect(mem.trouble).toBeNull();
}));

// each request's usage told to its asker (Ask.used), as the vendor told it:
// what the cockpit's per-agent cost is estimated from; billing untouched
test("a request's usage is told to its asker", () => fast(async () => {
  broke = false;
  const used: any[] = [];
  const end = await AskAI.ask({ ...SHARE, blocks: [{ text: "hi", mark: true }], used: (u) => used.push(u) }, () => {}).done;
  expect(end.ok).toBe(true);
  expect(used.length).toBe(1);
  expect(used[0].run.model).toBe("claude-opus-5-5");
  expect(used[0].use.output).toBe(100);
}));
