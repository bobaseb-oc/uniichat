// Cost test
// =========
// `bun test Cost.test.ts`. Today's LiteLLM spend as the status line shows
// it: read from the cache the user's refresher writes (Claude Code's own,
// ~/.cache/statusline/litellm-<UTC day>.json); stale past 15 minutes; a
// refresh due past 90 s; none, or unreadable, is no spend, never a throw.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Cost from "./Cost.ts";
import * as Paint from "./Paint.ts";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-cost-");
const NOW = Date.parse("2026-11-11T13:00:00Z");
const put = (body: string) => fs.writeFileSync(DIR + "/litellm-2026-11-11.json", body);

test("today's spend: fresh, stale past 15 minutes, a refresh due past 90 s", () => {
  put(JSON.stringify({ spend: 4.2134, fetched_at: NOW - 60e3 }));
  expect(Cost.cost_read(DIR, NOW)).toEqual({ spend: 4.2134, stale: false, due: false });
  put(JSON.stringify({ spend: 4.2134, fetched_at: NOW - 120e3 }));
  expect(Cost.cost_read(DIR, NOW)).toEqual({ spend: 4.2134, stale: false, due: true });
  put(JSON.stringify({ spend: 1, fetched_at: NOW - 16 * 60e3 }));
  expect(Cost.cost_read(DIR, NOW)).toEqual({ spend: 1, stale: true, due: true });
});

test("no cache, an unreadable one, one with no spend: no spend, a refresh due", () => {
  fs.rmSync(DIR + "/litellm-2026-11-11.json", { force: true });
  expect(Cost.cost_read(DIR, NOW)).toEqual({ spend: null, stale: true, due: true });
  put("{not json");
  expect(Cost.cost_read(DIR, NOW)).toEqual({ spend: null, stale: true, due: true });
  put(JSON.stringify({ error: "down", fetched_at: NOW }));
  expect(Cost.cost_read(DIR, NOW)).toEqual({ spend: null, stale: false, due: false });
});

test("the status line: offline first, the folder, branch, model, agents at work, today's spend", () => {
  const all = { up: true, dir: "home", branch: "main", model: "opus-5.5", working: 3, spend: { spend: 4.2134, stale: true, due: false } };
  expect(Paint.status_text(all)).toBe("home ⎇ main · opus-5.5 · 3 agents at work · $4.21* today");
  expect(Paint.status_text({ ...all, up: false, branch: null, working: 1, spend: { spend: 0.0042, stale: false, due: false } })).toBe("offline · home · opus-5.5 · 1 agent at work · $0.0042 today");
  expect(Paint.status_text({ ...all, working: 0, spend: { spend: null, stale: true, due: true } })).toBe("home ⎇ main · opus-5.5");
});
