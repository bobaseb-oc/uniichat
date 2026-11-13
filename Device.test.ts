// Device test
// ===========
// `bun test Device.test.ts`. A device (Device.ts: `legion device`, the
// terminal's jobs too) against a fake server: it signs in by its Bearer
// and names itself; a job runs once and its output goes back; a computer
// job is refused where computer use is off; an output too large is
// refused by its size; a job the server drops is stopped. RED ZONE
// (security review U1, DRAFT awaiting the user's sign-off): the fake
// server listens on a unix socket in a 0700 dir, as Server.ts does: the
// device reaches it only there, never over TCP.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Device from "./Device.ts";
import * as View from "./View.ts";

type Sock = { send: (s: string) => void };
const got: any[] = [];
let sock: Sock | null = null;
let hello: { auth: string | null; query: string; host: string | null } | null = null;
// a fresh 0700 dir, as the server's (Server.ts Main.private)
const dir0700 = () => {
  const d = fs.mkdtempSync(os.tmpdir() + "/legion-dev-");
  fs.chmodSync(d, 0o700);
  return d;
};
const DIR = dir0700();
const server = Bun.serve({
  unix: DIR + "/server.sock",
  fetch(req, srv) {
    hello = { auth: req.headers.get("authorization"), query: new URL(req.url).search, host: req.headers.get("host") };
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

const v = Device.device_open(Device.device_wire("http://127.0.0.1:8788", DIR), { authorization: "Bearer tok" }, "&device=box", { work: "~/w", home: "/h", computer: false, run }, () => {});
const outs = () => got.filter((m) => m.$ === "out");

test("a device signs in by its Bearer and names itself", async () => {
  expect(await until(() => v.up)).toBe(true);
  expect(hello?.auth).toBe("Bearer tok");
  expect(hello?.query).toContain("&device=box");
  expect(hello?.host).toBe("127.0.0.1:8788");
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

// RED ZONE (security review U1, DRAFT awaiting the user's sign-off): any
// process may take 127.0.0.1:<port>, so a device never speaks TCP to its
// server: its session goes over <dir>/server.sock only. A squatter on the
// port (one relaying the real server's answers, the old proof's hole)
// gets nothing; no socket: it says so and tries again, never over TCP;
// the server restarted, it connects again
test("a device sends its session only over the server's unix socket: never to the TCP port, again after a restart", async () => {
  const squat: string[] = [];
  const squatter = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, s) {
      squat.push(req.method + " " + new URL(req.url).pathname + " " + String(req.headers.get("authorization")));
      return s.upgrade(req) ? undefined : new Response("ok");
    },
    websocket: { open: (ws) => ws.send(JSON.stringify({ $: "view", parts: [], turn: 0 })), message: () => {} },
  });
  const dir = dir0700();
  const auths: string[] = [];
  const real = () => Bun.serve({
    unix: dir + "/server.sock",
    fetch(req, s) {
      auths.push(req.method + " " + new URL(req.url).pathname + " " + String(req.headers.get("authorization")));
      return s.upgrade(req) ? undefined : Response.json({ ok: true });
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ $: "view", parts: [], turn: 0 }));
      },
      message(ws, data) {
        ws.send(JSON.stringify({ $: "ack", id: JSON.parse(String(data)).id }));
      },
    },
  });
  let srv: ReturnType<typeof real> | null = null;
  try {
    const wire = Device.device_wire("http://127.0.0.1:" + squatter.port, dir);
    const logs: string[] = [];
    const d = Device.device_open(wire, { authorization: "Bearer sec" }, "&device=p", { work: "~/w", computer: false, run, spaces: [] }, (l) => logs.push(l));
    await Bun.sleep(1500);
    expect(d.up).toBe(false);
    expect(logs.join("\n")).toContain(Device.NO_SOCKET);
    expect(logs.filter((l) => l === Device.NO_SOCKET)).toHaveLength(1);
    // the real server up: its socket gets the session, the port nothing
    srv = real();
    expect(await until(() => d.up)).toBe(true);
    expect(auths.some((a) => a.startsWith("GET /ws Bearer sec"))).toBe(true);
    // a post goes over the socket too
    expect((await Device.device_fetch(wire, "/api/act", { method: "POST", headers: { authorization: "Bearer sec" }, body: "{}" })).ok).toBe(true);
    expect(auths).toContain("POST /api/act Bearer sec");
    // restarted: down, then up again on the socket
    srv.stop(true);
    fs.rmSync(dir + "/server.sock", { force: true });
    expect(await until(() => !d.up)).toBe(true);
    auths.length = 0;
    srv = real();
    expect(await until(() => d.up)).toBe(true);
    expect(auths.some((a) => a.startsWith("GET /ws Bearer sec"))).toBe(true);
    expect(squat).toEqual([]);
  } finally {
    srv?.stop(true);
    squatter.stop(true);
  }
}, 20_000);

