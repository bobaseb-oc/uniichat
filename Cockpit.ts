// Cockpit
// =======
// The cockpit's pages (Herdr's) as the views work them out, before any
// markup (web/src/Pages.ts draws them): the inbox's sections and rows,
// filtered, and what changed since the user looked.

import type { Clean, Inbox, Note, Pr, Ticket } from "./Inbox.ts";
import type { Crew } from "./View.ts";

// a row: its key (a link, a path), its kind, what it says, under it (repo#n,
// a ticket's status), a tag and its tone, its age; what it is
export type Row = {
  key: string; kind: "pr" | "ticket" | "clean" | "note" | "agent"; title: string; sub: string; url: string;
  tag: string; tone: "bad" | "warn" | "ok" | ""; age: string; stamp: string; old?: boolean;
  pr?: Pr; ticket?: Ticket; clean?: Clean; note?: Note; agent?: string;
};

// a section of the inbox: its id, title, rows counted, a line under its
// title, a word in place of rows (Jira not read)
export type SectionId = "alerts" | "reviews" | "mine" | "tickets" | "clean";
export type Section = { id: SectionId; title: string; count: number; sub: string; rows: Row[]; note?: string };

const DAY = 86400e3;
// a review request older than this is folded apart (Herdr's "older than
// 60 days"); the user's own PRs never are
export const OLD = 60 * DAY;

// a span as the inbox says it: 45s, 58m, 5h, 5d
export function age(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d";
}

const TAGS: Record<Pr["state"], [string, Row["tone"]]> = {
  failing   : ["Failing", "bad"],
  blocked   : ["Blocked: needs an approving review", "warn"],
  ready     : ["Ready to merge", "ok"],
  conflicts : ["Conflicts: resolve them first", "bad"],
  draft     : ["Draft: mark it ready for review", ""],
  pending   : ["Checks running", ""],
  changes   : ["Changes requested", "warn"],
};

function since(at: string, now: number): string {
  const t = Date.parse(at);
  return Number.isNaN(t) ? "" : age(now - t);
}

function pr_row(p: Pr, now: number): Row {
  const [tag, tone] = TAGS[p.state];
  const failing = p.state === "failing" && p.failing.length > 0 ? tag + ": " + p.failing.join(", ") : tag;
  const t = Date.parse(p.updated);
  return {
    key: p.url, kind: "pr", title: p.title, sub: p.repo + "#" + p.number, url: p.url, tag: failing, tone,
    age: since(p.updated, now), stamp: p.updated, old: !Number.isNaN(t) && now - t > OLD, pr: p,
  };
}

function plural(n: number, one: string, many = one + "s"): string {
  return n + " " + (n === 1 ? one : many);
}

// whether a row holds the filter (any case): its title, under it, its
// branch, its ticket's key
function holds(r: Row, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (f === "") {
    return true;
  }
  return [r.title, r.sub, r.pr?.branch ?? "", r.pr?.author ?? "", r.ticket?.key ?? "", r.clean?.branch ?? "", r.tag].some((x) => x.toLowerCase().includes(f));
}

// the inbox's sections, in Herdr's order; none read yet: none
export function inbox_sections(inbox: Inbox | null, crew: Crew[], filter: string, now: number): Section[] {
  if (inbox === null) {
    return [];
  }
  const failed = crew.filter((c) => c.status === "failed").map((c): Row => ({
    key: "agent:" + c.name, kind: "agent", title: (c.title ?? c.name) + " failed", sub: c.name, url: "", tag: "Agent failed", tone: "bad",
    age: age(now - c.since), stamp: String(c.since), agent: c.name,
  }));
  const red = inbox.mine.filter((p) => p.state === "failing").map((p): Row => ({ ...pr_row(p, now), key: "alert:" + p.url, title: "Failing: " + p.title }));
  const notes = inbox.notes.filter((n) => n.kind === "ci" || n.kind === "security").map((n): Row => ({
    key: "note:" + n.url + n.at, kind: "note", title: n.title, sub: n.repo, url: n.url, tag: n.kind === "ci" ? "CI" : "Security", tone: "bad",
    age: since(n.at, now), stamp: n.at, note: n,
  }));
  const reviews = inbox.reviews.map((p) => pr_row(p, now));
  const you = inbox.reviews.filter((p) => p.you).length;
  const bots = inbox.reviews.filter((p) => p.bot).length;
  const tickets = (inbox.tickets ?? []).map((t): Row => ({
    key: "ticket:" + t.key, kind: "ticket", title: t.key + " " + t.title, sub: t.status + (t.priority ? " · " + t.priority : ""), url: t.url,
    tag: t.status, tone: "", age: since(t.updated, now), stamp: t.updated, ticket: t,
  }));
  const clean = inbox.clean.map((c): Row => {
    const where = c.repo + " " + (c.branch ?? "(detached)");
    const title = c.changes > 0 ? plural(c.changes, "uncommitted change") + " in " + (c.merged ? "merged " : "") + where : "worktree of merged " + where + ": nothing left in it";
    return { key: "clean:" + c.path, kind: "clean", title, sub: c.path, url: "", tag: c.merged ? "Merged" : "Uncommitted", tone: c.changes > 0 ? "warn" : "", age: "", stamp: String(c.changes), clean: c };
  });
  const section = (id: SectionId, title: string, rows: Row[], sub = "", note?: string): Section => {
    const kept = rows.filter((r) => holds(r, filter));
    return note === undefined ? { id, title, count: kept.length, sub, rows: kept } : { id, title, count: kept.length, sub, rows: kept, note };
  };
  const jira = inbox.tickets === null ? inbox.errors.find((e) => e.startsWith("acli")) ?? "Jira isn't read on this device (acli)." : undefined;
  return [
    section("alerts", "Alerts", [...failed, ...red, ...notes]),
    section("reviews", "Reviews", reviews, you + " for you · " + (inbox.reviews.length - you - bots) + " team · " + plural(bots, "bot")),
    section("mine", "Your PRs", inbox.mine.map((p) => ({ ...pr_row(p, now), old: false }))),
    section("tickets", "Tickets", tickets, "", jira),
    section("clean", "To clean up", clean),
  ];
}

// the stamps a look leaves: each row's key, its last change
export function inbox_seen(sections: Section[]): Record<string, string> {
  return Object.fromEntries(sections.flatMap((s) => s.rows).map((r) => [r.key, r.stamp]));
}

// the rows new or changed since the stamps (none kept: the first look,
// nothing called changed)
export function inbox_changed(sections: Section[], seen: Record<string, string> | null): number {
  if (seen === null) {
    return 0;
  }
  return sections.flatMap((s) => s.rows).filter((r) => seen[r.key] !== r.stamp).length;
}

// the inbox's count (its link's badge): review requests for the user, and
// their PRs that fail, conflict or had changes asked
export function inbox_badge(inbox: Inbox | null): number {
  if (inbox === null) {
    return 0;
  }
  return inbox.reviews.filter((p) => p.you).length + inbox.mine.filter((p) => ["failing", "conflicts", "changes"].includes(p.state)).length;
}
