// View test
// =========
// `bun test View.test.ts`. What a view draws of the server's messages.

import { expect, test } from "bun:test";
import * as View from "./View.ts";

const tail = (v: View.View) => View.view_tail(v).map((row) => (row.$ === "Cap" ? row.text : row.$));

// a turn waiting on its model names the model the server says: the
// wait holds it, so no pick (none yet) can name none
test("a turn's wait names its model", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, wait: "claude-opus-5-5", pick: null });
  expect(tail(v)).toEqual(["waiting for claude-opus-5-5…"]);
  View.view_hear(v, { $: "state", ...v, wait: View.SUMMARIES });
  expect(tail(v)).toEqual(["compressing earlier messages…"]);
  View.view_hear(v, { $: "state", ...v, wait: "" });
  expect(tail(v)).toEqual([]);
});

// /agent starts an agent on the task (both clients share view_act); with
// no task it says how, and sends nothing
test("/agent <task> asks to spawn an agent; no task, a note", () => {
  const v = View.view_new();
  expect(View.view_act(v, { $: "Send", text: "/agent  fix x " })).toEqual([{ $: "spawn", task: "fix x" }]);
  expect(View.view_act(v, { $: "Send", text: "/agent" })).toEqual([]);
  expect(v.notes.at(-1)).toBe("/agent needs a task: /agent <task>.");
});

const crew = (name: string, parent: string, tier: View.Crew["tier"], status: View.Crew["status"], since = 0): View.Crew => ({ name, parent, tier, model: tier === "manager" ? "sonnet-5.5" : "haiku-5.5", status, since });

// the crew: each agent under who started it, the ones failed first, then
// those at work, waiting, stopped, done; each row its depth and status
test("the crew lists each agent under its starter, failed first, then at work, waiting, stopped, done", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [
    crew("Done", "main", "worker", "done", 1),
    crew("Mgr", "main", "manager", "waiting", 2),
    crew("WkrA", "Mgr", "worker", "working", 3),
    crew("WkrB", "Mgr", "worker", "failed", 4),
    crew("Solo", "main", "worker", "working", 5),
  ] });
  const rows = View.view_crew(v, 65000);
  expect(rows.map((r) => [r.name, r.depth, r.status])).toEqual([
    ["Solo", 0, "working"], ["Mgr", 0, "waiting"], ["WkrB", 1, "failed"], ["WkrA", 1, "working"], ["Done", 0, "done"],
  ]);
  expect(rows[2].text).toContain("WkrB");
  expect(rows[2].text).toContain("haiku-5.5");
  expect(rows[2].text.startsWith("  ")).toBe(true);
  expect(rows[0].text).toContain("1m");
  expect(View.view_attention(v).map((r) => r.name)).toEqual(["WkrB"]);
});

// a person types to the agent whose page is shown: the message is told
// to it, never sent to UniiChat
test("typing on an agent's page tells that agent", () => {
  const v = View.view_new();
  View.view_act(v, { $: "Goto", name: "Mgr" });
  expect(View.view_typing(v)).toBe(true);
  expect(View.view_act(v, { $: "Send", text: " check WkrA again " })).toEqual([{ $: "tell", name: "Mgr", text: "check WkrA again" }]);
  expect(View.view_act(v, { $: "Send", text: "  " })).toEqual([]);
  View.view_act(v, { $: "Goto", name: null });
  expect(View.view_act(v, { $: "Send", text: "hi" })[0].$).toBe("say");
});