// RED ZONE U1: a socket path Bun can't open as is (a ':' is read as its
// end; past macOS's 104 bytes) is refused, not opened elsewhere; with no
// socket a fetch fails, never falling back to TCP
test("device_wire refuses a socket path with ':' or too long; device_fetch with no socket fails", async () => {
  expect(() => Device.device_wire("http://127.0.0.1:8788", "/tmp/a:b")).toThrow();
  expect(() => Device.device_wire("http://127.0.0.1:8788", "/tmp/" + "x".repeat(100))).toThrow();
  expect(() => Device.device_wire("http://example.com:8788", "/tmp/ok")).toThrow();
  const squat: string[] = [];
  const squatter = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => (squat.push(String(req.headers.get("authorization"))), new Response("ok")) });
  try {
    const wire = Device.device_wire("http://127.0.0.1:" + squatter.port, dir0700());
    expect(await Device.device_fetch(wire, "/api/me", { headers: { authorization: "Bearer sec" } }).then(() => "answered", () => "failed")).toBe("failed");
    // a redirect off the socket (to the port) is refused, not followed
    const away = Bun.serve({ unix: wire.sock, fetch: () => new Response(null, { status: 307, headers: { location: wire.url + "/api/me" } }) });
    try {
      expect(await Device.device_fetch(wire, "/api/me", { headers: { authorization: "Bearer sec" } }).then(() => "answered", () => "failed")).toBe("failed");
    } finally {
      away.stop(true);
    }
    expect(squat).toEqual([]);
  } finally {
    squatter.stop(true);
  }
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
  // the space and its worktrees: real dirs, this user's (git runs only in such)
  const S = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-inbox-")) + "/s";
  for (const w of ["", "/.wt/x", "/.wt/y", "/.wt/z"]) {
    fs.mkdirSync(S + w, { recursive: true });
  }
  const exec: Device.Exec = async (cmd) => {
    ran.push(cmd);
    const line = cmd.join(" ");
    if (line.startsWith("gh api graphql") && !line.includes("digest")) {
      return { code: 0, out: JSON.stringify({ data: { viewer: { login: "me" }, reviews: { nodes: [] }, mine: { nodes: [pr] }, merged: { issueCount: 4 }, today: { issueCount: 1 } } }) };
    }
    if (line.startsWith("gh api notifications")) {
      return { code: 0, out: JSON.stringify([{ reason: "assign", unread: true, updated_at: "", repository: { full_name: "o/r" }, subject: { title: "N", url: "" } }]) };
    }
    if (line.startsWith("acli")) {
      return { code: 1, out: "✗ Error: unauthorized: use 'acli jira auth login' to authenticate" };
    }
    if (line.includes("worktree list")) {
      return { code: 0, out: `worktree ${S}\nbranch refs/heads/main\n\nworktree ${S}/.wt/x\nbranch refs/heads/x\n\nworktree ${S}/.wt/y\nbranch refs/heads/y\n\nworktree ${S}/.wt/z\nbranch refs/heads/z\n` };
    }
    if (line.includes("remote get-url upstream")) {
      return cmd.includes(S) ? { code: 0, out: "git@github.com:up/s.git\n" } : { code: 2, out: "error: No such remote 'upstream'" };
    }
    if (line.includes("remote get-url")) {
      return { code: 0, out: "git@github.com:o/s.git\n" };
    }
    if (line.startsWith("gh api graphql") && line.includes("digest")) {
      return { code: 0, out: JSON.stringify({ data: { merged: { nodes: [{ number: 9, title: "M", url: "https://github.com/o/s/pull/9", repository: { nameWithOwner: "o/s" }, author: { login: "bo" }, mergedAt: "2026-11-11T00:00:00Z" }] }, open: { nodes: [] } } }) };
    }
    if (line.includes("rev-parse")) {
      return { code: 0, out: "origin/main\n" };
    }
    if (line.includes("branch --merged")) {
      return { code: 0, out: "main\ny\n" };
    }
    if (line.includes("status --porcelain")) {
      return { code: 0, out: cmd.includes(S + "/.wt/x") ? " M a\n?? b\n" : "" };
    }
    return { code: 1, out: "" };
  };
  // no Google here (Google's own test below; never the real Keychain)
  const nog: Device.Reads = { events: async () => [], docs: async () => [], text: async () => "" };
  const msg = await Device.device_inbox({ work: "/w", computer: false, spaces: [S] }, exec, new Date(2026, 10, 12), nog) as any;
  expect(msg.$).toBe("inbox");
  const inbox = msg.inbox;
  expect(inbox.login).toBe("me");
  expect(inbox.mine.map((p: any) => p.number)).toEqual([3]);
  expect([inbox.merged, inbox.today]).toEqual([4, 1]);
  expect(inbox.notes.map((n: any) => n.kind)).toEqual(["assign"]);
  expect(inbox.tickets).toBe(null);
  expect(inbox.digest).toMatchObject({ repos: ["up/s"], merged: [{ number: 9, author: "bo" }], open: [] }); // a fork's upstream, where the team's PRs are
  expect(inbox.spaces).toEqual(["s"]);
  expect(inbox.errors).toEqual(["acli: ✗ Error: unauthorized: use 'acli jira auth login' to authenticate"]);
  // x has changes, y is merged and clean, z is clean and not merged (left out)
  expect(inbox.clean).toEqual([
    { repo: "s", path: S + "/.wt/x", branch: "x", changes: 2, merged: false },
    { repo: "s", path: S + "/.wt/y", branch: "y", changes: 0, merged: true },
  ]);
  // what it ran reads only: no write, no push
  expect(ran.every((c) => ["gh", "acli", "git"].includes(c[0]))).toBe(true);
  expect(ran.some((c) => c.filter((a) => !a.startsWith("query=")).join(" ").match(/\b(push|commit|create|edit|delete|POST)\b/))).toBe(false);
  // gh missing: said, the rest still read
  const none = await Device.device_inbox({ work: "/w", computer: false, spaces: [] }, async (cmd) => (cmd[0] === "gh" ? { code: 127, out: "not found" } : exec(cmd)), new Date(), nog) as any;
  expect(none.inbox.errors.some((e: string) => e.startsWith("gh: "))).toBe(true);
  expect(none.inbox.mine).toEqual([]);
  // no space on GitHub: no digest, and its search not run
  ran.length = 0;
  const bare = await Device.device_inbox({ work: "/w", computer: false, spaces: [] }, exec, new Date(), nog) as any;
  expect(bare.inbox.digest).toBe(null);
  expect(ran.some((c) => c.join(" ").includes("query digest"))).toBe(false);
});

