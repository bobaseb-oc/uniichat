// Device test
// ===========
// `bun test Device.test.ts`. A device (Device.ts: `legion device`, the
// terminal's jobs too) against a fake server: it signs in by its Bearer
// and names itself; a job runs once and its output goes back; a computer
// job is refused where computer use is off; an output too large is
// refused by its size; a job the server drops is stopped.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
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

// a device's report for the web's status line (Device.device_status): the
// folder Unii works in (its home repo, else <work>/main), its branch
test("a device reports the folder Unii works in and its branch", () => {
  const repo = fs.mkdtempSync(os.tmpdir() + "/legion-home-");
  Bun.spawnSync(["git", "init", "-q", "-b", "trunk", repo]);
  const s = Device.device_status({ work: "/nowhere", home: repo, computer: false }, Date.now()) as any;
  expect(s).toMatchObject({ $: "status", dir: repo.split("/").pop(), branch: "trunk" });
  expect(typeof s.stale).toBe("boolean");
  expect(s.week === null || typeof s.week === "number").toBe(true); // the last 7 days' spend (Cost.cost_week)
  const none = Device.device_status({ work: os.tmpdir(), computer: false }, Date.now()) as any;
  expect(none).toMatchObject({ dir: "main", branch: null });
});

// a device's inbox (Device.device_inbox): gh's PRs and notifications,
// acli's tickets, its spaces' worktrees, read by the commands it runs
// (here a fake's); one that fails is said in errors, the rest kept
test("a device reads its inbox with gh, acli and git; what fails is said, not thrown", async () => {
  const pr = { number: 3, title: "T", url: "https://github.com/o/r/pull/3", isDraft: false, updatedAt: "", additions: 1, deletions: 0, changedFiles: 1, body: "", headRefName: "b",
    repository: { nameWithOwner: "o/r" }, author: { __typename: "User", login: "me" }, reviewDecision: null, mergeable: "MERGEABLE", reviewRequests: { nodes: [] }, commits: { nodes: [] } };
  const ran: string[][] = [];
  const exec: Device.Exec = async (cmd) => {
    ran.push(cmd);
    const line = cmd.join(" ");
    if (line.startsWith("gh api graphql")) {
      return { code: 0, out: JSON.stringify({ data: { viewer: { login: "me" }, reviews: { nodes: [] }, mine: { nodes: [pr] }, merged: { issueCount: 4 }, today: { issueCount: 1 } } }) };
    }
    if (line.startsWith("gh api notifications")) {
      return { code: 0, out: JSON.stringify([{ reason: "assign", unread: true, updated_at: "", repository: { full_name: "o/r" }, subject: { title: "N", url: "" } }]) };
    }
    if (line.startsWith("acli")) {
      return { code: 1, out: "✗ Error: unauthorized: use 'acli jira auth login' to authenticate" };
    }
    if (line.includes("worktree list")) {
      return { code: 0, out: "worktree /s\nbranch refs/heads/main\n\nworktree /s/.wt/x\nbranch refs/heads/x\n\nworktree /s/.wt/y\nbranch refs/heads/y\n\nworktree /s/.wt/z\nbranch refs/heads/z\n" };
    }
    if (line.includes("rev-parse")) {
      return { code: 0, out: "origin/main\n" };
    }
    if (line.includes("branch --merged")) {
      return { code: 0, out: "main\ny\n" };
    }
    if (line.includes("status --porcelain")) {
      return { code: 0, out: cmd.includes("/s/.wt/x") ? " M a\n?? b\n" : "" };
    }
    return { code: 1, out: "" };
  };
  const msg = await Device.device_inbox({ work: "/w", computer: false, spaces: ["/s"] }, exec, new Date(2026, 10, 12)) as any;
  expect(msg.$).toBe("inbox");
  const inbox = msg.inbox;
  expect(inbox.login).toBe("me");
  expect(inbox.mine.map((p: any) => p.number)).toEqual([3]);
  expect([inbox.merged, inbox.today]).toEqual([4, 1]);
  expect(inbox.notes.map((n: any) => n.kind)).toEqual(["assign"]);
  expect(inbox.tickets).toBe(null);
  expect(inbox.errors).toEqual(["acli: ✗ Error: unauthorized: use 'acli jira auth login' to authenticate"]);
  // x has changes, y is merged and clean, z is clean and not merged (left out)
  expect(inbox.clean).toEqual([
    { repo: "s", path: "/s/.wt/x", branch: "x", changes: 2, merged: false },
    { repo: "s", path: "/s/.wt/y", branch: "y", changes: 0, merged: true },
  ]);
  // what it ran reads only: no write, no push
  expect(ran.every((c) => ["gh", "acli", "git"].includes(c[0]))).toBe(true);
  expect(ran.some((c) => c.filter((a) => !a.startsWith("query=")).join(" ").match(/\b(push|commit|create|edit|delete|POST)\b/))).toBe(false);
  // gh missing: said, the rest still read
  const none = await Device.device_inbox({ work: "/w", computer: false, spaces: [] }, async (cmd) => (cmd[0] === "gh" ? { code: 127, out: "not found" } : exec(cmd)), new Date()) as any;
  expect(none.inbox.errors.some((e: string) => e.startsWith("gh: "))).toBe(true);
  expect(none.inbox.mine).toEqual([]);
});
