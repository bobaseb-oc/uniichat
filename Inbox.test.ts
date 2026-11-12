// Inbox test
// ==========
// `bun test Inbox.test.ts`. The cockpit's inbox as a device reads it with
// the user's own CLIs (gh, acli, git): PRs' states from their checks,
// review and mergeability; review requests of the user or a team; Jira
// rows; worktrees to clean up; GitHub notifications as activity and
// alerts; and the server's check of a device's report (shape, caps).

import { expect, test } from "bun:test";
import * as Inbox from "./Inbox.ts";

// a PullRequest node as the GraphQL query gives it (Inbox.QUERY)
function node(over: Record<string, any> = {}): any {
  return {
    number: 7, title: "AO-1: a change", url: "https://github.com/o/r/pull/7", isDraft: false,
    updatedAt: "2026-11-12T10:00:00Z", additions: 3, deletions: 1, changedFiles: 2, body: "Why it", headRefName: "feat/a",
    repository: { nameWithOwner: "o/r" }, author: { __typename: "User", login: "ann" },
    reviewDecision: "APPROVED", mergeable: "MERGEABLE", reviewRequests: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [] } } } }] },
    ...over,
  };
}
const rollup = (state: string, nodes: any[] = []) => ({ nodes: [{ commit: { statusCheckRollup: { state, contexts: { nodes } } } }] });

test("a PR's state: draft, conflicts, failing (its checks named), pending, changes asked, blocked, ready", () => {
  const st = (over: Record<string, any>) => Inbox.inbox_pr(node(over), "me").state;
  expect(st({ isDraft: true, mergeable: "CONFLICTING" })).toBe("draft");
  expect(st({ mergeable: "CONFLICTING", commits: rollup("FAILURE") })).toBe("conflicts");
  expect(st({ commits: rollup("FAILURE"), reviewDecision: "REVIEW_REQUIRED" })).toBe("failing");
  expect(st({ commits: rollup("PENDING") })).toBe("pending");
  expect(st({ reviewDecision: "CHANGES_REQUESTED" })).toBe("changes");
  expect(st({ reviewDecision: "REVIEW_REQUIRED" })).toBe("blocked");
  expect(st({})).toBe("ready");
  expect(st({ commits: { nodes: [] }, reviewDecision: null })).toBe("ready");
  const failing = Inbox.inbox_pr(node({ commits: rollup("FAILURE", [
    { __typename: "CheckRun", name: "ruff", conclusion: "FAILURE", status: "COMPLETED" },
    { __typename: "CheckRun", name: "unit", conclusion: "SUCCESS", status: "COMPLETED" },
    { __typename: "StatusContext", context: "ci/mypy", state: "ERROR" },
  ]) }), "me");
  expect(failing.failing).toEqual(["ruff", "ci/mypy"]);
});

test("a PR's fields: repo, author (a bot marked), sizes, a review asked of the user or of a team, the body cut", () => {
  const you = Inbox.inbox_pr(node({ reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me" } }] } }), "me");
  expect(you).toMatchObject({ repo: "o/r", number: 7, title: "AO-1: a change", author: "ann", bot: false, add: 3, del: 1, files: 2, branch: "feat/a", you: true });
  const team = Inbox.inbox_pr(node({ author: { __typename: "Bot", login: "dependabot" }, reviewRequests: { nodes: [{ requestedReviewer: { __typename: "Team", slug: "core" } }] } }), "me");
  expect(team).toMatchObject({ bot: true, you: false });
  const other = Inbox.inbox_pr(node({ reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "bob" } }] } }), "me");
  expect(other.you).toBe(false);
  const long = Inbox.inbox_pr(node({ body: "x".repeat(5000) }), "me");
  expect(long.body.length).toBe(Inbox.BODY);
  expect(Inbox.inbox_pr(node({ body: null }), "me").body).toBe("");
});

test("the GraphQL answer read whole: login, reviews, mine, merged this week and today; errors kept", () => {
  const data = { data: { viewer: { login: "me" }, reviews: { issueCount: 1, nodes: [node()] }, mine: { issueCount: 2, nodes: [node({ number: 8 }), {}] }, merged: { issueCount: 42 }, today: { issueCount: 5 } } };
  const got = Inbox.inbox_github(data);
  expect(got.login).toBe("me");
  expect(got.reviews.map((p) => p.number)).toEqual([7]);
  expect(got.mine.map((p) => p.number)).toEqual([8]); // a node with no number (not a PR) left out
  expect([got.merged, got.today]).toEqual([42, 5]);
  expect(Inbox.inbox_github({ errors: [{ message: "bad" }] })).toMatchObject({ reviews: [], mine: [], error: "bad" });
});