// spaces found, not listed: git repos under the roots (UNII_SPACES; by
// default /Volumes/dev/git and ~/.claude) and the home repo, 4 folders
// deep at most, not inside a repo, node_modules or a hidden folder; a
// linked worktree (its .git a file) not a space; newest activity first;
// active: its git files changed in the last 14 days
test("spaces are found under the roots, newest first; active ones by their git files", () => {
  const root = fs.mkdtempSync(os.tmpdir() + "/legion-roots-");
  const repo = (p: string, days: number) => {
    fs.mkdirSync(root + "/" + p + "/.git", { recursive: true });
    fs.writeFileSync(root + "/" + p + "/.git/HEAD", "ref: refs/heads/main\n");
    const t = new Date(Date.now() - days * 86400e3);
    fs.utimesSync(root + "/" + p + "/.git/HEAD", t, t);
  };
  repo("a", 1);
  repo("team/b", 0);
  repo("a/inner", 0);             // inside a repo: not looked for
  repo("node_modules/x", 0);      // skipped
  repo("team/.hidden/y", 0);      // skipped
  repo("old", 30);
  repo("w/x/y/z/deep", 0);        // 5 deep: past the limit
  fs.mkdirSync(root + "/wt");
  fs.writeFileSync(root + "/wt/.git", "gitdir: " + root + "/a/.git/worktrees/wt\n"); // a linked worktree
  const found = Device.device_discover([root], Date.now());
  expect(found.map((s) => s.path.slice(root.length + 1))).toEqual(["team/b", "a", "old"]);
  expect(found.map((s) => Device.device_active(s, Date.now()))).toEqual([true, true, false]);
  // the home repo always, once, first; a root that is a repo is a space
  const home = Device.device_discover([root + "/a", root], Date.now(), root + "/old");
  expect(home.map((s) => s.path.slice(root.length + 1))).toEqual(["old", "team/b", "a"]);
  expect(Device.device_roots(undefined)).toEqual(["/Volumes/dev/git", os.homedir() + "/.claude"]);
  expect(Device.device_roots(" ~/x , /y ")).toEqual([os.homedir() + "/x", "/y"]);
});

// Google (RED ZONE draft, Google.ts): the device reads today's and
// tomorrow's events and the transcript Docs with the user's grant; signed
// out or failing: nothing from Google, the reason said (fail closed); a
// transcript's text only when the server asks for that Doc
test("Google on the device: events and Docs with the inbox; signed out said; a transcript read only when asked", async () => {
  const quiet: Device.Exec = async () => ({ code: 1, out: "" });
  const g: Device.Reads = {
    events: async () => [{ id: "e1", title: "Weekly", start: "2026-11-12T13:30:00Z", end: "", meet: "https://meet.google.com/abc", people: 3 }],
    docs: async () => [{ id: "doc_1234567890", title: "Standup - Transcript", at: "", url: "https://docs.google.com/document/d/doc_1234567890" }],
    text: async (id) => "said in " + id,
  };
  const m = await Device.device_inbox({ work: "/w", computer: false, spaces: [] }, quiet, new Date(), g) as any;
  expect(m.inbox.google).toEqual({ events: await g.events(new Date()), docs: await g.docs(new Date()) });
  const out = await Device.device_inbox({ work: "/w", computer: false, spaces: [] }, quiet, new Date(), { ...g, events: async () => { throw new Error("not signed in: legion google-login"); } }) as any;
  expect(out.inbox.google).toBe(null);
  expect(out.inbox.errors).toContain("google: not signed in: legion google-login");
  // one read failing: none of Google's shown (fail closed), not half
  const half = await Device.device_inbox({ work: "/w", computer: false, spaces: [] }, quiet, new Date(), { ...g, docs: async () => { throw new Error("Google: HTTP 403."); } }) as any;
  expect(half.inbox.google).toBe(null);
  expect(await Device.device_transcript("doc_1234567890", g)).toEqual({ $: "transcript", id: "doc_1234567890", text: "said in doc_1234567890" });
  expect(await Device.device_transcript("doc_1234567890", { ...g, text: async () => { throw new Error("Google: HTTP 403."); } })).toEqual({ $: "transcript", id: "doc_1234567890", error: "Google: HTTP 403." });
});

