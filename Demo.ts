// Demo
// ====
// A demo crew for layout and tests: 8 managers of 5 workers each, in
// every status, a sub-manager, and a Claude Code worker asking to start;
// labelled (a title and repos) but one worker each and the sub-manager.
// The site draws it on its own at /?demo=1#crew (main.ts: nothing goes
// to the server).

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
