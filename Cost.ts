// Cost
// ====
// Today's actual LiteLLM spend, for the terminal's status line, as Claude
// Code's status line shows it: read from the cache the user's refresher
// keeps (UNII_COST_CACHE, default ~/.cache/statusline: litellm-<UTC day>.json,
// {spend, fetched_at}), never fetched here, so no key passes through unii.
// Past DUE the refresher (UNII_COST_REFRESH, default Claude Code's
// ~/.claude/hooks/litellm-cost.js, if there) runs detached, once at a
// time; past STALE the spend shows marked. A cache missing or unreadable
// is no spend, never a throw.

import * as fs from "node:fs";
import * as os from "node:os";

// spend: USD today (null: none known); stale: older than STALE; due: a
// refresh is
export type Spend = { spend: number | null; stale: boolean; due: boolean };

const DUE   = 90e3;
const STALE = 15 * 60e3;

export const COST_CACHE   = (process.env.UNII_COST_CACHE || "~/.cache/statusline").replace(/^~(?=\/)/, os.homedir());
export const COST_REFRESH = (process.env.UNII_COST_REFRESH || "~/.claude/hooks/litellm-cost.js").replace(/^~(?=\/)/, os.homedir());

let refreshing: { exited: Promise<number> } | null = null;

export function cost_read(dir: string, now: number): Spend {
  const file = dir + "/litellm-" + new Date(now).toISOString().slice(0, 10) + ".json";
  let cached: any = null;
  try {
    cached = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    cached = null;
  }
  const age = typeof cached?.fetched_at === "number" ? now - cached.fetched_at : Infinity;
  return { spend: typeof cached?.spend === "number" ? cached.spend : null, stale: age > STALE, due: age > DUE };
}

// the refresher, run detached if it is there and none runs
export function cost_refresh(script: string): void {
  if (refreshing !== null || !fs.existsSync(script)) {
    return;
  }
  const proc = Bun.spawn([process.execPath, script], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  proc.unref();
  refreshing = proc;
  void proc.exited.finally(() => (refreshing = null));
}

// the last 7 UTC days' spend (today's and the 6 before): the daily caches
// there summed (null: none), and how many there were
export function cost_week(dir: string, now: number): { spend: number | null; days: number } {
  let spend = 0;
  let days = 0;
  for (let k = 0; k < 7; k++) {
    const file = dir + "/litellm-" + new Date(now - k * 86400e3).toISOString().slice(0, 10) + ".json";
    try {
      const got = JSON.parse(fs.readFileSync(file, "utf8"))?.spend;
      if (typeof got === "number" && Number.isFinite(got)) {
        spend += got;
        days += 1;
      }
    } catch {
      continue;
    }
  }
  return { spend: days === 0 ? null : spend, days };
}
