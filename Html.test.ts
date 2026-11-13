// Html test
// =========
// `bun test Html.test.ts`. The site's Crew view (web/src/Html.ts): the
// tree, who needs you, the focus card, the switch, the grid, the lane;
// names escaped.

import { expect, test } from "bun:test";
import * as Html from "./web/src/Html.ts";
import * as View from "./View.ts";

const crew = (name: string, parent: string, status: View.Status): View.Crew => ({ name, parent, tier: parent === "main" ? "manager" : "worker", model: "sonnet-5.5", status, since: 0 });

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
  expect(Html.focus_html(v)).toContain("Legion");
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

// the lane's marks: placed by time, a message's a button that jumps to
// it, a label escaped as its tooltip
test("the lane: marks placed and titled, messages jump to their row", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Mgr", "main", "done")] });
  View.view_act(v, { $: "Goto", name: "Mgr" });
  View.view_hear(v, { $: "agent", name: "Mgr", found: true });
  View.view_hear(v, { $: "entry", agent: "Mgr", kind: "user", text: "<task>", date: new Date(1e12).toISOString() });
  View.view_hear(v, { $: "entry", agent: "Mgr", kind: "tool", text: "shell: ls", date: new Date(1e12 + 1000).toISOString() });
  const lane = Html.lane_html(v, 1e12 + 2000);
  expect(lane).toContain('class="mk told" style="left:0%"');
  expect(lane).toContain('data-seek="1"');
  expect(lane).toContain("&lt;task&gt;");
  expect(lane).not.toContain("<task>");
  View.view_act(v, { $: "Goto", name: null });
  expect(Html.lane_html(v, 0)).toBe("");
});

// Labels: the title (the agent's goal) is the main line, its repos chips,
// its name under it; no title, the name; all escaped
test("labels: title first, repo chips, the name under it", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [
    { ...crew("FireAnt", "main", "working"), title: "Fix <flaky> login tests", repos: ["auth-api", "w&b"] },
    crew("PlainOwl", "main", "failed"),
  ] });
  const [plain, fire] = Html.tree_html(v, 0);
  expect(fire).toContain("<b>Fix &lt;flaky&gt; login tests</b>");
  // the tree is narrow: the name and repos in the row's tooltip
  expect(fire).toMatch(/title="FireAnt · manager · .* · auth-api, w&amp;b"/);
  expect(plain).toContain("<b>PlainOwl</b>");
  expect(plain).not.toContain('class="repo"');
  const tile = Html.grid_html(v, 0).find((t) => t.includes("FireAnt"))!;
  expect(tile).toContain("<b>Fix &lt;flaky&gt; login tests</b>");
  expect(tile).toContain('<div class="repos"><span class="repo">auth-api</span><span class="repo">w&amp;b</span></div>');
  View.view_act(v, { $: "Goto", name: "FireAnt" });
  expect(Html.focus_html(v)).toContain("<b>Fix &lt;flaky&gt; login tests</b>");
  expect(Html.focus_html(v)).toContain('<span class="repo">auth-api</span>');
  View.view_hear(v, { $: "state", ...v, crew: [{ ...crew("FireAnt", "main", "failed"), title: "Fix login" }] });
  expect(Html.needs_html(v)[0]).toContain("<b>Fix login</b>");
  expect(Html.needs_html(v)[0]).toContain("FireAnt");
});

// an agent's checklist (Tools.todo): the focus card lists it, each item
// marked by its status and escaped; a tile says how far (done/all); none:
// nothing
test("todo: the focus card lists the checklist, a tile says done/all", () => {
  const v = View.view_new();
  const todo: View.Todo[] = [{ text: "Read <the> test", status: "done" }, { text: "Fix it", status: "doing" }, { text: "Run all", status: "pending" }];
  View.view_hear(v, { $: "state", ...v, crew: [{ ...crew("FireAnt", "main", "working"), todo }, crew("PlainOwl", "main", "working")] });
  View.view_act(v, { $: "Goto", name: "FireAnt" });
  expect(Html.focus_html(v)).toContain('<ol class="todo"><li class="done">Read &lt;the&gt; test</li><li class="doing">Fix it</li><li class="pending">Run all</li></ol>');
  const tile = Html.grid_html(v, 0).find((t) => t.includes("FireAnt"))!;
  expect(tile).toContain('<span class="todo">1/3</span>');
  View.view_act(v, { $: "Goto", name: "PlainOwl" });
  expect(Html.focus_html(v)).not.toContain("todo");
  expect(Html.grid_html(v, 0).find((t) => t.includes("PlainOwl"))!).not.toContain("todo");
});

// the question backlog pane: each question escaped (its lines kept), its
// offered answers as buttons, an answer box, a dismiss; none: nothing. The
// Crew's needs-you lane lists them first, linking to the chat
test("questions: the pane, and the needs-you lane lists them first", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, questions: [{ id: 3, text: "Ship <now>?\nOr Friday?", options: ["now", "Friday"], at: 0, date: "2026-11-12T10:00:00.000Z" }], crew: [crew("Bad", "main", "failed")] } as any);
  const [pane] = Html.questions_html(v);
  expect(pane).toContain('<div class="qt">Ship &lt;now&gt;?\nOr Friday?</div>');
  expect(pane).toContain(act({ $: "Answer", q: 3, text: "Friday" }) + '">Friday</button>');
  expect(pane).toContain('<form class="qa" data-q="3">');
  expect(pane).toContain(act({ $: "Drop", q: 3 }));
  const needs = Html.needs_html(v);
  expect(needs).toHaveLength(2);
  expect(needs[0]).toContain('href="#chat"');
  expect(needs[0]).toContain("Ship &lt;now&gt;?");
  expect(needs[1]).toContain("Bad");
  expect(Html.mode_html("chat", "", 1).join("")).toContain('<button class="qs" data-qs title="your questions">? 1</button>');
  expect(Html.mode_html("chat", "", 0).join("")).not.toContain("qs");
  View.view_hear(v, { $: "state", ...v, questions: [] } as any);
  expect(Html.questions_html(v)).toEqual([]);
});

