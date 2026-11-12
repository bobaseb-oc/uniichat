// Html test
// =========
// `bun test Html.test.ts`. The site's crew (web/src/Html.ts crew_html):
// UniiChat, then each agent under its starter, a button that shows its
// page; the page shown marked; done and failed ones dismissable; names
// escaped.

import { expect, test } from "bun:test";
import * as Html from "./web/src/Html.ts";
import * as View from "./View.ts";

const crew = (name: string, parent: string, status: View.Status): View.Crew => ({ name, parent, tier: parent === "main" ? "manager" : "worker", model: "sonnet-5.5", status, since: 0 });

test("the crew: UniiChat, each agent under its starter, the page shown marked, done ones dismissable", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Mgr", "main", "waiting"), crew("Wkr", "Mgr", "failed"), crew("Old", "main", "done")] });
  View.view_act(v, { $: "Goto", name: "Wkr" });
  const html = Html.crew_html(v, 0);
  expect(html).toHaveLength(4);
  expect(html[0]).toContain("UniiChat · orchestrator");
  expect(html[0]).not.toContain('class="here');
  expect(html[1]).toContain('class="crew d0 waiting"');
  expect(html[2]).toContain('class="crew d1 failed here"');
  expect(html[2]).toContain("&quot;Dismiss&quot;");
  expect(html[1]).not.toContain("Dismiss");
  expect(html[3]).toContain("&quot;Dismiss&quot;");
  expect(View.view_act(v, { $: "Dismiss", name: "Old" })).toEqual([{ $: "dismiss", name: "Old" }]);
});

test("a name from the server is escaped", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("<b>x</b>", "main", "done")] });
  const html = Html.crew_html(v, 0).join("");
  expect(html).not.toContain("<b>x</b>");
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
});

test("a Claude Code worker asking to start has approve and deny buttons, no dismiss", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [{ ...crew("Cc", "main", "asking"), tier: "claude" }] });
  const row = Html.crew_html(v, 0)[1];
  expect(row).toContain("&quot;Approve&quot;,&quot;name&quot;:&quot;Cc&quot;,&quot;yes&quot;:true");
  expect(row).toContain("&quot;yes&quot;:false");
  expect(row).not.toContain("Dismiss");
});

// The Crew view (Html.tree_html, needs_html, mode_html)
// ------------------------------------------------------

const act = (a: object) => JSON.stringify(a).replace(/"/g, "&quot;");

test("the tree: a folded manager with its roll-up and a caret; rows link to their focus", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Mgr", "main", "waiting"), crew("W1", "Mgr", "working"), crew("W2", "Mgr", "done")] });
  const html = Html.tree_html(v, 0);
  expect(html).toHaveLength(1);
  expect(html[0]).toContain('href="#crew/Mgr"');
  expect(html[0]).toContain("1 working, 1 done");
  expect(html[0]).toContain(act({ $: "Expand", name: "Mgr" }));
  expect(html[0]).toContain("▸");
  View.view_act(v, { $: "Expand", name: "Mgr" });
  const open = Html.tree_html(v, 0);
  expect(open).toHaveLength(3);
  expect(open[0]).toContain("▾");
  expect(open[1]).not.toContain("Expand");
});

// each status gets its actions: at work, stop; asking, approve and deny;
// done, failed or stopped, dismiss
test("the tree's inline actions follow the status", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Run", "main", "working"), { ...crew("Cc", "main", "asking"), tier: "claude" }, crew("Bad", "main", "failed")] });
  View.view_act(v, { $: "Goto", name: "Run" });
  const [cc, bad, run] = Html.tree_html(v, 0);
  expect(run).toContain(act({ $: "Stop", name: "Run" }));
  expect(run).not.toContain("Dismiss");
  expect(run).toContain(" here");
  expect(cc).toContain(act({ $: "Approve", name: "Cc", yes: true }));
  expect(cc).not.toContain("Stop");
  expect(bad).toContain(act({ $: "Dismiss", name: "Bad" }));
  expect(bad).not.toContain("Stop");
});

