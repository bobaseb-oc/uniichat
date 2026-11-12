// Paint test
// ==========
// `bun test Paint.test.ts`. The terminal's crew panel (Paint.crew_lines):
// UniiChat on top, each agent under its starter, the page shown marked,
// a failed one red, no line past the width, rows past the most counted.

import { expect, test } from "bun:test";
import * as Paint from "./Paint.ts";
import * as View from "./View.ts";

const text = (l: Paint.Line) => l.map((r) => r.x).join("");
const crew = (name: string, parent: string, status: View.Status): View.Crew => ({ name, parent, tier: parent === "main" ? "manager" : "worker", model: "sonnet-5.5", status, since: 0 });

test("the crew panel: UniiChat, its agents under their starters, the page shown bold, a failed one red", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, busy: true, pick: { vendor: "claude-api", model: "opus-5.5", effort: "high", speed: "slow" }, crew: [crew("Mgr", "main", "waiting"), crew("Wkr", "Mgr", "failed")] });
  View.view_act(v, { $: "Goto", name: "Mgr" });
  const lines = Paint.crew_lines(v, 60, 120000, 8);
  expect(lines.map(text)).toEqual([
    expect.stringMatching(/^ {2}◆ UniiChat · orchestrator · opus-5\.5 · working/),
    expect.stringMatching(/^▸   ◐ Mgr · manager · sonnet-5\.5/),
    expect.stringMatching(/^ {6}✗ Wkr · worker · sonnet-5\.5/),
  ]);
  expect(lines[1].find((r) => r.x.includes("Mgr"))!.s.b).toBe(true);
  expect(lines[2].find((r) => r.x.includes("Wkr"))!.s.b).toBe(false);
  expect(lines[2].some((r) => r.s.c === "1")).toBe(true);
  for (const l of Paint.crew_lines(v, 20, 0, 8)) {
    expect(Paint.text_width(text(l))).toBeLessThanOrEqual(20);
  }
});

test("past the most rows, the rest are counted", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: Array.from({ length: 6 }, (_, k) => crew("A" + "bcdefg"[k], "main", "working")) });
  const lines = Paint.crew_lines(v, 60, 0, 4);
  expect(lines).toHaveLength(4);
  expect(text(lines[3])).toContain("+4 more");
});

// /crew full: a head (what's going on, the keys), who needs you, then the
// tree, the selection marked, each row's activity line; no line past the
// width, none past the height (the selection kept in sight)
test("the full-screen Crew: head, needs, tree with its selection, within the screen", async () => {
  const { demo_crew, demo_pulses } = await import("./Demo.ts");
  const v = View.view_new();
  const all = demo_crew(1e12);
  View.view_hear(v, { $: "state", ...v, crew: all });
  demo_pulses(all).forEach((p) => View.view_hear(v, p));
  View.view_act(v, { $: "Expand", name: "Mgr1" });
  const lines = Paint.crew_full(v, 70, 24, "W1-0", 1e12).map(text);
  expect(lines.length).toBeLessThanOrEqual(24);
  expect(lines[0]).toMatch(/^Crew · \d+ working, \d+ need you/);
  expect(lines.some((l) => l.includes("Claude1 asks to start"))).toBe(true);
  expect(lines.filter((l) => l.startsWith("▸ "))).toHaveLength(1);
  expect(lines.find((l) => l.startsWith("▸ "))).toContain("W1-0");
  expect(lines.some((l) => l.includes("Mgr0") && l.includes("working,"))).toBe(true);
  for (const l of lines) {
    expect(l.length).toBeLessThanOrEqual(70);
  }
  // a short screen still shows the selection
  const short = Paint.crew_full(v, 70, 8, "Mgr7", 1e12).map(text);
  expect(short.length).toBeLessThanOrEqual(8);
  expect(short.some((l) => l.startsWith("▸ ") && l.includes("Mgr7"))).toBe(true);
});
