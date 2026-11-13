// Retries while the AI service is busy
// ====================================
// `bun test retry.test.ts`. Bedrock behind the gateway flaps (user's
// report 2026-11-13): a request fails with 503 for minutes, then the
// same request passes. Legion asks again more times, sooner (waits capped
// at 30 s, as Claude Code's), and says so only from the third try.

import { expect, test } from "bun:test";
import { Agent, TRIES } from "./Agent.ts";

test("waits double from 2 s up to 30 s; a retry-after is kept, capped", () => {
  expect([1, 2, 3, 4, 5, 6, 12].map((k) => Agent.backoff(k, null))).toEqual([2, 4, 8, 16, 30, 30, 30]);
  expect(Agent.backoff(1, 5)).toBe(5);
  expect(Agent.backoff(3, 600)).toBe(30);
  expect(TRIES).toBe(12);
});

test("the first two retries are quiet; from the third the user is told", () => {
  expect([1, 2, 3, 4].map((k) => Agent.tells(k))).toEqual([false, false, true, true]);
});
