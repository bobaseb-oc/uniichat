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

// an agent at work, its call a stub that counts its stops
function working(tools: any, name: string): { stops: number } {
  const seen = { stops: 0 };
  const call = { stop: () => (seen.stops += 1) };
  tools.agents.set(name, { name, role: { $: "sub", effort: null }, call, live: [], calls: {}, stop: false, view: [], replies: [], user: false });
  return seen;
}

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
