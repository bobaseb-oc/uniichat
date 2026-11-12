// Device test
// ===========
// `bun test Device.test.ts`. A device (Device.ts: `unii device`, the
// terminal's jobs too) against a fake server: it signs in by its Bearer
// and names itself; a job runs once and its output goes back; a computer
// job is refused where computer use is off; an output too large is
// refused by its size; a job the server drops is stopped.

import { afterAll, expect, test } from "bun:test";
import * as Device from "./Device.ts";
import * as View from "./View.ts";

type Sock = { send: (s: string) => void };
const got: any[] = [];
let sock: Sock | null = null;
let hello: { auth: string | null; query: string } | null = null;
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req, srv) {
    hello = { auth: req.headers.get("authorization"), query: new URL(req.url).search };
    return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
  },
  websocket: {
    open(ws) {
      sock = ws;
      ws.send(JSON.stringify({ $: "view", parts: [], turn: 0 }));
    },
    message(ws, data) {
      const msg = JSON.parse(String(data));
      got.push(msg);
      ws.send(JSON.stringify({ $: "ack", id: msg.id }));
    },
  },
});
afterAll(() => server.stop(true));

const until = async (f: () => boolean) => {
  for (let k = 0; k < 300 && !f(); k++) await Bun.sleep(10);
  return f();
};
const runs: Array<{ job: any; work: string; home?: string; signal: AbortSignal }> = [];
const run = async (job: any, work: string, signal: AbortSignal, _away?: AbortSignal, home?: string) => {
  runs.push({ job, work, home, signal });
  if (job.input === "big") {
    return { text: "x".repeat(View.FRAME), fail: false };
  }
  if (job.input === "slow") {
    await new Promise((ok) => signal.addEventListener("abort", ok));
    return { text: "stopped", fail: true };
  }
  return { text: "ran " + job.input, fail: false };
};

const v = Device.device_open("http://127.0.0.1:" + server.port, { authorization: "Bearer tok" }, "&device=box", { work: "~/w", home: "/h", computer: false, run }, () => {});
const outs = () => got.filter((m) => m.$ === "out");

test("a device signs in by its Bearer and names itself", async () => {
  expect(await until(() => v.up)).toBe(true);
  expect(hello?.auth).toBe("Bearer tok");
  expect(hello?.query).toContain("&device=box");
});

test("a job runs once, its output answered, in the device's work dir and home repo", async () => {
  const job = { $: "job", id: "j1", job: { name: "shell", input: "ls", cwd: "" } };
  sock!.send(JSON.stringify(job));
  sock!.send(JSON.stringify(job));
  expect(await until(() => outs().length === 1)).toBe(true);
  await Bun.sleep(100);
  expect(outs()).toHaveLength(1);
  expect(outs()[0]).toMatchObject({ job: "j1", out: { text: "ran ls", fail: false } });
  expect(runs.filter((r) => r.job.input === "ls")).toHaveLength(1);
  expect(runs[0]).toMatchObject({ work: "~/w", home: "/h" });
});

test("a computer job is refused where computer use is off; it never runs", async () => {
  sock!.send(JSON.stringify({ $: "job", id: "j2", job: { name: "computer", input: "click", cwd: "" } }));
  expect(await until(() => outs().some((o) => o.job === "j2"))).toBe(true);
  expect(outs().find((o) => o.job === "j2").out).toEqual({ text: Device.NO_COMPUTER, fail: true });
  expect(runs.some((r) => r.job.name === "computer")).toBe(false);
});

test("an output too large is answered by its size, failed", async () => {
  sock!.send(JSON.stringify({ $: "job", id: "j3", job: { name: "shell", input: "big", cwd: "" } }));
  expect(await until(() => outs().some((o) => o.job === "j3"))).toBe(true);
  const out = outs().find((o) => o.job === "j3").out;
  expect(out.fail).toBe(true);
  expect(out.text).toContain("bytes, is over the");
});

test("a job the server no longer lists is stopped", async () => {
  sock!.send(JSON.stringify({ $: "job", id: "j4", job: { name: "shell", input: "slow", cwd: "" } }));
  expect(await until(() => runs.some((r) => r.job.input === "slow"))).toBe(true);
  sock!.send(JSON.stringify({ $: "jobs", ids: ["j4"] }));
  await Bun.sleep(50);
  expect(runs.find((r) => r.job.input === "slow")!.signal.aborted).toBe(false);
  sock!.send(JSON.stringify({ $: "jobs", ids: [] }));
  expect(await until(() => outs().some((o) => o.job === "j4"))).toBe(true);
  expect(runs.find((r) => r.job.input === "slow")!.signal.aborted).toBe(true);
});
