// Cockpit
// =======
// The cockpit's pages (Herdr's) as the views work them out, before any
// markup (web/src/Pages.ts draws them): the inbox's sections and rows,
// filtered, and what changed since the user looked.

import type { Clean, DigestPr, Inbox, Note, Pr, Ticket } from "./Inbox.ts";
import { view_needs, view_questions, type Act, type Crew, type View } from "./View.ts";

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
  return inbox.reviews.filter((p) => p.you).length + inbox.mine.filter((p) => FIX.includes(p.state)).length;
}

// Home
// ====
// Herdr's digest: a greeting, who needs the user, the stat cards, Unii's
// own agents as cards (working, then done), the apps' lines, the
// activity. An agent's cost is an estimate at list price (Tools.spent).

// the greeting by the local hour
export function home_greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// what needs the user: agents asking or failed, open questions, calls
// waiting, a plan to approve
function needing(v: View): number {
  return view_needs(v).length + view_questions(v).length + (v.calls ?? []).length + (v.plan ? 1 : 0);
}

// "3 need you · 2 working"
export function home_line(v: View): string {
  const need = needing(v);
  const working = v.crew.filter((c) => c.status === "working").length;
  return (need === 0 ? "no agent needs you" : need + " need you") + " · " + working + " working";
}

// a stat card: what, its number, under it, where a click goes
export type Stat = { label: string; value: string; sub: string; href: string };

const usd = (x: number) => "$" + x.toFixed(2);

export function home_stats(v: View): Stat[] {
  const crew = v.crew;
  const inbox = v.inbox;
  const working = crew.filter((c) => c.status === "working" || c.status === "waiting" || c.status === "asking").length;
  const you = inbox?.reviews.filter((p) => p.you).length ?? 0;
  const fix = inbox?.mine.filter((p) => FIX.includes(p.state)).length ?? 0;
  const week = v.status?.week ?? null;
  const today = v.status?.spend ?? null;
  return [
    { label: "Agents", value: String(crew.length), sub: working + " working · " + (crew.length - working) + " done", href: "#crew" },
    { label: "Reviews for you", value: inbox === null ? "–" : String(you), sub: inbox === null ? "" : inbox.reviews.length - you + " for your team", href: "#inbox" },
    { label: "Your PRs", value: inbox === null ? "–" : String(inbox.mine.length), sub: inbox === null ? "" : fix + " to fix", href: "#inbox" },
    { label: "Merged this week", value: inbox === null ? "–" : String(inbox.merged), sub: inbox === null ? "" : inbox.today + " today", href: "#digest" },
    { label: "Agent spend", value: week === null ? "–" : usd(week), sub: today === null ? "" : usd(today) + " today", href: "#home" },
  ];
}

// a PR's states that ask for a fix
export const FIX = ["failing", "conflicts", "changes"];

// a ticket key in a text (AO-10852), or none
export function ticket_of(text: string): string | null {
  return /\b[A-Z][A-Z0-9]{1,9}-\d+\b/.exec(text)?.[0] ?? null;
}

// an agent's card: its name, title, first repo, ticket, PR, estimated
// cost, age, status, how many agents under it
export type Card = { name: string; title: string; repo: string | null; ticket: string | null; pr: string | null; cost: string; age: string; status: Crew["status"]; under: number };

// Unii's own agents (the crew's top), working (or waiting, asking) first,
// then done (done, stopped, failed)
export function home_cards(v: View, now: number): { working: Card[]; done: Card[] } {
  const top = v.crew.filter((c) => c.parent === "main");
  const under = (name: string): number => v.crew.filter((c) => c.parent === name).reduce((n, c) => n + 1 + under(c.name), 0);
  const card = (c: Crew): Card => {
    const title = c.title ?? c.name;
    return {
      name: c.name, title, repo: c.repos?.[0] ?? null, ticket: ticket_of(title), pr: /#(\d+)\b/.exec(title)?.[0] ?? null,
      cost: c.spent === undefined ? "" : "≈" + usd(c.spent), age: c.since === 0 ? "" : age(now - c.since), status: c.status, under: under(c.name),
    };
  };
  const live = (c: Crew) => c.status === "working" || c.status === "waiting" || c.status === "asking";
  return { working: top.filter(live).map(card), done: top.filter((c) => !live(c)).map(card) };
}

// the apps' lines: the inbox's (PRs failing), the questions', the routines'
export function home_apps(v: View): { inbox: string; questions: string; routines: string } {
  const routines = (v.routines ?? []).filter((r) => r.on).length;
  const failing = v.inbox?.mine.filter((p) => p.state === "failing").length ?? 0;
  const open = view_questions(v).length;
  return {
    inbox: v.inbox === null ? "not read yet" : failing === 0 ? "nothing failing" : failing + " PR" + (failing === 1 ? "" : "s") + " failing",
    questions: open === 0 ? "none open" : open + " open",
    routines: routines === 0 ? "none scheduled" : routines + " scheduled",
  };
}