// the reads every device does for the cockpit (the terminal's and legion
// device's alike): the inbox at once and on "fetch", a transcript on "read"
test("device_reads reads the inbox at once and on fetch, a transcript on read", async () => {
  const sent: any[] = [];
  const run: Device.Exec = async () => ({ code: 1, out: "no" });
  const g: Device.Reads = { events: async () => [], docs: async () => [], text: async (id) => "said in " + id };
  const heard = Device.device_reads({ work: "/w", computer: false, spaces: [] }, (m) => sent.push(m), run, g, 0);
  await Bun.sleep(30);
  expect(sent.filter((m) => m.$ === "inbox").length).toBe(1);
  heard({ $: "fetch" } as any);
  heard({ $: "state" } as any);
  await Bun.sleep(30);
  expect(sent.filter((m) => m.$ === "inbox").length).toBe(2);
  heard({ $: "read", id: "doc1" } as any);
  await Bun.sleep(30);
  expect(sent.filter((m) => m.$ === "transcript")).toEqual([{ $: "transcript", id: "doc1", text: "said in doc1" }]);
});

// the timesheet's Submit on the device (K5, RED ZONE): each entry the
// server sent posted once, in order, with the kept token; each one's
// Harvest id or why not; signed out: all fail, none posted
test("device_harvest posts each submitted entry once; signed out, none", async () => {
  const posted: any[] = [];
  const h: Device.Posts = {
    creds: async () => ({ token: "t", account: "1" }),
    post: async (_c, e) => {
      posted.push(e);
      if (e.hours === 3) {
        throw new Error("Harvest: HTTP 422.");
      }
      return { id: 100 + posted.length };
    },
  };
  const e = { project_id: 7, task_id: 70, date: "2026-11-12", hours: 1, notes: "x" };
  const out = await Device.device_harvest("h2", [{ n: 1, ...e }, { n: 4, ...e, hours: 3 }, { n: 5, ...e, hours: 99 }, "junk"] as any, h);
  expect(out).toEqual({ $: "harvested", id: "h2", results: [{ n: 1, id: 101 }, { n: 4, error: "Harvest: HTTP 422." }, { n: 5, error: expect.stringContaining("hours") }] });
  expect(posted.map((p) => p.hours)).toEqual([1, 3]);
  const none = await Device.device_harvest("h3", [{ n: 1, ...e }], { ...h, creds: async () => { throw new Error("not signed in to Harvest: legion harvest-login"); } });
  expect(none).toEqual({ $: "harvested", id: "h3", results: [{ n: 1, error: "not signed in to Harvest: legion harvest-login" }] });
  expect(posted).toHaveLength(2);
});

