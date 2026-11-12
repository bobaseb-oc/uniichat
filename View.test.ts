// View test
// =========
// `bun test View.test.ts`. What a view draws of the server's messages.

import { expect, test } from "bun:test";
import * as View from "./View.ts";

const tail = (v: View.View) => View.view_tail(v).map((row) => (row.$ === "Cap" ? row.text : row.$));

// a turn waiting on its model names the model the server says: the
// wait holds it, so no pick (none yet) can name none
test("a turn's wait names its model", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, wait: "claude-opus-5-5", pick: null });
  expect(tail(v)).toEqual(["waiting for claude-opus-5-5…"]);
  View.view_hear(v, { $: "state", ...v, wait: View.SUMMARIES });
  expect(tail(v)).toEqual(["compressing earlier messages…"]);
  View.view_hear(v, { $: "state", ...v, wait: "" });
  expect(tail(v)).toEqual([]);
});

// summaries that don't come say why: the compactor's last words, on one line
test("a wait on summaries names the compactor's trouble", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, wait: View.SUMMARIES, trouble: "HTTP 429: Budget has been exceeded!" });
  expect(tail(v)).toEqual(["compressing earlier messages… (compactor: HTTP 429: Budget has been exceeded!)"]);
  View.view_hear(v, { $: "state", ...v, wait: View.SUMMARIES, trouble: null });
  expect(tail(v)).toEqual(["compressing earlier messages…"]);
  View.view_hear(v, { $: "state", ...v, wait: "claude-opus-5-5", trouble: "HTTP 502" });
  expect(tail(v)).toEqual(["waiting for claude-opus-5-5…"]);
});

// /agent starts an agent on the task (both clients share view_act); with
// no task it says how, and sends nothing
test("/agent <task> asks to spawn an agent; no task, a note", () => {
  const v = View.view_new();
  expect(View.view_act(v, { $: "Send", text: "/agent  fix x " })).toEqual([{ $: "spawn", task: "fix x" }]);
  expect(View.view_act(v, { $: "Send", text: "/agent" })).toEqual([]);
  expect(v.notes.at(-1)).toBe("/agent needs a task: /agent <task>.");
});

test("!command asks to run it on a device, from the chat or an agent's page; a bare ! is a note", () => {
  const v = View.view_new();
  expect(View.view_act(v, { $: "Send", text: "  !git status -s " })).toEqual([{ $: "bang", command: "git status -s" }]);
  expect(View.view_act(v, { $: "Send", text: "!" })).toEqual([]);
  expect(v.notes.at(-1)).toBe("! needs a command: !<command>, run with the shell on a device.");
  View.view_act(v, { $: "Goto", name: "Mgr" });
  expect(View.view_act(v, { $: "Send", text: "!ls" })).toEqual([{ $: "bang", command: "ls" }]);
});

const crew = (name: string, parent: string, tier: View.Crew["tier"], status: View.Crew["status"], since = 0): View.Crew => ({ name, parent, tier, model: tier === "manager" ? "sonnet-5.5" : "haiku-5.5", status, since });

// the crew: each agent under who started it, the ones failed first, then
// those at work, waiting, stopped, done; each row its depth and status
test("the crew lists each agent under its starter, failed first, then at work, waiting, stopped, done", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [
    crew("Done", "main", "worker", "done", 1),
    crew("Mgr", "main", "manager", "waiting", 2),
    crew("WkrA", "Mgr", "worker", "working", 3),
    crew("WkrB", "Mgr", "worker", "failed", 4),
    crew("Solo", "main", "worker", "working", 5),
  ] });
  const rows = View.view_crew(v, 65000);
  expect(rows.map((r) => [r.name, r.depth, r.status])).toEqual([
    ["Solo", 0, "working"], ["Mgr", 0, "waiting"], ["WkrB", 1, "failed"], ["WkrA", 1, "working"], ["Done", 0, "done"],
  ]);
  expect(rows[2].text).toContain("WkrB");
  expect(rows[2].text).toContain("haiku-5.5");
  expect(rows[2].text.startsWith("  ")).toBe(true);
  expect(rows[0].text).toContain("1m");
  expect(View.view_attention(v).map((r) => r.name)).toEqual(["WkrB"]);
});

