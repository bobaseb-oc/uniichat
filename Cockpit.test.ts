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
