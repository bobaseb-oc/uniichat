// Cockpit test
// ============
// `bun test Cockpit.test.ts`. The cockpit's pages as the views work them
// out (Cockpit.ts), before any markup: the inbox's sections, rows, tags,
// filter and what changed since the user looked; the routes to the pages.

import { expect, test } from "bun:test";
import * as Cockpit from "./Cockpit.ts";
import type * as Inbox from "./Inbox.ts";
import * as View from "./View.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const DAY = 86400e3;

function pr(over: Partial<Inbox.Pr> = {}): Inbox.Pr {
  return {
    repo: "o/r", number: 1, title: "A change", url: "https://github.com/o/r/pull/" + (over.number ?? 1), author: "ann", bot: false, updated: new Date(NOW - 3600e3).toISOString(),
    add: 1, del: 0, files: 1, branch: "b", state: "ready", failing: [], body: "", you: true, ...over,
  };
}
function inbox(over: Partial<Inbox.Inbox> = {}): Inbox.Inbox {
  return { at: NOW, login: "me", reviews: [], mine: [], merged: 0, today: 0, tickets: [], clean: [], notes: [], errors: [], ...over };
}
const ids = (s: Cockpit.Section[]) => s.map((x) => x.id + ":" + x.count);

test("the routes: the cockpit's pages by their hash, and back", () => {
  for (const mode of ["home", "inbox", "routines", "digest"] as const) {
    expect(View.view_route("#" + mode)).toEqual({ mode, name: null });
    expect(View.view_hash(mode, null)).toBe("#" + mode);
  }
  expect(View.view_route("#crew/W1")).toEqual({ mode: "crew", name: "W1" });
  expect(View.view_route("#nope")).toEqual({ mode: "chat", name: null });
});

test("the inbox's sections in order, each counted; none read yet: no sections, a word why", () => {
  expect(Cockpit.inbox_sections(null, [], "", NOW)).toEqual([]);
  const all = Cockpit.inbox_sections(inbox({ reviews: [pr()], mine: [pr({ number: 2 }), pr({ number: 3 })] }), [], "", NOW);
  expect(ids(all)).toEqual(["alerts:0", "reviews:1", "mine:2", "tickets:0", "clean:0"]);
});

test("reviews: for you, a team or bots counted; older than 60 days folded apart", () => {
  const s = Cockpit.inbox_sections(inbox({ reviews: [
    pr({ number: 1 }), pr({ number: 2, you: false }), pr({ number: 3, bot: true, you: false }),
    pr({ number: 4, updated: new Date(NOW - 90 * DAY).toISOString() }),
  ] }), [], "", NOW).find((x) => x.id === "reviews")!;
  expect(s.sub).toBe("2 for you · 1 team · 1 bot");
  expect(s.rows.filter((r) => !r.old).map((r) => r.key)).toEqual(["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2", "https://github.com/o/r/pull/3"]);
  expect(s.rows.filter((r) => r.old).length).toBe(1);
  expect(s.count).toBe(4);
});

test("your PRs: each state's tag and tone; failing checks named; a row's age", () => {
  const rows = Cockpit.inbox_sections(inbox({ mine: [
    pr({ number: 1, state: "failing", failing: ["ruff", "unit"] }), pr({ number: 2, state: "blocked" }), pr({ number: 3, state: "ready" }),
    pr({ number: 4, state: "conflicts" }), pr({ number: 5, state: "draft", updated: new Date(NOW - 5 * DAY).toISOString() }),
  ] }), [], "", NOW).find((x) => x.id === "mine")!.rows;
  expect(rows.map((r) => [r.tag, r.tone])).toEqual([
    ["Failing: ruff, unit", "bad"], ["Blocked: needs an approving review", "warn"], ["Ready to merge", "ok"],
    ["Conflicts: resolve them first", "bad"], ["Draft: mark it ready for review", ""],
  ]);
  expect(rows[0]).toMatchObject({ title: "A change", sub: "o/r#1", age: "1h" });
  expect(rows[4].age).toBe("5d");
  const ancient = Cockpit.inbox_sections(inbox({ mine: [pr({ updated: "2020-01-01T00:00:00Z" })] }), [], "", NOW).find((x) => x.id === "mine")!.rows;
  expect(ancient[0].old).toBe(false); // the user's own PRs are never folded apart
});

