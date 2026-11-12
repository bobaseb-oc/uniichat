// Routines test
// =============
// `bun test Routines.test.ts`. The cockpit's routines (Routines.ts): a
// task a native Legion agent is started on, daily at a time, every N
// hours, or for each new review request of the user's (Herdr's inbox
// automations); what a routine may say (checked), when it's next due, how
// the terminal's /routine add reads one.

import { expect, test } from "bun:test";
import * as Routines from "./Routines.ts";

const at = (h: number, m = 0, day = 12) => new Date(2026, 10, day, h, m).getTime();
const routine = (when: Routines.When, over: Partial<Routines.Routine> = {}): Routines.Routine =>
  ({ id: 1, name: "R", task: "do it", when, tier: "worker", on: true, last: null, made: at(8), ...over });

test("a routine's check: a name, a task, a when, a tier; text cut; bad ones refused", () => {
  expect(Routines.routine_check({ name: " Morning ", task: "Triage", when: { $: "daily", at: "09:30" }, tier: "manager" })).toEqual({ name: "Morning", task: "Triage", when: { $: "daily", at: "09:30" }, tier: "manager" });
  expect(Routines.routine_check({ name: "n", task: "t", when: { $: "every", hours: 4 } })).toMatchObject({ tier: "worker" });
  expect(Routines.routine_check({ name: "n", task: "", when: { $: "review" } })).toMatchObject({ task: "" }); // a review routine's task is the review
  expect((Routines.routine_check({ name: "n".repeat(500), task: "t".repeat(9000), when: { $: "every", hours: 1 } }) as any).name.length).toBe(Routines.NAME);
  for (const bad of [
    { name: "", task: "t", when: { $: "every", hours: 1 } }, { name: "n", task: "", when: { $: "every", hours: 1 } },
    { name: "n", task: "t", when: { $: "daily", at: "25:00" } }, { name: "n", task: "t", when: { $: "every", hours: 0 } },
    { name: "n", task: "t", when: { $: "every", hours: 1000 } }, { name: "n", task: "t", when: { $: "cron" } }, { name: "n", task: "t", when: { $: "every", hours: 1 }, tier: "god" }, null,
  ]) {
    expect(typeof Routines.routine_check(bad)).toBe("string");
  }
});

test("daily at a time: due once its time passed today and it hasn't run since; made after it, tomorrow", () => {
  const r = routine({ $: "daily", at: "09:00" });
  expect(Routines.routine_next(r, at(8, 30))).toBe(at(9));
  expect(Routines.routine_due(r, at(8, 59))).toBe(false);
  expect(Routines.routine_due(r, at(9, 1))).toBe(true);
  expect(Routines.routine_due({ ...r, last: at(9, 1) }, at(15))).toBe(false);
  expect(Routines.routine_next({ ...r, last: at(9, 1) }, at(15))).toBe(at(9, 0, 13));
  expect(Routines.routine_due({ ...r, made: at(10) }, at(15))).toBe(false); // made after today's: tomorrow
  expect(Routines.routine_due({ ...r, on: false }, at(9, 1))).toBe(false);
});

test("every N hours: due N hours after it last ran (or was made); on a review request: never by the clock", () => {
  const r = routine({ $: "every", hours: 4 });
  expect(Routines.routine_next(r, at(9))).toBe(at(12));
  expect(Routines.routine_due(r, at(11, 59))).toBe(false);
  expect(Routines.routine_due(r, at(12))).toBe(true);
  expect(Routines.routine_due({ ...r, last: at(12) }, at(15))).toBe(false);
  const review = routine({ $: "review" });
  expect(Routines.routine_next(review, at(9))).toBe(null);
  expect(Routines.routine_due(review, at(23))).toBe(false);
});

test("how a when reads", () => {
  expect(Routines.when_text({ $: "daily", at: "09:00" })).toBe("daily at 09:00");
  expect(Routines.when_text({ $: "every", hours: 1 })).toBe("every hour");
  expect(Routines.when_text({ $: "every", hours: 6 })).toBe("every 6 hours");
  expect(Routines.when_text({ $: "review" })).toBe("on each new review request");
});

