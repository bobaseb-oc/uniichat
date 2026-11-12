// Inbox
// =====
// The cockpit's inbox (Herdr's): what waits on the user in GitHub, Jira and
// their worktrees. A device reads it with the user's own CLIs, read-only
// (gh, acli, git: Device.device_inbox), so no token passes through Legion;
// these are the pure parts: the GitHub query and its reading, acli's and
// git's output read, and the server's check of a device's report (its
// shape, capped), which is all a view is shown.

// a PR's state, worst first: a draft; conflicts with its base; checks
// failing; checks running; changes asked; a review needed; ready to merge
export const STATES = ["draft", "conflicts", "failing", "pending", "changes", "blocked", "ready"] as const;
export type State = (typeof STATES)[number];

// a PR: where, what, by whom (bot: an app's), last change, its size, its
// branch, its state and failing checks' names, its body (cut), and, for a
// review request, whether it was asked of the user (else of a team)
export type Pr = {
  repo: string; number: number; title: string; url: string; author: string; bot: boolean; updated: string;
  add: number; del: number; files: number; branch: string; state: State; failing: string[]; body: string; you: boolean;
};

// a Jira work item assigned to the user (acli): its key, title, status,
// priority, last change, its page ("" unknown)
export type Ticket = { key: string; title: string; status: string; priority: string; updated: string; url: string };

// a worktree to clean up: uncommitted changes in it, or its branch merged
export type Clean = { repo: string; path: string; branch: string | null; changes: number; merged: boolean };

// a GitHub notification (activity; ci and security ones are alerts)
export const KINDS = ["review", "assign", "mention", "ci", "security", "other"] as const;
export type Note = { kind: (typeof KINDS)[number]; title: string; repo: string; url: string; at: string; unread: boolean };

// a device's report: when (ms), whose (GitHub login), the review requests,
// the user's open PRs, how many merged this week and today, Jira's (null:
// acli missing or signed out), worktrees to clean, notifications, and what
// failed to be read
export type Inbox = {
  at: number; login: string; reviews: Pr[]; mine: Pr[]; merged: number; today: number;
  tickets: Ticket[] | null; clean: Clean[]; notes: Note[]; errors: string[];
};

// the most kept of a list; a field's and a body's most characters
export const MOST = 100;
export const TEXT = 300;
export const BODY = 1200;

// the GitHub query: the user's login, review requests, open PRs (their
// checks, review, mergeability), and counts merged this week and today
export const QUERY = `query($reviews:String!,$mine:String!,$merged:String!,$today:String!){
  viewer{login}
  reviews: search(query:$reviews,type:ISSUE,first:50){ issueCount nodes{ ...pr } }
  mine: search(query:$mine,type:ISSUE,first:50){ issueCount nodes{ ...pr } }
  merged: search(query:$merged,type:ISSUE,first:1){ issueCount }
  today: search(query:$today,type:ISSUE,first:1){ issueCount }
}
fragment pr on PullRequest { number title url isDraft updatedAt additions deletions changedFiles body headRefName
  repository{ nameWithOwner } author{ __typename login } reviewDecision mergeable
  reviewRequests(first:10){ nodes{ requestedReviewer{ __typename ... on User{login} ... on Team{slug} } } }
  commits(last:1){ nodes{ commit{ statusCheckRollup{ state contexts(first:50){ nodes{ __typename ... on CheckRun{ name conclusion status } ... on StatusContext{ context state } } } } } } } }`;

// a local day, YYYY-MM-DD
function day(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// the query's searches, as of now
export function inbox_vars(now: Date): Record<string, string> {
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  return {
    reviews : "is:open is:pr review-requested:@me archived:false",
    mine    : "is:open is:pr author:@me archived:false",
    merged  : "is:pr author:@me is:merged merged:>=" + day(week),
    today   : "is:pr author:@me is:merged merged:>=" + day(now),
  };
}

const FAILED = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];

// a PullRequest node read, for the user `login`
export function inbox_pr(n: any, login: string): Pr {
  const roll = n?.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;
  const checks: any[] = roll?.contexts?.nodes ?? [];
  const failing = checks
    .filter((c) => FAILED.includes(c?.__typename === "StatusContext" ? c.state : c?.conclusion))
    .map((c) => String(c.__typename === "StatusContext" ? c.context : c.name));
  const asked: any[] = (n?.reviewRequests?.nodes ?? []).map((r: any) => r?.requestedReviewer);
  const state: State =
    n?.isDraft ? "draft"
    : n?.mergeable === "CONFLICTING" ? "conflicts"
    : FAILED.includes(roll?.state) ? "failing"
    : roll?.state === "PENDING" || roll?.state === "EXPECTED" ? "pending"
    : n?.reviewDecision === "CHANGES_REQUESTED" ? "changes"
    : n?.reviewDecision === "REVIEW_REQUIRED" ? "blocked"
    : "ready";
  return {
    repo: String(n?.repository?.nameWithOwner ?? ""), number: Number(n?.number), title: String(n?.title ?? ""), url: String(n?.url ?? ""),
    author: String(n?.author?.login ?? ""), bot: n?.author?.__typename === "Bot", updated: String(n?.updatedAt ?? ""),
    add: Number(n?.additions ?? 0), del: Number(n?.deletions ?? 0), files: Number(n?.changedFiles ?? 0), branch: String(n?.headRefName ?? ""),
    state, failing, body: String(n?.body ?? "").slice(0, BODY), you: asked.some((r) => r?.__typename === "User" && r.login === login),
  };
}