test("alerts: CI and security notifications, failed agents, my failing PRs; tickets; worktrees to clean up", () => {
  const crew: View.Crew[] = [{ name: "W1", parent: "main", tier: "worker", model: "m", status: "failed", since: NOW, title: "fix AO-1" }];
  const s = Cockpit.inbox_sections(inbox({
    mine: [pr({ state: "failing", failing: ["ruff"] })],
    notes: [{ kind: "ci", title: "CI failed on main", repo: "o/r", url: "https://github.com/o/r", at: "", unread: true }, { kind: "assign", title: "x", repo: "o/r", url: "https://github.com/o/r", at: "", unread: true }],
    tickets: [{ key: "AO-1", title: "Do it", status: "In Progress", priority: "High", updated: "", url: "" }],
    clean: [{ repo: "r", path: "/r/.wt/a", branch: "a", changes: 3, merged: false }, { repo: "r", path: "/r/.wt/b", branch: "b", changes: 0, merged: true }],
  }), crew, "", NOW);
  const of = (id: string) => s.find((x) => x.id === id)!.rows.map((r) => r.title);
  expect(of("alerts")).toEqual(["fix AO-1 failed", "Failing: A change", "CI failed on main"]);
  expect(of("tickets")).toEqual(["AO-1 Do it"]);
  expect(of("clean")).toEqual(["3 uncommitted changes in r a", "worktree of merged r b: nothing left in it"]);
});

test("Jira not read (acli missing or signed out): its section says how, from the device's error", () => {
  const s = Cockpit.inbox_sections(inbox({ tickets: null, errors: ["acli: ✗ Error: unauthorized: use 'acli jira auth login' to authenticate"] }), [], "", NOW);
  expect(s.find((x) => x.id === "tickets")!.note).toBe("acli: ✗ Error: unauthorized: use 'acli jira auth login' to authenticate");
});

test("the filter: rows whose title, repo, ticket or branch hold it, any case; counts follow", () => {
  const s = Cockpit.inbox_sections(inbox({ mine: [pr({ number: 1, title: "AO-7 fix" }), pr({ number: 2, repo: "o/other" }), pr({ number: 3, branch: "feat/zz" })] }), [], "other", NOW);
  expect(s.find((x) => x.id === "mine")!.rows.map((r) => r.sub)).toEqual(["o/other#2"]);
  const t = Cockpit.inbox_sections(inbox({ mine: [pr({ number: 1, title: "AO-7 fix" }), pr({ number: 3, branch: "feat/zz" })] }), [], "ZZ", NOW);
  expect(ids(t)).toEqual(["alerts:0", "reviews:0", "mine:1", "tickets:0", "clean:0"]);
});

test("changed since the user looked: rows new or updated since the stamps kept, and the stamps to keep", () => {
  const first = Cockpit.inbox_sections(inbox({ mine: [pr({ number: 1 }), pr({ number: 2 })] }), [], "", NOW);
  expect(Cockpit.inbox_changed(first, null)).toBe(0); // never looked: nothing called changed
  const seen = Cockpit.inbox_seen(first);
  expect(Cockpit.inbox_changed(first, seen)).toBe(0);
  const later = Cockpit.inbox_sections(inbox({ mine: [pr({ number: 1, updated: new Date(NOW).toISOString() }), pr({ number: 2 }), pr({ number: 9 })] }), [], "", NOW);
  expect(Cockpit.inbox_changed(later, seen)).toBe(2);
});

test("the inbox's count: review requests for the user and their PRs to fix; the demo inbox is a whole one", async () => {
  expect(Cockpit.inbox_badge(null)).toBe(0);
  expect(Cockpit.inbox_badge(inbox({ reviews: [pr(), pr({ number: 2, you: false })], mine: [pr({ number: 3, state: "failing" }), pr({ number: 4, state: "ready" })] }))).toBe(2);
  const Demo = await import("./Demo.ts");
  const Inbox = await import("./Inbox.ts");
  expect(typeof Inbox.inbox_check(Demo.demo_inbox(NOW))).toBe("object");
});