// the files pane and git tab (K4, Terax-like, read-only): a device shows a
// file or a repo's git only under its roots (its work dir, home repo,
// spaces), symlinks followed first; never a secret's file, a binary or one
// past LOOK_BYTES; git by fixed commands, a revision checked
test("device_look: files and git under the device's roots only, read-only", async () => {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-look-"));
  const work = top + "/work", repo = top + "/repo", out = top + "/out";
  fs.mkdirSync(work + "/Owl", { recursive: true });
  fs.mkdirSync(out);
  Bun.spawnSync(["git", "init", "-q", "-b", "trunk", repo]);
  fs.writeFileSync(repo + "/a.ts", "export const a = 1;\n");
  fs.writeFileSync(repo + "/.env", "KEY=x");
  fs.writeFileSync(repo + "/big.txt", "x".repeat(Device.LOOK_BYTES + 1));
  fs.writeFileSync(repo + "/bin.dat", Buffer.from([1, 0, 2]));
  fs.writeFileSync(out + "/other.txt", "outside");
  fs.symlinkSync(out + "/other.txt", repo + "/link.txt");
  fs.symlinkSync(repo + "/.env", repo + "/cfg.txt");   // an innocent name, a secret behind it
  fs.symlinkSync(repo + "/a.ts", repo + "/.env.local"); // a secret's name, whatever is behind it
  fs.writeFileSync(work + "/Owl/notes.md", "# hi");
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  git("add", "a.ts");
  git("commit", "-q", "-m", "first");
  const rules = { work, computer: false, spaces: [repo] };
  const look = (what: any) => Device.device_look(rules, "r1", what) as Promise<any>;
  expect(await look({ kind: "file", path: repo + "/a.ts" })).toEqual({ $: "looked", id: "r1", kind: "file", path: repo + "/a.ts", hash: expect.stringMatching(/^[0-9a-f]{64}$/), text: "export const a = 1;\n" });
  // an agent's relative path, from its own dir under the work dir
  expect((await look({ kind: "file", path: "notes.md", agent: "Owl" })).text).toBe("# hi");
  for (const [path, why] of [[out + "/other.txt", "not under"], [repo + "/link.txt", "not under"], [repo + "/../out/other.txt", "not under"], [repo + "/.env", "secret"], [repo + "/big.txt", "too big"], [repo + "/bin.dat", "binary"], [repo + "/none.ts", "No file"]]) {
    const r = await look({ kind: "file", path });
    expect([path, r.text, String(r.error)]).toEqual([path, undefined, expect.stringContaining(why!)]);
  }
  expect((await look({ kind: "file", path: "x", agent: "../../etc" })).error).toBe("Not an agent's name.");
  expect((await look({ kind: "file", path: repo + "/cfg.txt" })).error).toContain("secret");
  expect((await look({ kind: "file", path: repo + "/.env.local" })).error).toContain("secret");
  // security review L: a repo's git config, a token, service-account keys
  for (const f of ["token", "sa-key.json", "my-service-account.json", "gcp-credentials.json"]) {
    fs.writeFileSync(repo + "/" + f, "{}");
  }
  for (const p of [repo + "/.git/config", repo + "/token", repo + "/sa-key.json", repo + "/my-service-account.json", repo + "/gcp-credentials.json"]) {
    expect([p, String((await look({ kind: "file", path: p })).error)]).toEqual([p, expect.stringContaining("secret")]);
  }
  // git: status, log, a commit, the working tree's diff; a bad rev refused
  fs.writeFileSync(repo + "/a.ts", "export const a = 2;\n");
  expect((await look({ kind: "git", repo, op: "status" })).text).toContain("a.ts");
  const log = (await look({ kind: "git", repo, op: "log" })).text as string;
  expect(log).toContain("first");
  const sha = log.trim().split(/\s/)[0]!;
  expect((await look({ kind: "git", repo, op: "show", rev: sha })).text).toContain("export const a = 1;");
  expect((await look({ kind: "git", repo, op: "diff" })).text).toContain("+export const a = 2;");
  expect((await look({ kind: "git", repo, op: "show", rev: "--output=/tmp/x" })).error).toContain("revision");
  expect((await look({ kind: "git", repo, op: "push" })).error).toContain("No git view");
  expect((await look({ kind: "git", repo, op: "constructor" })).error).toContain("No git view");
  expect((await look({ kind: "git", repo: out, op: "log" })).error).toContain("not under");
  // a file's own repo; the home repo by @home
  expect((await look({ kind: "git", repo: repo + "/a.ts", op: "log" })).path).toBe(repo);
  expect((await Device.device_look({ ...rules, home: repo }, "r2", { kind: "git", repo: "@home", op: "log" }) as any).text).toContain("first");
});