// a person types to the agent whose page is shown: the message is told
// to it, never sent to Legion
test("typing on an agent's page tells that agent", () => {
  const v = View.view_new();
  View.view_act(v, { $: "Goto", name: "Mgr" });
  expect(View.view_typing(v)).toBe(true);
  expect(View.view_act(v, { $: "Send", text: " check WkrA again " })).toEqual([{ $: "tell", name: "Mgr", text: "check WkrA again" }]);
  expect(View.view_act(v, { $: "Send", text: "  " })).toEqual([]);
  View.view_act(v, { $: "Goto", name: null });
  expect(View.view_act(v, { $: "Send", text: "hi" })[0].$).toBe("say");
});

// with a crew, Tab cycles Legion then every agent as the crew lists
// them, done ones too
test("tabs follow the crew: Legion, then its agents in crew order", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, agents: ["Wkr"], crew: [crew("Done", "main", "worker", "done", 1), crew("Mgr", "main", "manager", "waiting", 2), crew("Wkr", "Mgr", "worker", "working", 3)] });
  expect(View.view_tabs(v).map((t) => t.name)).toEqual([null, "Mgr", "Wkr", "Done"]);
  expect(View.view_named(v, "wk")).toBe("Wkr");
  expect(View.view_named(v, "do")).toBe("Done");
  expect(View.view_named(v, "zz")).toBe("zz");
});

// alerts: an agent failing, a turn ending; none for the state a view
// first hears, none for one told again, none twice within the debounce
test("alerts: an agent that fails, a turn that ends; not on connect, not twice", () => {
  const v = View.view_new();
  const hear = (busy: boolean, list: View.Crew[]) => View.view_hear(v, { $: "state", ...v, busy, crew: list });
  hear(true, [crew("Mgr", "main", "manager", "working"), crew("Old", "main", "worker", "failed")]);
  expect(View.view_alerts(v, 0)).toEqual([]);
  hear(true, [crew("Mgr", "main", "manager", "failed"), crew("Old", "main", "worker", "failed")]);
  expect(View.view_alerts(v, 1000)).toEqual([{ key: "Mgr failed", title: "Mgr failed", body: "manager · sonnet-5.5: open it to see why.", name: "Mgr" }]);
  expect(View.view_alerts(v, 2000)).toEqual([]);
  hear(false, [crew("Mgr", "main", "manager", "failed")]);
  expect(View.view_alerts(v, 3000)).toEqual([{ key: "turn", title: "Legion answered", body: "Its turn ended: your move.", name: null }]);
  hear(true, []);
  View.view_alerts(v, 4000);
  hear(false, []);
  expect(View.view_alerts(v, 5000)).toEqual([]);
  hear(true, []);
  View.view_alerts(v, 30000);
  hear(false, []);
  expect(View.view_alerts(v, 40000)).toHaveLength(1);
});

// a Claude Code worker asking to start: listed first, an alert, and the
// person's yes or no goes to the server
test("a Claude Code worker asking to start: first in the crew, alerted, approved or denied", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Wkr", "main", "worker", "working")] });
  View.view_alerts(v, 0);
  View.view_hear(v, { $: "state", ...v, crew: [crew("Wkr", "main", "worker", "working"), crew("Bad", "main", "worker", "failed"), { ...crew("Cc", "main", "worker", "asking"), tier: "claude", model: "claude-code" }] });
  expect(View.view_crew(v, 0).map((r) => r.name)).toEqual(["Cc", "Bad", "Wkr"]);
  expect(View.view_crew(v, 0)[0].text).toContain("? Cc");
  expect(View.view_alerts(v, 1000).slice(0, 1)).toEqual([{ key: "Cc asks", title: "Cc asks to start", body: "Claude Code: /approve or /deny it (on its page, the site's ✓ or ×).", name: "Cc" }]);
  expect(View.view_act(v, { $: "Approve", name: "Cc", yes: true })).toEqual([{ $: "approve", name: "Cc", yes: true }]);
  expect(View.view_asking(v)).toEqual(["Cc"]);
});