test("the cockpit's acts: Review sends the PRs' links, how, and whether as Claude Code; none picked: nothing; Fetch asks the devices", () => {
  const v = View.view_new();
  expect(View.view_act(v, { $: "Review", prs: ["https://github.com/o/r/pull/1"], how: "fix" })).toEqual([{ $: "review", prs: ["https://github.com/o/r/pull/1"], how: "fix", claude: false }]);
  expect(View.view_act(v, { $: "Review", prs: ["u"], how: "review", claude: true })).toEqual([{ $: "review", prs: ["u"], how: "review", claude: true }]);
  expect(View.view_act(v, { $: "Review", prs: [], how: "review" })).toEqual([]);
  expect(View.view_act(v, { $: "Fetch" })).toEqual([{ $: "fetch" }]);
  View.view_hear(v, { $: "inbox", inbox: null });
  expect(v.inbox).toBe(null);
});

// Home
// ----

const agent = (name: string, status: View.Status, over: Partial<View.Crew> = {}): View.Crew => ({ name, parent: "main", tier: "worker", model: "m", status, since: NOW - 120e3, ...over });

test("home: a greeting by the hour; who needs the user and who works", () => {
  expect(Cockpit.home_greeting(new Date(2026, 10, 12, 9))).toBe("Good morning");
  expect(Cockpit.home_greeting(new Date(2026, 10, 12, 13))).toBe("Good afternoon");
  expect(Cockpit.home_greeting(new Date(2026, 10, 12, 19))).toBe("Good evening");
  const v = View.view_new();
  expect(Cockpit.home_line(v)).toBe("no agent needs you · 0 working");
  v.crew = [agent("A", "working"), agent("B", "failed"), agent("C", "asking", { tier: "claude" }), agent("D", "working", { parent: "A" })];
  v.questions = [{ id: 1, text: "q", at: 0, date: "" }];
  expect(Cockpit.home_line(v)).toBe("3 need you · 2 working");
});

test("home: the stat cards: agents, reviews for you, your PRs to fix, merged this week, agent spend", () => {
  const v = View.view_new();
  v.crew = [agent("A", "working"), agent("B", "done"), agent("C", "done", { parent: "A" })];
  v.inbox = inbox({ reviews: [pr(), pr({ number: 2, you: false })], mine: [pr({ number: 3, state: "failing" }), pr({ number: 4 })], merged: 28, today: 1 });
  v.status = { device: "mac", dir: "x", branch: null, spend: 2.5, stale: false, week: 17.94 };
  expect(Cockpit.home_stats(v).map((s) => [s.label, s.value, s.sub])).toEqual([
    ["Agents", "3", "1 working · 2 done"],
    ["Reviews for you", "1", "1 for your team"],
    ["Your PRs", "2", "1 to fix"],
    ["Merged this week", "28", "1 today"],
    ["Agent spend", "$17.94", "$2.50 today"],
  ]);
  const none = Cockpit.home_stats(View.view_new()).map((s) => s.value);
  expect(none).toEqual(["0", "–", "–", "–", "–"]);
});

test("home: agent cards (Unii's own), working then done; their repo, ticket, PR, estimated cost; Archive all takes the done", () => {
  const v = View.view_new();
  v.crew = [
    agent("A", "working", { title: "review o/r#5 for AO-10852", repos: ["r"], spent: 2.437 }),
    agent("B", "done", { title: "fix the login AO-1201" }),
    agent("C", "failed"),
    agent("D", "working", { parent: "A" }),
  ];
  const { working, done } = Cockpit.home_cards(v, NOW);
  expect(working.map((c) => c.name)).toEqual(["A"]);
  expect(working[0]).toMatchObject({ title: "review o/r#5 for AO-10852", repo: "r", ticket: "AO-10852", pr: "#5", cost: "≈$2.44", age: "2m", under: 1 });
  expect(done.map((c) => [c.name, c.ticket, c.cost])).toEqual([["B", "AO-1201", ""], ["C", null, ""]]);
  expect(View.view_act(v, { $: "Archive", names: ["B", "C"] })).toEqual([{ $: "dismiss", name: "B" }, { $: "dismiss", name: "C" }]);
});