// the inbox's notifications, newest first, the 12 last
export function home_activity(v: View): Note[] {
  return [...(v.inbox?.notes ?? [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
}

// Sidebar, bar, palette
// =====================

// a group of the sidebar's agents: their ticket (null: none), them
export type SideAgent = { name: string; title: string; status: Crew["status"]; age: string; under: number };
export type SideGroup = { ticket: string | null; agents: SideAgent[] };

// Unii's own agents by the ticket in their title, in the order first
// seen; those with none last
export function side_groups(v: View, now: number): SideGroup[] {
  const { working, done } = home_cards(v, now);
  const groups = new Map<string | null, SideAgent[]>();
  for (const c of [...working, ...done].sort((a, b) => v.crew.findIndex((x) => x.name === a.name) - v.crew.findIndex((x) => x.name === b.name))) {
    const list = groups.get(c.ticket) ?? [];
    list.push({ name: c.name, title: c.title, status: c.status, age: c.age, under: c.under });
    groups.set(c.ticket, list);
  }
  const all = [...groups.entries()].map(([ticket, agents]) => ({ ticket, agents }));
  return [...all.filter((g) => g.ticket !== null), ...all.filter((g) => g.ticket === null)];
}

// a space: a repo, the agents on it, its worktrees to clean up
export type Space = { repo: string; agents: number; clean: number };

// the repos the crew, the inbox's worktrees and the device work in
export function side_spaces(v: View): Space[] {
  const repos: string[] = [];
  const add = (r: string) => r !== "" && !repos.includes(r) && repos.push(r);
  v.crew.forEach((c) => (c.repos ?? []).forEach(add));
  (v.inbox?.clean ?? []).forEach((c) => add(c.repo));
  (v.inbox?.spaces ?? []).forEach(add);
  if (v.status) {
    add(v.status.dir);
  }
  return repos.map((repo) => ({
    repo, agents: v.crew.filter((c) => (c.repos ?? []).includes(repo)).length, clean: (v.inbox?.clean ?? []).filter((c) => c.repo === repo).length,
  }));
}

// the bottom bar: "1 need you · 1 working · 1 ready · 2 done" (ready:
// waiting for a word)
export function bar_text(v: View): string {
  const n = (...s: Crew["status"][]) => v.crew.filter((c) => s.includes(c.status)).length;
  return needing(v) + " need you · " + n("working") + " working · " + n("waiting") + " ready · " + n("done", "stopped") + " done";
}

// a palette item: what it says, a hint, what choosing it does (a link, a
// page opened, an act)
export type Go = { href: string } | { open: string } | { act: Act } | { cmd: "new-agent" | "focus" } | { space: string };
export type Item = { label: string; hint: string; go: Go };

const PAGE_ITEMS: Item[] = [
  { label: "Home", hint: "page · g h", go: { href: "#home" } },
  { label: "Inbox", hint: "page · g i", go: { href: "#inbox" } },
  { label: "Chat", hint: "page · g m", go: { href: "#chat" } },
  { label: "Crew", hint: "page · g c", go: { href: "#crew" } },
  { label: "Routines", hint: "page · g r", go: { href: "#routines" } },
  { label: "Digest", hint: "page · g d", go: { href: "#digest" } },
  { label: "New agent…", hint: "command · /agent", go: { cmd: "new-agent" } },
  { label: "Refresh the inbox", hint: "command", go: { act: { $: "Fetch" } } },
  { label: "Focus", hint: "command · hide the side columns", go: { cmd: "focus" } },
  { label: "Plan mode", hint: "command · only reading till a plan is approved", go: { act: { $: "Mode", mode: "plan" } } },
  { label: "Auto mode", hint: "command · a reviewer checks each change", go: { act: { $: "Mode", mode: "auto" } } },
  { label: "Full mode", hint: "command · hooks only", go: { act: { $: "Mode", mode: "full" } } },
];

// what the palette offers for the words typed: each word must be in the
// label or the hint (any case); labels that start with the first word first
export function palette(v: View, q: string): Item[] {
  const agents = v.crew.map((c): Item => ({ label: c.title ?? c.name, hint: "agent " + c.name + " · " + c.status, go: { href: "#crew/" + encodeURIComponent(c.name) } }));
  const prs = [...(v.inbox?.reviews ?? []), ...(v.inbox?.mine ?? [])].map((p): Item => ({ label: p.title, hint: p.repo + "#" + p.number + " · " + p.state, go: { open: p.url } }));
  const spaces = side_spaces(v).map((s): Item => ({ label: s.repo, hint: "space · a repo", go: { space: s.repo } }));
  const all = [...PAGE_ITEMS, ...agents, ...prs, ...spaces];
  const words = q.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) {
    return all;
  }
  const hits = all.filter((i) => words.every((w) => (i.label + " " + i.hint).toLowerCase().includes(w)));
  const starts = (i: Item) => i.label.toLowerCase().startsWith(words[0]);
  return [...hits.filter(starts), ...hits.filter((i) => !starts(i))];
}

// Digest
// ======

// PRs by author, the most first (then by name)
export function digest_groups(prs: DigestPr[]): { author: string; prs: DigestPr[] }[] {
  const by = new Map<string, DigestPr[]>();
  prs.forEach((p) => by.set(p.author, [...(by.get(p.author) ?? []), p]));
  return [...by.entries()].map(([author, list]) => ({ author, prs: list })).sort((a, b) => b.prs.length - a.prs.length || a.author.localeCompare(b.author));
}