// The web's Crew view
// -------------------

// the hash names the mode and the agent in focus; a name round-trips,
// odd characters too; anything else is the chat
test("routes: #chat, #crew, #crew/<name>", () => {
  expect(View.view_route("")).toEqual({ mode: "chat", name: null });
  expect(View.view_route("#chat")).toEqual({ mode: "chat", name: null });
  expect(View.view_route("#crew")).toEqual({ mode: "crew", name: null });
  expect(View.view_route("#crew/Ada")).toEqual({ mode: "crew", name: "Ada" });
  expect(View.view_route("#nonsense")).toEqual({ mode: "chat", name: null });
  expect(View.view_route(View.view_hash("crew", "a b/c"))).toEqual({ mode: "crew", name: "a b/c" });
  expect(View.view_hash("chat", "x")).toBe("#chat");
  expect(View.view_hash("crew", null)).toBe("#crew");
});

const team = () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [
    crew("Mgr", "main", "manager", "waiting", 2),
    crew("A", "Mgr", "worker", "working", 3),
    crew("B", "Mgr", "worker", "working", 4),
    crew("C", "Mgr", "worker", "done", 5),
    crew("D", "Mgr", "worker", "failed", 6),
    crew("Sub", "Mgr", "manager", "waiting", 7),
    crew("E", "Sub", "worker", "working", 8),
    crew("Ask", "main", "claude", "asking", 9),
    crew("Solo", "main", "worker", "done", 1),
  ] });
  return v;
};

// managers start folded: a row rolls up all under it, by status; opened,
// its children show (a folded sub-manager rolls up its own)
test("the tree folds managers and rolls up their workers", () => {
  const v = team();
  const names = () => View.view_tree(v, 0).map((r) => r.name);
  expect(names()).toEqual(["Ask", "Mgr", "Solo"]);
  const mgr = View.view_tree(v, 0).find((r) => r.name === "Mgr")!;
  expect(mgr.kids).toBe(6);
  expect(mgr.open).toBe(false);
  expect(mgr.rollup).toBe("3 working, 1 waiting, 1 failed, 1 done");
  View.view_act(v, { $: "Expand", name: "Mgr" });
  expect(names()).toEqual(["Ask", "Mgr", "D", "B", "A", "Sub", "C", "Solo"]);
  expect(View.view_tree(v, 0).find((r) => r.name === "Sub")!.rollup).toBe("1 working");
  expect(View.view_tree(v, 0).find((r) => r.name === "A")!.rollup).toBe("");
  View.view_act(v, { $: "Expand", name: "Mgr" });
  expect(names()).toEqual(["Ask", "Mgr", "Solo"]);
});

// the agent in focus shows even under folded managers: its ancestors open
test("the focused agent's managers open for it", () => {
  const v = team();
  View.view_act(v, { $: "Goto", name: "E" });
  expect(View.view_tree(v, 0).map((r) => r.name)).toContain("E");
});

// what needs the person, asking first: on top of the Crew view and as
// the Chat's pill
test("needs you: asking, then failed; the pill counts them with those at work", () => {
  const v = team();
  expect(View.view_needs(v).map((c) => c.name)).toEqual(["Ask", "D"]);
  expect(View.view_pill(v)).toBe("3 working, 2 need you");
  View.view_hear(v, { $: "state", ...v, crew: [crew("F1", "main", "worker", "failed"), crew("Q", "main", "claude", "asking"), crew("F2", "main", "worker", "failed")] });
  expect(View.view_needs(v).map((c) => c.name)).toEqual(["Q", "F1", "F2"]);
  View.view_hear(v, { $: "state", ...v, crew: [crew("A", "main", "worker", "working")] });
  expect(View.view_pill(v)).toBe("1 working");
  View.view_hear(v, { $: "state", ...v, crew: [] });
  expect(View.view_pill(v)).toBe("");
});

// the Crew view's stop: that agent only
test("Stop stops the agent named", () => {
  const v = team();
  expect(View.view_act(v, { $: "Stop", name: "A" })).toEqual([{ $: "stop", name: "A" }]);
});