test("the search variables: open reviews and PRs, merged since a week ago and today (local days)", () => {
  const vars = Inbox.inbox_vars(new Date(2026, 10, 12, 15, 0));
  expect(vars.reviews).toBe("is:open is:pr review-requested:@me archived:false");
  expect(vars.mine).toBe("is:open is:pr author:@me archived:false");
  expect(vars.merged).toBe("is:pr author:@me is:merged merged:>=2026-11-05");
  expect(vars.today).toBe("is:pr author:@me is:merged merged:>=2026-11-12");
});

test("Jira rows from acli's JSON, an array or {issues}; anything else none", () => {
  const issue = { key: "AO-1", fields: { summary: "Do it", status: { name: "In Progress" }, priority: { name: "High" }, updated: "2026-11-12T10:00:00.000+0000" } };
  const row = { key: "AO-1", title: "Do it", status: "In Progress", priority: "High", updated: "2026-11-12T10:00:00.000+0000", url: "" };
  const linked = { ...issue, self: "https://x.atlassian.net/rest/api/3/issue/10" };
  expect(Inbox.inbox_tickets([linked])[0].url).toBe("https://x.atlassian.net/browse/AO-1");
  expect(Inbox.inbox_tickets([issue])).toEqual([row]);
  expect(Inbox.inbox_tickets({ issues: [issue, { nokey: 1 }] })).toEqual([row]);
  expect(Inbox.inbox_tickets("nope")).toEqual([]);
});

test("worktrees from `git worktree list --porcelain`: the main one left out, a detached one has no branch", () => {
  const text = "worktree /r\nHEAD aa\nbranch refs/heads/main\n\nworktree /r/.wt/a\nHEAD bb\nbranch refs/heads/feat/a\n\nworktree /r/.wt/b\nHEAD cc\ndetached\n";
  expect(Inbox.inbox_worktrees(text)).toEqual([{ path: "/r/.wt/a", branch: "feat/a" }, { path: "/r/.wt/b", branch: null }]);
  expect(Inbox.inbox_worktrees("")).toEqual([]);
});

test("GitHub notifications: kinds by reason, the PR's number from its API url", () => {
  const n = (reason: string, type = "PullRequest") => ({ reason, unread: true, updated_at: "2026-11-12T10:00:00Z", repository: { full_name: "o/r" }, subject: { title: "T", type, url: "https://api.github.com/repos/o/r/pulls/12" } });
  const got = Inbox.inbox_notes([n("review_requested"), n("assign"), n("mention"), n("ci_activity", "CheckSuite"), n("security_alert"), n("subscribed")]);
  expect(got.map((x) => x.kind)).toEqual(["review", "assign", "mention", "ci", "security", "other"]);
  expect(got[0]).toEqual({ kind: "review", title: "T", repo: "o/r", url: "https://github.com/o/r/pull/12", at: "2026-11-12T10:00:00Z", unread: true });
  expect(Inbox.inbox_notes({})).toEqual([]);
});

// a device's report, checked by the server: what it keeps
function report(over: Record<string, any> = {}): any {
  return {
    at: 1, login: "me", merged: 1, today: 0, errors: [],
    reviews: [Inbox.inbox_pr(node(), "me")], mine: [], tickets: null,
    clean: [{ repo: "r", path: "/r/.wt/a", branch: "feat/a", changes: 3, merged: false }],
    notes: [], ...over,
  };
}

test("the server's check: a whole report kept; lists capped; long text cut; bad shapes refused", () => {
  const ok = Inbox.inbox_check(report());
  expect(typeof ok).toBe("object");
  expect((ok as Inbox.Inbox).reviews[0].number).toBe(7);
  const many = Inbox.inbox_check(report({ mine: Array.from({ length: 500 }, () => Inbox.inbox_pr(node(), "me")) })) as Inbox.Inbox;
  expect(many.mine.length).toBe(Inbox.MOST);
  const cut = Inbox.inbox_check(report({ reviews: [{ ...Inbox.inbox_pr(node(), "me"), title: "t".repeat(9000) }] })) as Inbox.Inbox;
  expect(cut.reviews[0].title.length).toBe(Inbox.TEXT);
  expect(Inbox.inbox_check(report({ reviews: [{ ...Inbox.inbox_pr(node(), "me"), state: "odd" }] }))).toBeString();
  expect(Inbox.inbox_check(report({ reviews: [{ ...Inbox.inbox_pr(node(), "me"), url: "javascript:alert(1)" }] }))).toBeString();
  expect(Inbox.inbox_check(report({ merged: "many" }))).toBeString();
  expect(Inbox.inbox_check(report({ clean: [{ repo: "r", path: "/p", branch: null, changes: -1, merged: false }] }))).toBeString();
  expect(Inbox.inbox_check(null)).toBeString();
  // a field the report doesn't have isn't kept
  expect("extra" in (Inbox.inbox_check(report({ extra: 1 })) as any)).toBe(false);
});