// the query's answer read; a GraphQL error kept as error
export function inbox_github(res: any): { login: string; reviews: Pr[]; mine: Pr[]; merged: number; today: number; error?: string } {
  const d = res?.data;
  const login = String(d?.viewer?.login ?? "");
  const prs = (s: any) => ((s?.nodes ?? []) as any[]).filter((n) => Number.isInteger(n?.number)).map((n) => inbox_pr(n, login));
  const out = { login, reviews: prs(d?.reviews), mine: prs(d?.mine), merged: Number(d?.merged?.issueCount ?? 0), today: Number(d?.today?.issueCount ?? 0) };
  const error = res?.errors?.[0]?.message;
  return error === undefined ? out : { ...out, error: String(error) };
}

// acli's work items (`--json`): a list, or Jira's {issues}
export function inbox_tickets(json: any): Ticket[] {
  const list: any[] = Array.isArray(json) ? json : Array.isArray(json?.issues) ? json.issues : [];
  return list.filter((i) => typeof i?.key === "string").map((i) => {
    const site = /^(https:\/\/[^/]+)\/rest\//.exec(String(i.self ?? ""));
    return {
      key: i.key, title: String(i.fields?.summary ?? ""), status: String(i.fields?.status?.name ?? ""),
      priority: String(i.fields?.priority?.name ?? ""), updated: String(i.fields?.updated ?? ""),
      url: site === null ? "" : site[1] + "/browse/" + i.key,
    };
  });
}

// `git worktree list --porcelain`: the worktrees but the main one (the
// first), with their branches (null: detached)
export function inbox_worktrees(text: string): { path: string; branch: string | null }[] {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b !== "");
  return blocks.slice(1).map((b) => {
    const path = /^worktree (.+)$/m.exec(b)?.[1] ?? "";
    const branch = /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] ?? null;
    return { path, branch };
  }).filter((w) => w.path !== "");
}

const REASONS: Record<string, Note["kind"]> = {
  review_requested: "review", assign: "assign", mention: "mention", team_mention: "mention", ci_activity: "ci", security_alert: "security",
};

// GitHub's notifications (`gh api notifications`): a PR's or issue's API
// url turned into its page
export function inbox_notes(json: any): Note[] {
  const list: any[] = Array.isArray(json) ? json : [];
  return list.map((n) => {
    const api = String(n?.subject?.url ?? "");
    const url = api.replace(/^https:\/\/api\.github\.com\/repos\//, "https://github.com/").replace(/\/pulls\/(\d+)$/, "/pull/$1");
    return {
      kind: REASONS[n?.reason] ?? "other", title: String(n?.subject?.title ?? ""), repo: String(n?.repository?.full_name ?? ""),
      url: url.startsWith("https://github.com/") ? url : "https://github.com/notifications", at: String(n?.updated_at ?? ""), unread: n?.unread === true,
    };
  });
}

// Check
// =====
// A device's report is the only way the inbox reaches a view, so the
// server keeps only what's right: each field of its type, links only to
// https pages (no "javascript:"), lists capped, text cut; else refused.

class Bad extends Error {}

function str(x: unknown, most = TEXT): string {
  if (typeof x !== "string") {
    throw new Bad("a text field isn't text");
  }
  return x.slice(0, most);
}
function num(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) {
    throw new Bad("a count isn't a count");
  }
  return x;
}
function bool(x: unknown): boolean {
  if (typeof x !== "boolean") {
    throw new Bad("a flag isn't true or false");
  }
  return x;
}
function link(x: unknown): string {
  const s = str(x, 2 * TEXT);
  if (s !== "" && !/^https:\/\/[^\s"'<>]+$/.test(s)) {
    throw new Bad("a link isn't an https page");
  }
  return s;
}
function list<T>(x: unknown, each: (y: any) => T): T[] {
  if (!Array.isArray(x)) {
    throw new Bad("a list isn't a list");
  }
  return x.slice(0, MOST).map(each);
}
function one<T extends string>(x: unknown, of: readonly T[]): T {
  if (!of.includes(x as T)) {
    throw new Bad("no such kind: " + String(x).slice(0, 40));
  }
  return x as T;
}

function pr(p: any): Pr {
  return {
    repo: str(p?.repo), number: num(p?.number), title: str(p?.title), url: link(p?.url), author: str(p?.author), bot: bool(p?.bot),
    updated: str(p?.updated), add: num(p?.add), del: num(p?.del), files: num(p?.files), branch: str(p?.branch),
    state: one(p?.state, STATES), failing: list(p?.failing, (f) => str(f)), body: str(p?.body, BODY), you: bool(p?.you),
  };
}

// a device's report checked: the inbox kept, or why it's refused
export function inbox_check(x: any): Inbox | string {
  try {
    if (typeof x !== "object" || x === null) {
      throw new Bad("an inbox is an object");
    }
    return {
      at: num(x.at), login: str(x.login), merged: num(x.merged), today: num(x.today),
      reviews: list(x.reviews, pr), mine: list(x.mine, pr),
      tickets: x.tickets === null ? null : list(x.tickets, (t) => ({
        key: str(t?.key, 40), title: str(t?.title), status: str(t?.status, 60), priority: str(t?.priority, 60), updated: str(t?.updated, 60), url: link(t?.url),
      })),
      clean: list(x.clean, (c) => ({ repo: str(c?.repo), path: str(c?.path), branch: c?.branch === null ? null : str(c?.branch), changes: num(c?.changes), merged: bool(c?.merged) })),
      notes: list(x.notes, (n) => ({ kind: one(n?.kind, KINDS), title: str(n?.title), repo: str(n?.repo), url: link(n?.url), at: str(n?.at, 60), unread: bool(n?.unread) })),
      errors: list(x.errors, (e) => str(e)),
    };
  } catch (err) {
    if (err instanceof Bad) {
      return "Not an inbox: " + err.message + ".";
    }
    throw err;
  }
}