// a pulse is kept by agent, the latest only, and shows on its tree row;
// the view watches its focus alone (C3's tiles join it)
test("a pulse is kept per agent; the view watches what it shows", () => {
  const v = team();
  View.view_hear(v, { $: "pulse", name: "Solo", status: "done", act: "a", last: "first" });
  View.view_hear(v, { $: "pulse", name: "Solo", status: "done", act: "b", last: "Tests: 12 pass." });
  expect(v.pulses.get("Solo")).toMatchObject({ act: "b", last: "Tests: 12 pass." });
  expect(View.view_watch(v)).toEqual([]);
  View.view_act(v, { $: "Goto", name: "A" });
  expect(View.view_watch(v)).toEqual(["A"]);
});

// The Crew grid (no agent in focus): a tile per agent Unii started, with
// a dot per agent under it (any depth), its roll-up and its pulse
const { demo_crew, demo_pulses } = await import("./Demo.ts");

test("the demo crew: 8 managers, 40 workers, a sub-manager, one asking", () => {
  const crew = demo_crew(1e12);
  expect(crew.filter((c) => c.tier === "manager" && c.parent === "main")).toHaveLength(8);
  expect(crew.filter((c) => c.tier === "worker")).toHaveLength(41);
  expect(crew.filter((c) => c.status === "asking")).toHaveLength(1);
  expect(new Set(crew.map((c) => c.status)).size).toBe(6);
});

test("tiles: one per agent Unii started, dots for all under it", () => {
  const v = View.view_new();
  const crew = demo_crew(1e12);
  View.view_hear(v, { $: "state", ...v, crew });
  demo_pulses(crew).forEach((p) => View.view_hear(v, p));
  const tiles = View.view_tiles(v, 1e12);
  expect(tiles.map((t) => t.name)).toEqual(View.view_tree(v, 1e12).filter((r) => r.depth === 0).map((r) => r.name));
  expect(tiles).toHaveLength(9);
  const m3 = tiles.find((t) => t.name === "Mgr3")!;
  expect(m3.dots.map((d) => d.name)).toContain("W3-sub");
  expect(m3.dots).toHaveLength(7);
  expect(m3.rollup).toContain("working");
  expect(tiles.find((t) => t.name === "Claude1")!.dots).toEqual([]);
});

// the grid shown, the view watches its tiles (with its focus, at most 16)
test("the view watches the tiles in sight and its focus, at most 16", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: demo_crew(1e12) });
  expect(View.view_watch(v, ["Mgr0", "Mgr1"])).toEqual(["Mgr0", "Mgr1"]);
  View.view_act(v, { $: "Goto", name: "W1-1" });
  expect(View.view_watch(v, ["Mgr1"])).toEqual(["W1-1", "Mgr1"]);
  expect(View.view_watch(v, Array.from({ length: 30 }, (_, k) => "x" + k))).toHaveLength(16);
});

test("Tell tells the agent named; empty, nothing", () => {
  const v = View.view_new();
  expect(View.view_act(v, { $: "Tell", name: "Mgr1", text: " go on " })).toEqual([{ $: "tell", name: "Mgr1", text: "go on" }]);
  expect(View.view_act(v, { $: "Tell", name: "Mgr1", text: "  " })).toEqual([]);
});