// security review L: every git a device runs is hardened (no fsmonitor,
// hooks, external diff, pager; no textconv where a diff shows), and runs
// only in a repo of this user's whose own config names no filter or
// textconv driver. A crafted repo's drivers would write a marker: none does
test("device git: a crafted repo's fsmonitor, textconv and filter never run", async () => {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-git-"));
  const mark = (k: string) => top + "/ran-" + k;
  const repo = (name: string, setup: (r: string) => void) => {
    const r = top + "/" + name;
    Bun.spawnSync(["git", "init", "-q", "-b", "trunk", r]);
    fs.writeFileSync(r + "/a.txt", "one\n");
    const g = (...a: string[]) => Bun.spawnSync(["git", "-C", r, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
    setup(r);
    g("add", "-A");
    g("commit", "-q", "-m", "first");
    // a worktree with a change, for the inbox's cleanup (its status)
    g("worktree", "add", "-q", "-b", "wt", r + "-wt");
    fs.writeFileSync(r + "-wt/a.txt", "two\n");
    fs.writeFileSync(r + "/a.txt", "two\n");
    return r;
  };
  const hook = (k: string) => {
    const f = top + "/hook-" + k + ".sh";
    fs.writeFileSync(f, "#!/bin/sh\ntouch '" + mark(k) + "'\ncat \"$@\" 2>/dev/null\n");
    fs.chmodSync(f, 0o755);
    return f;
  };
  const cfg = (r: string, k: string, v: string) => Bun.spawnSync(["git", "-C", r, "config", k, v]);
  // fsmonitor: in the repo's own config, which hardening overrides
  const fsm = repo("fsm", () => {});
  cfg(fsm, "core.fsmonitor", hook("fsm"));
  // textconv and a clean filter: the repo's own config names them: refused
  const evil = repo("evil", (r) => fs.writeFileSync(r + "/.gitattributes", "*.txt diff=evil filter=evil\n"));
  cfg(evil, "diff.evil.textconv", hook("textconv"));
  cfg(evil, "filter.evil.clean", hook("clean"));
  // a textconv of the user's own global config: trusted, yet no textconv
  // shown (its own process: Bun's spawns keep the environment they began with)
  const glob = repo("glob", (r) => fs.writeFileSync(r + "/.gitattributes", "*.txt diff=mine\n"));
  const global = top + "/gitconfig";
  fs.writeFileSync(global, "[diff \"mine\"]\n\ttextconv = " + hook("global") + "\n");
  // a worktree whose own config (config.worktree) names a filter: that
  // worktree refused, its repo not
  const wtc = repo("wtc", (r) => fs.writeFileSync(r + "/.gitattributes", "*.txt filter=evil\n"));
  cfg(wtc, "extensions.worktreeConfig", "true");
  Bun.spawnSync(["git", "-C", wtc + "-wt", "config", "--worktree", "filter.evil.clean", hook("wtclean")]);
  const genv = { ...process.env, GIT_CONFIG_GLOBAL: global };
  // the crafted repos are live: plain git runs their drivers
  Bun.spawnSync(["git", "-C", fsm, "status"]);
  Bun.spawnSync(["git", "-C", evil, "diff", "HEAD"]);
  Bun.spawnSync(["git", "-C", glob, "diff", "HEAD"], { env: genv });
  Bun.spawnSync(["git", "-C", wtc + "-wt", "status"]);
  expect(["fsm", "textconv", "clean", "global", "wtclean"].map((k) => fs.existsSync(mark(k)))).toEqual([true, true, true, true, true]);
  ["fsm", "textconv", "clean", "global", "wtclean"].forEach((k) => fs.rmSync(mark(k)));
  const rules = { work: top, computer: false, spaces: [fsm, evil, glob, wtc] };
  const look = (what: any) => Device.device_look(rules, "g", what) as Promise<any>;
  expect((await look({ kind: "git", repo: fsm, op: "status" })).text).toContain("a.txt");
  expect((await look({ kind: "git", repo: fsm, op: "diff" })).text).toContain("+two");
  for (const op of ["status", "diff", "show", "log"]) {
    expect((await look({ kind: "git", repo: evil, op })).error).toContain("filter or textconv");
  }
  const code = `import * as Device from "./Device.ts"; const r = { work: "${top}", computer: false, spaces: ["${glob}"] };
    console.log(JSON.stringify([(await Device.device_look(r, "g", { kind: "git", repo: "${glob}", op: "diff" })).text, (await Device.device_look(r, "g", { kind: "git", repo: "${glob}", op: "show" })).text]));`;
  const shown = JSON.parse(Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: genv }).stdout.toString());
  expect(shown[0]).toContain("+two");
  expect(shown[1]).toContain("+one");
  // the inbox's git (worktrees, status) too
  const nog: Device.Reads = { events: async () => [], docs: async () => [], text: async () => "" };
  const gits: string[][] = [];
  const gitonly: Device.Exec = async (cmd) => (cmd[0] === "git" ? (gits.push(cmd), Device.exec(cmd)) : { code: 1, out: "" });
  const inbox = await Device.device_inbox(rules, gitonly, new Date(), nog) as any;
  expect(inbox.inbox.clean.map((c: any) => c.path).sort()).toEqual([fsm + "-wt", glob + "-wt"]);
  // a refused repo: no git there but the trust check (and its remote, read for the digest)
  expect(gits.filter((c) => c[2] === evil && !c.includes("config") && !c.includes("remote"))).toEqual([]);
  expect(["fsm", "textconv", "clean", "global", "wtclean"].map((k) => fs.existsSync(mark(k)))).toEqual([false, false, false, false, false]);
  // a dir not this user's: git never runs there
  expect(await Device.device_trusted("/", Device.exec)).toBe(false);
  expect(await Device.device_trusted(fsm, Device.exec)).toBe(true);
  expect(await Device.device_trusted(evil, Device.exec)).toBe(false);
});

