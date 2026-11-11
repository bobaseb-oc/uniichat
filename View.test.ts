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