// The timeline lane (the agent in focus): a mark per message by its
// time (tool calls, words, what it was told, notes), one per agent it
// started, and a stall for each quiet gap past STALL; the last mark at
// the right but for one at work, whose lane runs to now
test("the lane: marks by time, spawns, stalls", () => {
  const v = View.view_new();
  const t = (s: number) => new Date(1e12 + s * 1000).toISOString();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Mgr", "main", "manager", "done"), crew("Kid", "Mgr", "worker", "done", 1e12 + 50000)] });
  View.view_act(v, { $: "Goto", name: "Mgr" });
  View.view_hear(v, { $: "agent", name: "Mgr", found: true });
  for (const [kind, text, s] of [["user", "the task", 0], ["tool", "shell: ls", 10], ["mind", "hmm", 20], ["unii", "Done.\nAll good", 400]] as const) {
    View.view_hear(v, { $: "entry", agent: "Mgr", kind, text, date: t(s) });
  }
  View.view_hear(v, { $: "entry", agent: "Mgr", kind: "note", text: "no date" });
  const lane = View.view_lane(v, 1e12 + 999e3);
  expect(lane.map((m) => m.kind)).toEqual(["told", "tool", "spawn", "stall", "words"]);
  expect(lane[0].at).toBe(0);
  expect(lane.at(-1)!.at).toBe(1);
  expect(lane[1].k).toBe(1);
  expect(lane[4].k).toBe(3);
  expect(lane[2]).toMatchObject({ k: null, label: "started Kid" });
  expect(lane[3].label).toBe("quiet 5m");
  expect(lane[4].label).toBe("All good");
  // at work: the lane runs to now, a quiet end a stall too
  View.view_hear(v, { $: "state", ...v, crew: [crew("Mgr", "main", "manager", "working")] });
  const live = View.view_lane(v, 1e12 + 1000e3);
  expect(live.at(-1)).toMatchObject({ kind: "stall", at: 1 });
  expect(live.find((m) => m.kind === "words")!.at).toBeCloseTo(0.4, 2);
});


// The terminal's full-screen Crew (/crew full): keys move a selection on
// the tree, open and fold managers, act on the one selected; Enter
// shows its page and leaves, Esc or q leaves
test("full-screen Crew keys", () => {
  const v = team();
  const key = (sel: string | null, k: string) => View.view_full(v, sel, k);
  expect(key(null, "Down").sel).toBe("Mgr");
  expect(key("Ask", "j").sel).toBe("Mgr");
  expect(key("Ask", "Up").sel).toBe("Ask");
  expect(key("Solo", "Down").sel).toBe("Solo");
  expect(key("Mgr", "k").sel).toBe("Ask");
  expect(key("Mgr", "Right")).toMatchObject({ acts: [], done: false });
  expect(v.expanded.has("Mgr")).toBe(true);
  expect(key("Mgr", "Down").sel).toBe("D");
  expect(key("Mgr", "Right").acts).toEqual([]);
  expect(v.expanded.has("Mgr")).toBe(true);
  key("Mgr", "Left");
  expect(v.expanded.has("Mgr")).toBe(false);
  key("Mgr", " ");
  expect(v.expanded.has("Mgr")).toBe(true);
  expect(key("A", "s").acts).toEqual([{ $: "stop", name: "A" }]);
  expect(key("C", "s").acts).toEqual([]);
  expect(key("Ask", "a").acts).toEqual([{ $: "approve", name: "Ask", yes: true }]);
  expect(key("Ask", "d").acts).toEqual([{ $: "approve", name: "Ask", yes: false }]);
  expect(key("A", "a").acts).toEqual([]);
  expect(key("C", "x").acts).toEqual([{ $: "dismiss", name: "C" }]);
  expect(key("A", "x").acts).toEqual([]);
  expect(key("A", "Enter")).toMatchObject({ done: true, focus: "A" });
  expect(key("A", "Esc").done).toBe(true);
  expect(key("A", "Esc").focus).toBeUndefined();
  expect(key("A", "q").done).toBe(true);
  expect(key("A", "z")).toMatchObject({ sel: "A", acts: [], done: false });
});

// the terminal's crew rows say the title first, the name after, and the
// repos
test("a crew row's text: title, name, repos", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [{ ...crew("FireAnt", "main", "worker", "working"), title: "Fix login tests", repos: ["auth-api", "web"] }, crew("PlainOwl", "main", "worker", "done")] });
  const [fire, plain] = View.view_crew(v, 0);
  expect(fire.text).toStartWith("● Fix login tests (FireAnt) [auth-api, web] · worker");
  expect(plain.text).toStartWith("✓ PlainOwl · worker");
});