test("home: the apps' lines and the activity, newest first", () => {
  const v = View.view_new();
  expect(Cockpit.home_apps(v)).toEqual({ inbox: "not read yet", questions: "none open", routines: "none scheduled" });
  v.inbox = inbox({ mine: [pr({ state: "failing" })], notes: [
    { kind: "assign", title: "old", repo: "o/r", url: "https://github.com/x", at: "2026-11-10T00:00:00Z", unread: false },
    { kind: "review", title: "new", repo: "o/r", url: "https://github.com/y", at: "2026-11-12T00:00:00Z", unread: true },
  ] });
  v.questions = [{ id: 1, text: "q", at: 0, date: "" }];
  expect(Cockpit.home_apps(v)).toMatchObject({ inbox: "1 PR failing", questions: "1 open" });
  expect(Cockpit.home_activity(v).map((n) => n.title)).toEqual(["new", "old"]);
});

// Sidebar, bar, palette
// ---------------------

test("the sidebar's agents: Unii's own, grouped by their ticket (none last), each with how many under it", () => {
  const v = View.view_new();
  v.crew = [
    agent("A", "working", { title: "review o/r#5 AO-10852" }), agent("B", "done", { title: "AO-10852 docs" }),
    agent("C", "working", { title: "triage" }), agent("D", "working", { parent: "A" }), agent("E", "failed", { title: "AO-1201 fix" }),
  ];
  expect(Cockpit.side_groups(v, NOW).map((g) => [g.ticket, g.agents.map((a) => a.name + (a.under ? "+" + a.under : ""))])).toEqual([
    ["AO-10852", ["A+1", "B"]], ["AO-1201", ["E"]], [null, ["C"]],
  ]);
});

test("the spaces: repos the agents, the worktrees and the device work in, each with its agents and worktrees to clean", () => {
  const v = View.view_new();
  v.crew = [agent("A", "working", { repos: ["web", "api"] }), agent("B", "done", { repos: ["web"] })];
  v.inbox = inbox({ clean: [{ repo: "api", path: "/p", branch: "b", changes: 2, merged: false }, { repo: "ops", path: "/q", branch: "c", changes: 0, merged: true }] });
  v.status = { device: "mac", dir: "legion", branch: "main", spend: null, stale: false };
  expect(Cockpit.side_spaces(v)).toEqual([
    { repo: "web", agents: 2, clean: 0 }, { repo: "api", agents: 1, clean: 1 }, { repo: "ops", agents: 0, clean: 1 }, { repo: "legion", agents: 0, clean: 0 },
  ]);
});

test("the bar: need you, working, ready (waiting for a word), done", () => {
  const v = View.view_new();
  v.crew = [agent("A", "working"), agent("A2", "working"), agent("B", "waiting"), agent("C", "done"), agent("D", "stopped"), agent("E", "failed")];
  expect(Cockpit.bar_text(v)).toBe("1 need you · 2 working · 1 ready · 2 done");
});

test("the palette: pages, commands, agents and inbox PRs; the words typed filter them, all must match, best first", () => {
  const v = View.view_new();
  v.crew = [agent("Mgr", "working", { title: "Fix flaky login" })];
  v.inbox = inbox({ reviews: [pr({ number: 5, title: "Add custodians" })] });
  const all = Cockpit.palette(v, "");
  expect(all.slice(0, 6).map((i) => i.label)).toEqual(["Home", "Inbox", "Chat", "Crew", "Routines", "Digest"]);
  expect(all.some((i) => i.label === "New agent…")).toBe(true);
  expect(all.find((i) => i.label === "Fix flaky login")!.go).toEqual({ href: "#crew/Mgr" });
  expect(all.find((i) => i.label === "Add custodians")!.go).toEqual({ open: "https://github.com/o/r/pull/5" });
  expect(Cockpit.palette(v, "flaky log").map((i) => i.label)).toEqual(["Fix flaky login"]);
  expect(Cockpit.palette(v, "inb")[0].label).toBe("Inbox"); // a label starting so first
  expect(Cockpit.palette(v, "plan mode")[0].go).toEqual({ act: { $: "Mode", mode: "plan" } });
  expect(Cockpit.palette(v, "zzz")).toEqual([]);
  expect(Cockpit.palette(v, "inbox page").map((i) => i.label)).toEqual(["Inbox"]); // every word, not any
  v.crew.push(agent("T", "working", { title: "Inbox triage" }));
  expect(Cockpit.palette(v, "inbox").map((i) => i.label)).toEqual(["Inbox", "Inbox triage", "Refresh the inbox"]); // starting so first
});