test("names are escaped in the tree, its links and the needs lane", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew('<i>"x', "main", "failed")] });
  const html = [...Html.tree_html(v, 0), ...Html.needs_html(v)].join("");
  expect(html).not.toContain("<i>");
  expect(html).toContain('href="#crew/%3Ci%3E%22x"');
});

test("the needs lane: one per agent that needs you, none when none do", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Ok", "main", "working")] });
  expect(Html.needs_html(v)).toEqual([]);
  View.view_hear(v, { $: "state", ...v, crew: [crew("Ok", "main", "working"), crew("Bad", "main", "failed"), { ...crew("Cc", "main", "asking"), tier: "claude" }] });
  const lane = Html.needs_html(v);
  expect(lane).toHaveLength(2);
  expect(lane[0]).toContain("Cc");
  expect(lane[0]).toContain("asks to start");
  expect(lane[1]).toContain("Bad");
});

test("the mode switch: the one shown marked, the pill on Crew", () => {
  const chat = Html.mode_html("chat", "2 working, 1 need you").join("");
  expect(chat).toContain('href="#chat" class="here"');
  expect(chat).toContain("2 working, 1 need you");
  expect(chat).toContain('class="pill need"');
  expect(Html.mode_html("crew", "2 working").join("")).toContain('href="#crew" class="here"');
  expect(Html.mode_html("chat", "").join("")).not.toContain("pill");
});

test("the focus card: the agent in focus with its actions, or Unii's chat", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Run", "main", "working")] });
  expect(Html.focus_html(v)).toContain("UniiChat");
  View.view_act(v, { $: "Goto", name: "Run" });
  const card = Html.focus_html(v);
  expect(card).toContain("<b>Run</b>");
  expect(card).toContain("working");
  expect(card).toContain(act({ $: "Stop", name: "Run" }));
  View.view_act(v, { $: "Goto", name: "Gone" });
  expect(Html.focus_html(v)).toContain("<b>Gone</b>");
  expect(Html.focus_html(v)).not.toContain("Stop");
});

// a row's activity line: at work, what it does now; else its report's
// last line; escaped
test("a tree row shows its pulse: what it does at work, its last line done", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Run", "main", "working"), crew("Old", "main", "done")] });
  View.view_hear(v, { $: "pulse", name: "Run", status: "working", act: "shell: <bun test>", last: "older" });
  View.view_hear(v, { $: "pulse", name: "Old", status: "done", act: "x", last: "Tests: 12 pass." });
  const [run, old] = Html.tree_html(v, 0);
  expect(run).toContain('<div class="line">shell: &lt;bun test&gt;</div>');
  expect(old).toContain('<div class="line">Tests: 12 pass.</div>');
  View.view_hear(v, { $: "pulse", name: "Run", status: "working", act: "", last: "" });
  expect(Html.tree_html(v, 0)[0]).not.toContain('class="line"');
});

// The Crew grid (Html.grid_html): a tile per agent Unii started, its dots
// linking to each under it, its roll-up, its pulse, its actions and a box
// to tell it
test("the grid: tiles with dots, roll-up, pulse, actions and a tell box", async () => {
  const { demo_crew, demo_pulses } = await import("./Demo.ts");
  const v = View.view_new();
  const crew = demo_crew(1e12);
  View.view_hear(v, { $: "state", ...v, crew });
  demo_pulses(crew).forEach((p) => View.view_hear(v, p));
  const tiles = Html.grid_html(v, 1e12);
  expect(tiles).toHaveLength(9);
  const m1 = tiles.find((t) => t.includes('href="#crew/Mgr1"'))!;
  expect(m1.match(/class="dot /g)).toHaveLength(5);
  expect(m1).toContain('href="#crew/W1-0"');
  expect(m1).toContain('data-tell="Mgr1"');
  expect(m1).toContain(act({ $: "Stop", name: "Mgr1" }));
  expect(tiles.find((t) => t.includes('href="#crew/Claude1"'))).toContain(act({ $: "Approve", name: "Claude1", yes: true }));
});

test("a tile's name is escaped in its tell box", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew('a"><b', "main", "working")] });
  const tile = Html.grid_html(v, 0)[0];
  expect(tile).not.toContain('"><b');
  expect(tile).toContain('data-tell="a&quot;&gt;&lt;b"');
});