// a space's worktrees beside it (<repo>-worktrees/<slug>, local/rules.md)
// show too; not a worktree elsewhere, nor a stray folder there
test("device_look: a space's worktrees at <repo>-worktrees/<slug> only", async () => {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-wt-"));
  const repo = top + "/repo", beside = top + "/repo-worktrees", far = top + "/elsewhere";
  Bun.spawnSync(["git", "init", "-q", "-b", "trunk", repo]);
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  fs.writeFileSync(repo + "/a.ts", "1\n");
  git("add", "a.ts");
  git("commit", "-q", "-m", "first");
  git("worktree", "add", "-q", "-b", "fix/one", beside + "/one");
  git("worktree", "add", "-q", "-b", "fix/two", far + "/two");
  fs.mkdirSync(beside + "/stray");
  fs.writeFileSync(beside + "/stray/s.txt", "stray");
  fs.writeFileSync(beside + "/one/b.ts", "2\n");
  const rules = { work: top + "/work", computer: false, spaces: [repo] };
  fs.mkdirSync(rules.work);
  const look = (what: any) => Device.device_look(rules, "w", what) as Promise<any>;
  expect((await look({ kind: "file", path: beside + "/one/b.ts" })).text).toBe("2\n");
  expect((await look({ kind: "git", repo: beside + "/one", op: "status" })).text).toContain("b.ts");
  expect((await look({ kind: "file", path: far + "/two/a.ts" })).error).toContain("not under");
  expect((await look({ kind: "file", path: beside + "/stray/s.txt" })).error).toContain("not under");
  expect((await look({ kind: "file", path: beside + "/one/.env" })).error).toContain("secret");
  // a repo whose folder is named x.git keeps its worktrees at x-worktrees
  const bare = top + "/pay.git";
  Bun.spawnSync(["git", "init", "-q", "-b", "trunk", bare]);
  Bun.spawnSync(["git", "-C", bare, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first"]);
  Bun.spawnSync(["git", "-C", bare, "worktree", "add", "-q", "-b", "fix/p", top + "/pay-worktrees/p"]);
  fs.writeFileSync(top + "/pay-worktrees/p/c.ts", "3\n");
  expect((await Device.device_look({ ...rules, spaces: [bare] }, "w", { kind: "file", path: top + "/pay-worktrees/p/c.ts" }) as any).text).toBe("3\n");
});

// the files explorer: a folder's entries under the roots (folders first,
// .git never, a secret's marked "s": listed, never shown); @roots: the
// roots themselves; a file opened in the user's editor, a secret's too
// (its text never leaves the computer), only under the roots, only a file
test("device_look: folders listed and files opened in the editor, under the roots only", async () => {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-dir-"));
  const repo = top + "/repo", work = top + "/work";
  fs.mkdirSync(work);
  Bun.spawnSync(["git", "init", "-q", "-b", "trunk", repo]);
  fs.mkdirSync(repo + "/src");
  fs.writeFileSync(repo + "/b.ts", "b");
  fs.writeFileSync(repo + "/.env", "K=v");
  fs.writeFileSync(repo + "/.gitignore", "x");
  const opened: string[] = [];
  const rules = { work, computer: false, spaces: [repo] };
  const look = (what: any) => Device.device_look(rules, "d", what, async (f) => (opened.push(f), "VS Code")) as Promise<any>;
  expect((await look({ kind: "dir", path: repo })).text).toBe("d src\ns .env\nf .gitignore\nf b.ts");
  expect((await look({ kind: "dir", path: repo })).path).toBe(repo);
  const roots = (await look({ kind: "dir", path: "@roots" })).text.split("\n");
  expect(roots).toContain("d " + repo);
  expect(roots).toContain("d " + work);
  expect((await look({ kind: "dir", path: top })).error).toContain("not under");
  expect((await look({ kind: "dir", path: repo + "/b.ts" })).error).toContain("not a folder");
  expect(await look({ kind: "open", path: repo + "/.env" })).toEqual({ $: "looked", id: "d", kind: "open", path: repo + "/.env", text: "Opened .env in VS Code." });
  expect((await look({ kind: "open", path: top + "/x" })).error).toContain("No file");
  expect((await look({ kind: "open", path: repo + "/src" })).error).toContain("not a file");
  expect(opened).toEqual([repo + "/.env"]);
});

// an agent's changes: its branch's work since it left the default branch
// (origin/HEAD, else main or master), committed or not; none: said
test("device_look: a repo's changes since its default branch, committed or not", async () => {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-chg-"));
  const repo = top + "/repo";
  Bun.spawnSync(["git", "init", "-q", "-b", "main", repo]);
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  fs.writeFileSync(repo + "/a.ts", "base\n");
  git("add", "a.ts");
  git("commit", "-q", "-m", "base");
  git("switch", "-q", "-c", "feat/x");
  fs.writeFileSync(repo + "/b.ts", "committed\n");
  git("add", "b.ts");
  git("commit", "-q", "-m", "feat");
  fs.writeFileSync(repo + "/a.ts", "base\nworking\n");
  const rules = { work: top, computer: false, spaces: [repo] };
  const out = await Device.device_look(rules, "c", { kind: "git", repo, op: "changes" }) as any;
  expect(out.text).toContain("+committed");
  expect(out.text).toContain("+working");
  expect(out.text).not.toContain("+base");
  git("branch", "-q", "-m", "main", "trunk");
  expect((await Device.device_look(rules, "c", { kind: "git", repo, op: "changes" }) as any).error).toContain("No default branch");
});

// quick open and search (⌘P, ⌘⇧F) in a workspace's repo: its files by
// a fuzzy name, their lines by a text (any case); a secret's never told
test("device_look: find a repo's files by name, search their text; secrets never", async () => {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-find-"));
  const repo = top + "/repo";
  Bun.spawnSync(["git", "init", "-q", "-b", "main", repo]);
  fs.mkdirSync(repo + "/src");
  fs.writeFileSync(repo + "/src/config_scan.py", "def scan():\n    return 'Needle'\n");
  fs.writeFileSync(repo + "/src/other.py", "x = 1\naxb\n");
  fs.writeFileSync(repo + "/.env", "needle=1\n");
  const rules = { work: top + "/w", computer: false, spaces: [repo] };
  fs.mkdirSync(rules.work);
  const look = (what: any) => Device.device_look(rules, "q", what) as Promise<any>;
  expect(await look({ kind: "find", path: repo, q: "cfgscan" })).toEqual({ $: "looked", id: "q", kind: "find", path: repo, q: "cfgscan", text: "src/config_scan.py" });
  expect((await look({ kind: "find", path: repo, q: "env" })).text).toBe("");
  expect(await look({ kind: "grep", path: repo, q: "needle" })).toEqual({ $: "looked", id: "q", kind: "grep", path: repo, q: "needle", text: "src/config_scan.py:2:    return 'Needle'" });
  expect((await look({ kind: "grep", path: repo, q: "-e" })).text).toBe("");
  expect((await look({ kind: "grep", path: repo, q: "a.b" })).text).toBe(""); // as typed, not a pattern
  expect((await look({ kind: "grep", path: top, q: "x" })).error).toContain("not under");
  expect((await look({ kind: "find", path: top + "/../", q: "x" })).error).toContain("not under");
});

// a file saved as the user edited it in the browser (RED ZONE): only one
// shown (its hash as shown), under the roots, not a secret's, not Claude
// Code's or Legion's settings; changed since: refused
test("device_look: a file saved as edited, only as it was shown, never a secret's or a setting", async () => {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-save-"));
  const repo = top + "/repo";
  fs.mkdirSync(repo + "/.claude", { recursive: true });
  fs.writeFileSync(repo + "/a.ts", "one\n");
  fs.writeFileSync(repo + "/.env", "K=v\n");
  fs.writeFileSync(repo + "/.claude/settings.json", "{}");
  fs.writeFileSync(top + "/out.ts", "out\n");
  const rules = { work: top + "/w", computer: false, spaces: [repo] };
  fs.mkdirSync(rules.work);
  const look = (what: any) => Device.device_look(rules, "s", what) as Promise<any>;
  const shown = await look({ kind: "file", path: repo + "/a.ts" });
  expect(shown.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(await look({ kind: "save", path: repo + "/a.ts", text: "two\n", base: shown.hash })).toMatchObject({ kind: "save", path: repo + "/a.ts", text: "Saved a.ts." });
  expect(fs.readFileSync(repo + "/a.ts", "utf8")).toBe("two\n");
  expect((await look({ kind: "save", path: repo + "/a.ts", text: "three\n", base: shown.hash })).error).toContain("changed");
  expect(fs.readFileSync(repo + "/a.ts", "utf8")).toBe("two\n");
  const h = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
  expect((await look({ kind: "save", path: repo + "/.env", text: "K=x\n", base: h("K=v\n") })).error).toContain("secret");
  expect((await look({ kind: "save", path: repo + "/.claude/settings.json", text: "{\"x\":1}", base: h("{}") })).error).toContain("settings");
  // an innocent name for a secret's file: its real path refused too
  fs.symlinkSync(repo + "/.env", repo + "/notes.txt");
  expect((await look({ kind: "save", path: repo + "/notes.txt", text: "K=x\n", base: h("K=v\n") })).error).toContain("secret");
  expect((await look({ kind: "save", path: top + "/out.ts", text: "x", base: h("out\n") })).error).toContain("not under");
  expect((await look({ kind: "save", path: repo + "/a.ts", text: "x".repeat(Device.LOOK_BYTES + 1), base: h("two\n") })).error).toContain("too big");
  expect(fs.readFileSync(repo + "/.env", "utf8")).toBe("K=v\n");
  expect(fs.readFileSync(top + "/out.ts", "utf8")).toBe("out\n");
});

// find ranks a name holding the query's letters before a path holding them
test("device_look: find ranks a file's name before its path", async () => {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-rank-"));
  const repo = top + "/repo";
  Bun.spawnSync(["git", "init", "-q", "-b", "main", repo]);
  fs.mkdirSync(repo + "/configs/scanners", { recursive: true });
  fs.writeFileSync(repo + "/configs/scanners/x.py", "");
  fs.mkdirSync(repo + "/src/deep/er", { recursive: true });
  fs.writeFileSync(repo + "/src/deep/er/config_scan.py", "");
  const rules = { work: top, computer: false, spaces: [repo] };
  expect(((await Device.device_look(rules, "r", { kind: "find", path: repo, q: "cfgscan" } as any)) as any).text).toBe("src/deep/er/config_scan.py\nconfigs/scanners/x.py");
});