// the question backlog: an answer (a quick one or typed) goes to the
// server as "answer", trimmed (empty: nothing); a drop dismisses it; open
// questions count as needing the person in the Crew's pill
test("questions: Answer and Drop acts, and the pill counts them as needing you", () => {
  const v = View.view_new();
  const q = (id: number, text: string): View.Question => ({ id, text, at: 0, date: "2026-11-12T10:00:00.000Z" });
  View.view_hear(v, { $: "state", ...v, questions: [q(1, "Ship?"), q(2, "Rename?")] } as any);
  expect(View.view_questions(v).map((x) => x.id)).toEqual([1, 2]);
  expect(View.view_act(v, { $: "Answer", q: 1, text: "  yes  " })).toEqual([{ $: "answer", q: 1, text: "yes" }]);
  expect(View.view_act(v, { $: "Answer", q: 1, text: "  " })).toEqual([]);
  expect(View.view_act(v, { $: "Drop", q: 2 })).toEqual([{ $: "answer", q: 2 }]);
  expect(View.view_pill(v)).toBe("2 need you");
  View.view_hear(v, { $: "state", ...v, questions: [], crew: [{ name: "A", parent: "main", tier: "worker", model: "m", status: "working", since: 0 }] } as any);
  expect(View.view_pill(v)).toBe("1 working");
  View.view_hear(v, { $: "state", ...v, questions: [q(5, "Now?")] } as any);
  expect(View.view_pill(v)).toBe("1 working, 1 need you");
});

// the terminal's /questions, /answer <n> <text>, /drop <n>
test("questions in the terminal: the listing, and /answer and /drop parsed", () => {
  const v = View.view_new();
  expect(View.view_questions_note(v)).toBe("No open questions.");
  View.view_hear(v, { $: "state", ...v, questions: [
    { id: 4, text: "Which repo?", options: ["bank-recon", "pimco"], at: 0, date: "2026-11-12T10:00:00.000Z" },
    { id: 7, text: "Ship Friday?\nNeeds sign-off.", at: 0, date: "2026-11-12T13:00:00.000Z" },
  ] } as any);
  expect(View.view_questions_note(v)).toBe("Your questions:\n4. Which repo?\n   answers: bank-recon | pimco\n7. Ship Friday?\n   Needs sign-off.\nAnswer one: /answer <n> <text> (or the answer's number); dismiss: /drop <n>.");
  expect(View.view_answer(v, "4  bank-recon it is ")).toEqual({ $: "Answer", q: 4, text: "bank-recon it is" });
  expect(View.view_answer(v, "4 2")).toEqual({ $: "Answer", q: 4, text: "pimco" });
  expect(View.view_answer(v, "7 2")).toEqual({ $: "Answer", q: 7, text: "2" });
  expect(View.view_answer(v, "4")).toBe("/answer needs a question's number and the answer: /answer <n> <text>.");
  expect(View.view_answer(v, "9 yes")).toBe("No open question 9: /questions lists them.");
  expect(View.view_drop(v, "7")).toEqual({ $: "Drop", q: 7 });
  expect(View.view_drop(v, "x")).toBe("No open question x: /questions lists them.");
});

// the status line both views show (as Claude Code's): offline first, the
// folder and branch, the model, agents at work, today's spend, the mode,
// questions open. The web builds it from the state: the latest device's
// report (dir, branch, spend), the pick's model, the crew, the mode
test("the status line, and the web's from the state", () => {
  const s = { up: true, dir: "repo", branch: "main", model: "opus", working: 2, spend: { spend: 1.234, stale: true }, questions: 1, mode: "plan" as const };
  expect(View.status_text(s)).toBe("repo ⎇ main · opus · 2 agents at work · $1.23* today · plan mode · 1 question (/questions)");
  expect(View.status_text({ ...s, up: false, branch: null, working: 0, spend: { spend: null, stale: false }, questions: 0, mode: undefined })).toBe("offline · repo · opus");
  const v = View.view_new();
  expect(View.view_status(v)).toBe("");
  View.view_hear(v, { $: "state", ...v, up: true, agents: ["A"], mode: "auto", status: { device: "mac", dir: "uniichat", branch: "feat/crew-ui", spend: 0.5, stale: false } } as any);
  v.up = true;
  v.pick = { model: "sonnet-5.5" } as any;
  expect(View.view_status(v)).toBe("mac: uniichat ⎇ feat/crew-ui · sonnet-5.5 · 1 agent at work · $0.50 today · auto mode");
});