// the team digest (Herdr's "last 7 days"): the spaces' GitHub repos from
// their remotes; one search for merged PRs since a week ago, one for open;
// read, and checked with the rest of the report (none: null)
test("the digest: repos from remotes, the searches, PRs read, checked with the report", () => {
  expect(Inbox.inbox_repo("git@github.com:OnCorps/agent-foundations.git\n")).toBe("OnCorps/agent-foundations");
  expect(Inbox.inbox_repo("https://github.com/o/r")).toBe("o/r");
  expect(Inbox.inbox_repo("https://gitlab.com/o/r.git")).toBe(null);
  const vars = Inbox.digest_vars(["o/a", "o/b"], new Date(2026, 10, 12));
  expect(vars).toEqual({ merged: "repo:o/a repo:o/b is:pr is:merged merged:>=2026-11-05", open: "repo:o/a repo:o/b is:pr is:open" });
  const n = (k: number, at: string | null) => ({ number: k, title: "T" + k, url: "https://github.com/o/a/pull/" + k, repository: { nameWithOwner: "o/a" }, author: { login: "ann" }, mergedAt: at, createdAt: "2026-11-01T00:00:00Z", isDraft: false });
  const d = Inbox.inbox_digest({ data: { merged: { nodes: [n(1, "2026-11-10T00:00:00Z"), {}] }, open: { nodes: [n(2, null)] } } }, ["o/a"]);
  expect(d).toEqual({ repos: ["o/a"], merged: [{ repo: "o/a", number: 1, title: "T1", url: "https://github.com/o/a/pull/1", author: "ann", at: "2026-11-10T00:00:00Z" }], open: [{ repo: "o/a", number: 2, title: "T2", url: "https://github.com/o/a/pull/2", author: "ann", at: "2026-11-01T00:00:00Z" }] });
  const base = { at: 1, login: "me", reviews: [], mine: [], merged: 0, today: 0, tickets: null, clean: [], notes: [], errors: [] };
  expect((Inbox.inbox_check(base) as Inbox.Inbox).digest).toBe(null);
  expect((Inbox.inbox_check({ ...base, digest: d }) as Inbox.Inbox).digest).toEqual(d);
  expect(typeof Inbox.inbox_check({ ...base, digest: { ...d, merged: [{ ...d.merged[0], url: "javascript:x" }] } })).toBe("string");
});

// GitHub's search takes 256 characters a query: the digest's repos split
// into searches that fit, 5 at most (the first repos: the newest)
test("the digest's searches fit GitHub's query length, 5 at most", () => {
  const repos = Array.from({ length: 80 }, (_, k) => "OnCorps/some-long-repository-name-" + k);
  const chunks = Inbox.digest_chunks(repos, new Date(2026, 10, 12));
  expect(chunks.length).toBe(5);
  for (const c of chunks) {
    expect(c.merged.length).toBeLessThanOrEqual(256);
    expect(c.open.length).toBeLessThanOrEqual(256);
  }
  expect(chunks[0].merged.startsWith("repo:OnCorps/some-long-repository-name-0 ")).toBe(true);
  expect(Inbox.digest_chunks(["o/a", "o/b"], new Date(2026, 10, 12))).toEqual([Inbox.digest_vars(["o/a", "o/b"], new Date(2026, 10, 12))]);
});

test("Google's part of the report checked: Meet and Docs links only, Drive ids only; none: null", () => {
  const base = { at: 1, login: "me", reviews: [], mine: [], merged: 0, today: 0, tickets: null, clean: [], notes: [], errors: [] };
  const google = { events: [{ id: "e1", title: "Weekly", start: "s", end: "e", meet: "https://meet.google.com/abc", people: 3 }], docs: [{ id: "doc_123", title: "T", at: "", url: "https://docs.google.com/document/d/doc_123" }] };
  expect((Inbox.inbox_check(base) as Inbox.Inbox).google).toBe(null);
  expect((Inbox.inbox_check({ ...base, google }) as Inbox.Inbox).google).toEqual(google);
  expect(typeof Inbox.inbox_check({ ...base, google: { ...google, events: [{ ...google.events[0], meet: "https://evil.example/x" }] } })).toBe("string");
  expect(typeof Inbox.inbox_check({ ...base, google: { ...google, docs: [{ ...google.docs[0], id: "../x" }] } })).toBe("string");
  expect(typeof Inbox.inbox_check({ ...base, google: { ...google, docs: [{ ...google.docs[0], url: "https://evil.example/doc" }] } })).toBe("string");
});