// the orchestrator's notes (notify) in the same pane, after the questions:
// marked as notes, escaped, a dismiss, no answers offered; not in the
// needs-you lane; the header's button counts them apart
test("notes: in the pane after questions, dismissable, never needing you", () => {
  const v = View.view_new();
  const date = "2026-11-12T10:00:00.000Z";
  View.view_hear(v, { $: "state", ...v, questions: [{ id: 5, text: "Chose <b>x</b>", at: 0, date, fyi: true }, { id: 4, text: "Ship?", at: 0, date }] } as any);
  const pane = Html.questions_html(v);
  expect(pane).toHaveLength(2);
  expect(pane[0]).toContain("Ship?");
  expect(pane[1]).toContain('class="q fyi"');
  expect(pane[1]).toContain("Chose &lt;b&gt;x&lt;/b&gt;");
  expect(pane[1]).toContain(act({ $: "Drop", q: 5 }));
  expect(pane[1]).not.toContain("qa");
  expect(Html.needs_html(v).join("")).not.toContain("Chose");
  expect(View.view_questions(v).map((q) => q.id)).toEqual([4]);
  expect(View.view_notes(v).map((q) => q.id)).toEqual([5]);
  expect(Html.mode_html("chat", "", 0, undefined, 0, 2).join("")).toContain('title="your questions and notes">i 2</button>');
  expect(Html.mode_html("chat", "", 1, undefined, 0, 2).join("")).toContain(">? 1 · i 2</button>");
});

// the mode chip; the waiting pane's plan card (approve into auto or full,
// send back with feedback) and waiting calls (allow, refuse), escaped,
// before the questions; the needs-you lane lists them first
test("modes on the web: the chip, the plan card and waiting calls", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, mode: "plan", plan: { text: "1. <read>\n2. fix", date: "2026-11-12T10:00:00.000Z" }, calls: [{ id: 3, who: "Wkr", tool: "shell", what: "rm -rf <x> (on mac)" }] } as any);
  expect(Html.mode_html("chat", "", 0, "plan").join("")).toContain('<button class="perm plan" title="the mode: Shift+Tab in the box cycles it" data-act="' + act({ $: "Mode" }) + '">plan mode</button>');
  const [plan, call] = Html.waiting_html(v);
  expect(plan).toContain('<div class="qt">1. &lt;read&gt;\n2. fix</div>');
  expect(plan).toContain(act({ $: "Verdict", yes: true, mode: "auto" }));
  expect(plan).toContain(act({ $: "Verdict", yes: true, mode: "full" }));
  expect(plan).toContain('<form class="qa" data-verdict>');
  expect(call).toContain("rm -rf &lt;x&gt; (on mac)");
  expect(call).toContain(act({ $: "Consent", n: 3, yes: true }));
  expect(call).toContain(act({ $: "Consent", n: 3, yes: false }));
  const needs = Html.needs_html(v);
  expect(needs[0]).toContain("Plan ready");
  expect(needs[1]).toContain("Wkr wants to run");
  View.view_hear(v, { $: "state", ...v, plan: null, calls: [] } as any);
  expect(Html.waiting_html(v)).toEqual([]);
});

// the cockpit's pages in the header's switch: Home and Inbox (its count:
// review requests for the user, PRs of theirs to fix), the one shown marked
test("the switch has the cockpit's pages: Home, Inbox with its count", () => {
  const html = Html.mode_html("inbox", "", 0, undefined, 3).join("");
  expect(html).toContain('href="#home"');
  expect(html).toContain('href="#inbox" class="here">Inbox <span class="pill need">3</span>');
  expect(Html.mode_html("home", "").join("")).toContain('href="#home" class="here"');
  expect(Html.mode_html("home", "").join("")).not.toContain('class="pill');
});

// security review U3: the account page signs out everywhere, after a
// confirm in place (main.ts posts /api/logout-all on its submit only)
test("account: sign out everywhere, asked first in a hidden confirm", () => {
  const html = Html.account_html({ name: "<i>", bills: false, credits: null }, false);
  expect(html).toContain('<button class="chip out">Sign out</button>');
  expect(html).toContain('<button class="chip outs">Sign out everywhere</button>');
  const ends = html.match(/<form class="kill ends" hidden>.*?<\/form>/)?.[0] ?? "";
  expect(ends).toContain('<button type="button" class="chip keep">Cancel</button>');
  expect(ends).toContain('<button class="chip red">Sign out everywhere</button>');
  expect(html.indexOf('<form class="kill ends"')).toBeGreaterThan(html.indexOf('<form class="kill" hidden>'));
  expect(html).not.toContain("<i>");
});
