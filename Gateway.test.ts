// Gateway: the LiteLLM daily budget of this key's team member, from a
// fake gateway; only that member's three numbers kept; anything odd: none
import { expect, test } from "bun:test";
import { gateway_budget } from "./Gateway.ts";
import * as View from "./View.ts";

const fake = (key: any, team: any, seen: string[] = []) => (async (url: any, init: any) => {
  seen.push(String(url) + " " + init?.headers?.authorization);
  const body = String(url).includes("/key/info") ? key : team;
  return body === 500 ? new Response("down", { status: 500 }) : Response.json(body);
}) as unknown as typeof fetch;

const KEY = { info: { team_id: "t 1", user_id: "me" } };
const TEAM = { team_memberships: [
  { user_id: "other", spend: 999, litellm_budget_table: { max_budget: 5 } },
  { user_id: "me", spend: 686.15, litellm_budget_table: { max_budget: 800, budget_reset_at: "2026-11-14T00:00:00Z" } },
] };

test("gateway_budget: this member's spend, cap and reset; none when odd", async () => {
  const seen: string[] = [];
  expect(await gateway_budget("https://gw", "k", fake(KEY, TEAM, seen))).toEqual({ spend: 686.15, max: 800, reset: "2026-11-14T00:00:00Z" });
  expect(seen).toEqual(["https://gw/key/info Bearer k", "https://gw/team/info?team_id=t%201 Bearer k"]);
  expect(await gateway_budget("https://gw", "k", fake(500, TEAM))).toBeNull();
  expect(await gateway_budget("https://gw", "k", fake({ info: {} }, TEAM))).toBeNull();
  expect(await gateway_budget("https://gw", "k", fake(KEY, { team_memberships: [{ user_id: "me", spend: 1 }] }))).toBeNull();
  expect(await gateway_budget("https://gw", "k", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
});

// the status line: the gateway's budget spent of its cap; the AI service
// busy in the last BUSY_FOR
test("status_text: the gateway's budget and a busy AI service", () => {
  const s = { up: true, dir: "home", branch: null, model: "opus", working: 0, spend: { spend: null, stale: false } };
  expect(View.status_text({ ...s, budget: { spend: 686.15, max: 800 } })).toBe("home · opus · gateway $686/$800");
  expect(View.status_text({ ...s, busy: true })).toBe("home · opus · ⚠ AI service busy");
  const v = View.view_new();
  View.view_hear(v, { $: "gateway", budget: { spend: 1, max: 2, reset: null }, busy: Date.now() - 1000 });
  expect(v.gateway?.budget?.max).toBe(2);
  expect(View.view_busy(v, Date.now())).toBe(true);
  expect(View.view_busy(v, Date.now() + View.BUSY_FOR + 2000)).toBe(false);
});
