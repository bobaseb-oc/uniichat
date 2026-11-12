// Demo
// ====
// A demo crew for layout and tests: 8 managers of 5 workers each, in
// every status, a sub-manager, and a Claude Code worker asking to start;
// labelled (a title and repos) but one worker each and the sub-manager.
// The site draws it on its own at /?demo=1#crew (main.ts: nothing goes
// to the server); and a demo inbox (/?demo=1#inbox).

import type { Inbox, Pr } from "./Inbox.ts";
import type { Crew, Pulse, Status, Todo } from "./View.ts";

const STATUSES: Status[] = ["working", "working", "done", "failed", "waiting", "working", "stopped"];

// what each manager is on and its repos; its workers' parts
const GOALS: Array<[string, string[]]> = [
  ["Fix flaky login tests", ["auth-api", "web"]],
  ["Ship the export to CSV", ["reports"]],
  ["Upgrade to Bun 1.4", ["legion"]],
  ["Reconcile the Q3 breaks", ["bank-recon"]],
  ["Review rules from merged PRs", ["shared-skills"]],
  ["Docs for the Crew view", ["legion", "docs"]],
  ["Triage the open bugs", ["web"]],
  ["Cut the 2.10 release", ["bank-recon", "infra"]],
];
const PARTS = ["Reproduce it", "Write the failing test", "Fix it", "Review the diff"];
const STEPS = ["Read the failing test", "Find the race", "Fix it", "Run the suite"];

// the crew as of now (ms since 1970): names Mgr0..7, W<m>-<w>, Sub3,
// Claude1
export function demo_crew(now: number): Crew[] {
  const crew: Crew[] = [];
  for (let m = 0; m < 8; m++) {
    const [title, repos] = GOALS[m];
    crew.push({ name: "Mgr" + m, parent: "main", tier: "manager", model: "opus-5.5", status: "waiting", since: now - (m + 1) * 60000, title, repos });
    for (let w = 0; w < 5; w++) {
      const part = w < PARTS.length ? { title: PARTS[w], repos: [repos[w % repos.length]] } : {};
      // the first worker of each manager keeps a checklist, m steps done
      const todo = w === 0 ? { todo: STEPS.map((text, k): Todo => ({ text, status: k < m % STEPS.length ? "done" : k === m % STEPS.length ? "doing" : "pending" })) } : {};
      crew.push({ name: "W" + m + "-" + w, parent: "Mgr" + m, tier: "worker", model: "sonnet-5.5", status: STATUSES[(m + w) % STATUSES.length], since: now - (w + 1) * 9000, ...part, ...todo });
    }
  }
  crew.push({ name: "Sub3", parent: "Mgr3", tier: "manager", model: "opus-5.5", status: "waiting", since: now - 30000 });
  crew.push({ name: "W3-sub", parent: "Sub3", tier: "worker", model: "haiku-5.5", status: "working", since: now - 5000 });
  crew.push({ name: "Claude1", parent: "main", tier: "claude", model: "claude-code", status: "asking", since: now, title: "Refactor the device jobs", repos: ["legion"] });
  return crew;
}

// a pulse for each: at work, a tool call or words; done, a report line
export function demo_pulses(crew: Crew[]): Pulse[] {
  return crew.map((c, k): Pulse => ({
    $: "pulse", name: c.name, status: c.status,
    act: c.status === "working" ? (k % 2 === 0 ? "shell: bun test " + c.name + ".test.ts" : "Reading the failing case in " + c.name) : "",
    last: c.status === "done" ? "Done: 12 tests pass." : c.status === "failed" ? "failed: the build broke" : "",
  }));
}

// a demo inbox (Inbox.ts), every kind of row: review requests (for you,
// a team, a bot, an old one), PRs of yours in each state, tickets, alerts
// and worktrees to clean up
export function demo_inbox(now: number): Inbox {
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const pr = (repo: string, number: number, title: string, state: Pr["state"], h: number, over: Partial<Pr> = {}): Pr => ({
    repo, number, title, url: "https://github.com/" + repo + "/pull/" + number, author: "ann", bot: false, updated: at(h),
    add: 40 + number, del: number % 30, files: 1 + (number % 9), branch: "feat/" + number, state, failing: state === "failing" ? ["ruff", "unit"] : [],
    body: "## Why\nThe " + title.toLowerCase() + ".\n\n## What\n- one change\n- its test", you: true, ...over,
  });
  return {
    at: now, login: "you", merged: 28, today: 1, errors: [],
    reviews: [
      pr("acme/agent-foundations", 766, "AO-10787 Add the 8 new custodians to the playbooks", "pending", 1, { author: "yiqun" }),
      pr("acme/agent-foundations", 760, "AO-10106 Regenerate the position catalogue", "blocked", 120, { author: "bob" }),
      pr("acme/agent-foundations", 757, "AO-10753 Add the reasoning-model profile tables", "ready", 0.3, { author: "yiqun", you: false }),
      pr("acme/infra", 2879, "Bump the transform image to 2.0.1", "ready", 600, { author: "dependabot", bot: true, you: false }),
      pr("acme/web", 120, "Old: the login page copy", "blocked", 24 * 90, { author: "cat" }),
    ],
    mine: [
      pr("acme/modeling", 78, "AO-10668 Remove the lazy config sync", "blocked", 140),
      pr("acme/agent-foundations", 820, "Sonnet for worker subagents, Opus for the chief of staff", "failing", 4),
      pr("acme/modeling", 76, "AO-10136 Carry the root cause keys into attribution", "ready", 280),
      pr("acme/etl", 345, "AO-383 Draft the attribution mapping", "draft", 24 * 60),
      pr("acme/etl", 229, "PIM-4033 Split the loader", "conflicts", 24 * 40),
    ],
    tickets: [
      { key: "AO-10852", title: "Explainer results as the agent payload", status: "In Progress", priority: "High", updated: at(2), url: "" },
      { key: "AO-10874", title: "Determinism configs tie to a root cause", status: "To Do", priority: "Medium", updated: at(30), url: "" },
    ],
    clean: [
      { repo: "agent-foundations", path: "/repos/agent-foundations/.wt/summaries", branch: "ao-10668-two-sentence-summaries", changes: 16, merged: false },
      { repo: "agent-foundations", path: "/repos/agent-foundations/.wt/attribution", branch: "ao-10767-nav-attribution", changes: 0, merged: true },
    ],
    notes: [
      { kind: "ci", title: "CI failed on 1.x", repo: "acme/agent-foundations", url: "https://github.com/acme/agent-foundations/actions", at: at(1), unread: true },
      { kind: "review", title: "Review requested: AO-10787", repo: "acme/agent-foundations", url: "https://github.com/acme/agent-foundations/pull/766", at: at(0.5), unread: true },
      { kind: "assign", title: "Assigned: AO-10914 Inconsistent root cause", repo: "acme/agent-foundations", url: "https://github.com/acme/agent-foundations/issues/914", at: at(1.2), unread: false },
    ],
  };
}