// the mode controls (M3): Shift+Tab / the chip cycles the mode, /mode sets
// it; the plan waiting: shown, approved (into auto or full) or sent back;
// a call waiting for the user (auto's reviewer couldn't check it): yes/no.
// All count as needing the person.
test("modes in the views: cycle and set, the plan's verdict, a waiting call's yes or no", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, mode: "plan", plan: { text: "1. read\n2. fix", date: "2026-11-12T10:00:00.000Z" }, calls: [{ id: 3, who: "Wkr", tool: "shell", what: "make deploy (on mac)" }] } as any);
  expect(View.view_act(v, { $: "Mode" })).toEqual([{ $: "mode", mode: "auto" }]);
  expect(View.view_act(v, { $: "Mode", mode: "full" })).toEqual([{ $: "mode", mode: "full" }]);
  expect(View.view_mode_cmd("bogus")).toBe("No mode bogus: plan, auto or full.");
  expect(View.view_mode_cmd(" plan ")).toEqual({ $: "Mode", mode: "plan" });
  expect(View.view_mode_cmd("")).toEqual({ $: "Mode" });
  expect(View.view_act(v, { $: "Verdict", yes: true, mode: "full" })).toEqual([{ $: "plan", yes: true, mode: "full" }]);
  expect(View.view_act(v, { $: "Verdict", yes: false, text: " test first " })).toEqual([{ $: "plan", yes: false, text: "test first" }]);
  expect(View.view_plan_cmd(v, "")).toBe("The plan waiting for you:\n1. read\n2. fix\n/plan yes [auto|full] to approve it, /plan no <feedback> to send it back.");
  expect(View.view_plan_cmd(v, "yes")).toEqual({ $: "Verdict", yes: true, mode: "auto" });
  expect(View.view_plan_cmd(v, "yes full")).toEqual({ $: "Verdict", yes: true, mode: "full" });
  expect(View.view_plan_cmd(v, "no do tests first")).toEqual({ $: "Verdict", yes: false, text: "do tests first" });
  expect(View.view_plan_cmd(v, "maybe")).toBe("/plan, /plan yes [auto|full] or /plan no <feedback>.");
  expect(View.view_plan_cmd(v, "yes please")).toBe("/plan, /plan yes [auto|full] or /plan no <feedback>.");
  expect(View.view_act(v, { $: "Consent", n: 3, yes: true })).toEqual([{ $: "consent", n: 3, yes: true }]);
  expect(View.view_consent_cmd(v, "3", false)).toEqual({ $: "Consent", n: 3, yes: false });
  expect(View.view_consent_cmd(v, "9", true)).toBe("No call 9 waits for you.");
  expect(View.view_pill(v)).toBe("2 need you");
  View.view_hear(v, { $: "state", ...v, plan: null, calls: [], mode: "auto" } as any);
  expect(View.view_plan_cmd(v, "")).toBe("No plan is waiting for you.");
  expect(View.view_act(v, { $: "Mode" })).toEqual([{ $: "mode", mode: "full" }]);
  expect(View.view_pill(v)).toBe("");
});

// alerts for what newly waits for the person: a question, the plan, a
// call auto's reviewer couldn't check; each once
test("alerts: a new question, a plan ready, a waiting call, each once", () => {
  const v = View.view_new();
  View.view_alerts(v, 0);
  View.view_hear(v, { $: "state", ...v, questions: [{ id: 1, text: "Ship it?\nmore", at: 0, date: "" }], plan: { text: "p", date: "" }, calls: [{ id: 2, who: "Wkr", tool: "shell", what: "make deploy (on mac)" }] } as any);
  const got = View.view_alerts(v, 1e6).map((a) => [a.title, a.body]);
  expect(got).toEqual([["Legion asks", "Ship it?"], ["Plan ready", "Legion's plan waits for your approval (/plan)."], ["Wkr wants to run a command", "make deploy (on mac): /allow 2 or /refuse 2."]]);
  expect(View.view_alerts(v, 2e6)).toEqual([]);
});
