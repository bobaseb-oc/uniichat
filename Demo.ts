// Demo
// ====
// A demo crew for layout and tests: 8 managers of 5 workers each, in
// every status, a sub-manager, and a Claude Code worker asking to start.
// The site draws it on its own at /?demo=1#crew (main.ts: nothing goes
// to the server).

import type { Crew, Pulse, Status } from "./View.ts";

const STATUSES: Status[] = ["working", "working", "done", "failed", "waiting", "working", "stopped"];

// the crew as of now (ms since 1970): names Mgr0..7, W<m>-<w>, Sub3,
// Claude1
export function demo_crew(now: number): Crew[] {
  const crew: Crew[] = [];
  for (let m = 0; m < 8; m++) {
    crew.push({ name: "Mgr" + m, parent: "main", tier: "manager", model: "opus-5.5", status: "waiting", since: now - (m + 1) * 60000 });
    for (let w = 0; w < 5; w++) {
      crew.push({ name: "W" + m + "-" + w, parent: "Mgr" + m, tier: "worker", model: "sonnet-5.5", status: STATUSES[(m + w) % STATUSES.length], since: now - (w + 1) * 9000 });
    }
  }
  crew.push({ name: "Sub3", parent: "Mgr3", tier: "manager", model: "opus-5.5", status: "waiting", since: now - 30000 });
  crew.push({ name: "W3-sub", parent: "Sub3", tier: "worker", model: "haiku-5.5", status: "working", since: now - 5000 });
  crew.push({ name: "Claude1", parent: "main", tier: "claude", model: "claude-code", status: "asking", since: now });
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
