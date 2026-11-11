// Tools test
// ==========
// `bun test Tools.test.ts`. A chat moves twice (A to B to C) while an
// agent's call still runs in A, its MCP requests sent to A's tools. B,
// once its relay is done, ends; A's requests must then reach C, not B:
// C taking the call tells A where the chat is (Main.far, Tools.went).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

process.env.UNII_DIR = fs.mkdtempSync(os.tmpdir() + "/unii-tools-");

const { Tools } = await import("./Tools.ts");

test("a call's MCP requests follow its chat past a process that ended", async () => {
  const tools = Tools.serve({} as any, {} as any);
  const ask = () => fetch(Tools.at(tools, "main"), { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  // B: took the chat, then gave it on and ended
  const b = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("b") });
  const at_b = "http://127.0.0.1:" + b.port + "/";
  Tools.give(tools, at_b, () => "");
  expect(await (await ask()).text()).toBe("b");
  b.stop(true);
  // C: has the chat now; without Tools.went, A would still pass to B:
  // "Unable to connect", as every deploy's second handoff did
  const c = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => new Response("c " + new URL(req.url).pathname) });
  Tools.went(tools.key, "http://127.0.0.1:" + c.port + "/");
  expect(await (await ask()).text()).toBe("c /" + tools.key + "/main");
  c.stop(true);
});

// an agent at work (a worker of Unii, unless said), its call a stub that
// counts its stops
function working(tools: any, name: string, tier = "worker", parent = "main"): { stops: number } {
  const seen = { stops: 0 };
  const call = { stop: () => (seen.stops += 1) };
  tools.agents.set(name, { name, parent, role: { $: "sub", tier, effort: null, model: null }, call, live: [], calls: {}, stop: false, replies: [], user: false });
  return seen;
}

const go = () => new AbortController().signal;

test("the main agent stops agents at work by name, which tell can't", async () => {
  const tools = Tools.serve({} as any, {} as any);
  const a = working(tools, "HungA");
  const b = working(tools, "HungB");
  const c = working(tools, "Busy");
  const out = await Tools.call(tools, "main", "stop", { names: ["HungA", "HungB", "Nobody"] }, new AbortController().signal, "1");
  expect(out.fail).toBe(false);
  expect(out.text).toContain("Stopped HungA, HungB.");
  expect(out.text).toContain("Nobody");
  expect([a.stops, b.stops, c.stops]).toEqual([1, 1, 0]);
  expect(tools.agents.get("HungA")!.stop).toBe(true);
  expect(tools.agents.get("Busy")!.stop).toBe(false);
  Tools.close(tools);
});

test("a subagent can't stop another, nor sees the stop tool", async () => {
  const tools = Tools.serve({} as any, {} as any);
  const a = working(tools, "Victim");
  working(tools, "Rogue");
  const out = await Tools.call(tools, "Rogue", "stop", { names: ["Victim"] }, new AbortController().signal, "1");
  expect(out.fail).toBe(true);
  expect(a.stops).toBe(0);
  expect(Tools.list(tools, "main").map((t) => t.name)).toContain("stop");
  expect(Tools.list(tools, "Rogue").map((t) => t.name)).not.toContain("stop");
  Tools.close(tools);
});

test("a worker has no spawn, tell or stop, and calling them is refused", async () => {
  const tools = Tools.serve({} as any, {} as any);
  working(tools, "Mgr", "manager");
  working(tools, "Wkr", "worker", "Mgr");
  const names = Tools.list(tools, "Wkr").map((t) => t.name);
  expect(names).not.toContain("spawn");
  expect(names).not.toContain("tell");
  expect(names).not.toContain("stop");
  expect(Tools.list(tools, "Mgr").map((t) => t.name)).toEqual(expect.arrayContaining(["spawn", "tell", "stop"]));
  expect(Tools.list(tools, "Mgr").map((t) => t.name)).not.toContain("computer");
  for (const tool of ["spawn", "tell", "stop"]) {
    expect((await Tools.call(tools, "Wkr", tool, { tasks: ["x"], name: "Mgr", message: "hi", names: ["Mgr"] }, go(), "1")).fail).toBe(true);
  }
  Tools.close(tools);
});