test("the terminal's /routine add: daily HH:MM, every Nh, on review; then the name, a colon, the task", () => {
  expect(Routines.routine_parse("daily 09:00 Morning triage: look at the inbox")).toEqual({ name: "Morning triage", task: "look at the inbox", when: { $: "daily", at: "09:00" }, tier: "worker" });
  expect(Routines.routine_parse("every 4h Sweep: clean the worktrees")).toMatchObject({ when: { $: "every", hours: 4 } });
  expect(Routines.routine_parse("on review Reviews")).toMatchObject({ name: "Reviews", task: "", when: { $: "review" } });
  expect(Routines.routine_parse("manager daily 08:00 Plan: plan the day")).toMatchObject({ tier: "manager" });
  expect(typeof Routines.routine_parse("weekly Mon x: y")).toBe("string");
  expect(typeof Routines.routine_parse("daily 09:00 no colon here")).toBe("string");
});

// in the views: the Routine act as sent; the terminal's /routines and
// /routine; the web's page (Pages.routines_html)
test("views: the act sent, the terminal's commands and list, the web's page and counts", async () => {
  const View = await import("./View.ts");
  const Pages = await import("./web/src/Pages.ts");
  const Cockpit = await import("./Cockpit.ts");
  const v = View.view_new();
  const given = { name: "Sweep", task: "clean", when: { $: "every", hours: 4 } as Routines.When, tier: "worker" as const };
  expect(View.view_act(v, { $: "Routine", op: "add", routine: given })).toEqual([{ $: "routine", op: "add", routine: given }]);
  expect(View.view_act(v, { $: "Routine", op: "toggle", n: 2, on: false })).toEqual([{ $: "routine", op: "toggle", n: 2, on: false }]);
  expect(View.view_routines_note(v)).toBe("No routines. Add one: /routine add daily 09:00 Name: task (or every 4h, or on review).");
  v.routines = [routine({ $: "every", hours: 4 }, { id: 3, name: "Sweep <x>", last: at(8) }), routine({ $: "review" }, { id: 4, name: "Reviews", on: false })];
  expect(View.view_routines_note(v)).toContain("3. Sweep <x> · every 4 hours · worker · on");
  expect(View.view_routines_note(v)).toContain("4. Reviews · on each new review request · worker · off");
  expect(View.view_routine_cmd(v, "add every 4h Sweep: clean")).toEqual({ $: "Routine", op: "add", routine: given });
  expect(View.view_routine_cmd(v, "run 3")).toEqual({ $: "Routine", op: "run", n: 3 });
  expect(View.view_routine_cmd(v, "off 3")).toEqual({ $: "Routine", op: "toggle", n: 3, on: false });
  expect(View.view_routine_cmd(v, "on 4")).toEqual({ $: "Routine", op: "toggle", n: 4, on: true });
  expect(View.view_routine_cmd(v, "drop 3")).toEqual({ $: "Routine", op: "drop", n: 3 });
  expect(typeof View.view_routine_cmd(v, "run 9")).toBe("string");
  expect(typeof View.view_routine_cmd(v, "explode 3")).toBe("string");
  const html = Pages.routines_html(v, at(9)).join("");
  expect(html).toContain("Sweep &lt;x&gt;");
  expect(html).toContain("every 4 hours");
  expect(html).toContain(JSON.stringify({ $: "Routine", op: "run", n: 3 }).replace(/"/g, "&quot;"));
  expect(html).not.toContain(JSON.stringify({ $: "Routine", op: "run", n: 4 }).replace(/"/g, "&quot;")); // a review routine isn't run by hand
  expect(html).toContain(JSON.stringify({ $: "Routine", op: "toggle", n: 4, on: true }).replace(/"/g, "&quot;"));
  expect(html).toContain('<form class="radd">');
  expect(Cockpit.home_apps(v).routines).toBe("1 scheduled");
});
