// A gateway's spent budget is not busy
// =====================================
// `bun test budget.test.ts`. LiteLLM answers a key or model past its budget
// with HTTP 429 ("Budget has been exceeded!"), the status of a rate limit:
// asking again cannot help, so it fails at once, saying so, instead of
// retrying for minutes as "the AI service is busy" (user's report
// 2026-11-13). Real rate limits and outages still retry.

import { expect, test } from "bun:test";
import { Agent } from "./Agent.ts";

const res = (status: number, headers: Record<string, string> = {}) => new Response("", { status, headers });
const SPENT = "HTTP 429: Budget has been exceeded! Current cost: 800.6046641950002, Max budget: 800.0";

test("a spent budget fails at once, its reason told; rate limits and outages still retry", () => {
  const spent = Agent.verdict(res(429), SPENT);
  expect(spent.stop).toBe("fail");
  expect(spent.why).toContain("spending limit");
  expect(spent.why).toContain("Max budget: 800.0");
  expect(Agent.verdict(res(429), "HTTP 429: You exceeded your current quota, please check your plan").stop).toBe("fail");
  expect(Agent.verdict(res(400), "HTTP 400: Your credit balance is too low to access the Anthropic API").stop).toBe("down"); // held for credit (failsafe.test.ts)
  expect(Agent.verdict(res(429, { "retry-after": "1" }), "HTTP 429: rate_limit_error: Number of request tokens has exceeded your per-minute rate limit").stop).toBe("busy");
  expect(Agent.verdict(res(503), "HTTP 503: Bedrock is unable to process your request.").stop).toBe("busy");
  expect(Agent.verdict(res(529), "HTTP 529: overloaded_error").stop).toBe("busy");
  expect(Agent.verdict(res(400), "HTTP 400: invalid_request_error").stop).toBe("down");
  expect(Agent.verdict(res(429, { "x-should-retry": "false" }), "HTTP 429: slow down").stop).toBe("down");
});