test("a manager tells and stops only its own workers; stopping a manager stops its workers", async () => {
  const tools = Tools.serve({} as any, {} as any);
  working(tools, "MgrA", "manager");
  const a = working(tools, "WkrA", "worker", "MgrA");
  working(tools, "MgrB", "manager");
  const b = working(tools, "WkrB", "worker", "MgrB");
  const other = await Tools.call(tools, "MgrA", "stop", { names: ["WkrB"] }, go(), "1");
  expect(b.stops).toBe(0);
  expect(other.text).not.toContain("Stopped WkrB");
  expect((await Tools.call(tools, "MgrA", "tell", { name: "WkrB", message: "hi" }, go(), "1")).fail).toBe(true);
  expect((await Tools.call(tools, "MgrA", "stop", { names: ["WkrA"] }, go(), "1")).text).toContain("Stopped WkrA.");
  expect(a.stops).toBe(1);
  Tools.stop(tools, "MgrB");
  expect(b.stops).toBe(1);
  expect(tools.agents.get("WkrB")!.stop).toBe(true);
  Tools.close(tools);
});

test("a child runs on its tier's model or one below it, never above nor another vendor's", async () => {
  expect(Tools.child("manager", null)).toMatchObject({ model: "sonnet-5.5" });
  expect(Tools.child("worker", "haiku-5.5")).toMatchObject({ model: "haiku-5.5" });
  expect(typeof Tools.child("worker", "opus-5.5")).toBe("string");
  expect(typeof Tools.child("manager", "gpt-6-luna")).toBe("string");
  expect(typeof Tools.child("worker", "no-such-model")).toBe("string");
  const tools = Tools.serve({} as any, {} as any);
  const out = await Tools.call(tools, "main", "spawn", { tasks: ["x"], model: "opus-5.5" }, go(), "1");
  expect(out.fail).toBe(true);
  expect(tools.agents.size).toBe(0);
  Tools.close(tools);
});

test("an agent's note says its tier, starter, model and effort, and reads back as them", () => {
  const role = { $: "sub" as const, tier: "worker" as const, effort: "high", model: "haiku-5.5" };
  const note = Tools.note(role, "FireAnt");
  expect(note).toBe("worker of FireAnt on haiku-5.5 at effort high");
  expect(Tools.noted(note)).toEqual({ role, parent: "FireAnt" });
  expect(Tools.noted(Tools.note({ $: "sub", tier: "manager", effort: null, model: null }, "main"))).toEqual({ role: { $: "sub", tier: "manager", effort: null, model: null }, parent: "main" });
  // an older agent's: a worker of Unii
  expect(Tools.noted("subagent at effort low")).toEqual({ role: { $: "sub", tier: "worker", effort: "low", model: null }, parent: "main" });
  expect(Tools.noted("computer task on mac")).toEqual({ role: { $: "hands", device: "mac" }, parent: "main" });
  expect(Tools.noted("something else")).toBeNull();
});

test("the crew: each agent's tier, starter, model and status; one dismissed is gone", () => {
  const tools = Tools.serve({} as any, { pick: () => ({ vendor: "claude-api", model: "opus-5.5", effort: "high", speed: "slow" }) } as any);
  working(tools, "Mgr", "manager");
  working(tools, "Wkr", "worker", "Mgr");
  tools.agents.set("Old", { name: "Old", parent: "main", role: { $: "sub", tier: "worker", effort: null, model: "haiku-5.5" }, call: null, live: [], calls: {}, stop: false, replies: ["failed: boom"], user: false });
  tools.agents.get("Mgr")!.call = null;
  const crew = Object.fromEntries(Tools.crew(tools).map((c) => [c.name, c]));
  expect(crew.Mgr).toMatchObject({ parent: "main", tier: "manager", model: "sonnet-5.5", status: "waiting" });
  expect(crew.Wkr).toMatchObject({ parent: "Mgr", tier: "worker", status: "working" });
  expect(crew.Old).toMatchObject({ model: "haiku-5.5", status: "failed" });
  tools.agents.get("Old")!.hidden = true;
  expect(Tools.crew(tools).map((c) => c.name)).not.toContain("Old");
  Tools.close(tools);
});
