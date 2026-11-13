// Device
// ======
// This computer as a device: it runs the server's jobs here
// (Machine.run) and answers their output. The terminal (Term.ts) is one,
// and `legion device` is one with no screen, so the agents' shells work
// while no terminal is open. Both keep the same rules (Rules): computer
// use only where allowed (UNII_COMPUTER=1), an output too large for a
// socket message refused by its size, a job the server no longer lists
// stopped. Approvals stay the server's (a Claude Code worker waits for
// the person's ✓, from the web or a terminal), so a device asks nothing.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Cost from "./Cost.ts";
import { Google } from "./Google.ts";
import * as Inbox from "./Inbox.ts";
import { Machine, type Job } from "./Machine.ts";
import * as View from "./View.ts";

// a job running here: its stop, its send to the background (a shell's),
// its tool's name
export type Run = { abort: AbortController; away: AbortController; name: string };

// where jobs work (the device's work dir; its home repo, Unii's own),
// whether it does computer use, what runs a job (Machine.run; a test's),
// the repos the cockpit shows (its spaces: UNII_SPACES; none: the home repo)
export type Rules = { work: string; home?: string; computer: boolean; run?: typeof Machine.run; spaces?: string[] };

export const NO_COMPUTER = "This device does no computer use (UNII_COMPUTER=1 lets it).";

// the server's word on this device's jobs: a job, run unless it runs or
// its output waits for an answer; or their ids, the rest stopped
export function device_jobs(v: View.View, jobs: Map<string, Run>, msg: View.Server & { $: "jobs" | "job" }, rules: Rules, send: (msg: View.Client) => void): void {
  if (msg.$ === "job") {
    const sent = v.out.some((p) => p.msg.$ === "out" && p.msg.job === msg.id);
    if (!jobs.has(msg.id) && !sent) {
      void device_run(jobs, msg.id, msg.job as Job, rules, send);
    }
    return;
  }
  for (const [id, run] of jobs) {
    if (!msg.ids.includes(id)) {
      run.abort.abort();
    }
  }
}

// runs a job here, and answers its output; one too large for a socket
// message (View.FRAME, the 1 KiB left for the act around it) answers its
// size instead, failed (sent, it would close the socket at every try)
export async function device_run(jobs: Map<string, Run>, id: string, job: Job, rules: Rules, send: (msg: View.Client) => void): Promise<void> {
  const abort = new AbortController();
  const away  = new AbortController();
  jobs.set(id, { abort, away, name: job.name });
  const run  = rules.run ?? Machine.run;
  const out  = job.name === "computer" && !rules.computer ? { text: NO_COMPUTER, fail: true } : await run(job, rules.work, abort.signal, away.signal, rules.home);
  const size = Buffer.byteLength(JSON.stringify(out));
  const most = View.FRAME - 1024;
  const big  = { text: "The output, " + size + " bytes, is over the " + most + " a tool may send.", fail: true };
  jobs.delete(id);
  send({ $: "out", job: id, out: size > most ? big : out });
}

// how often a device reports its status (ms)
export const STATUS_EVERY = 60_000;

// this device's report for the status line (the web's; the terminal draws
// its own from it): the folder Unii works in (its home repo, else
// <work>/main) and its branch, today's LiteLLM spend (Cost.ts: the
// refresher run when due)
export function device_status(rules: Rules, now: number): View.Client {
  const raw = rules.home || rules.work + "/main";
  const dir = raw.startsWith("~/") ? os.homedir() + raw.slice(1) : raw;
  const git = Bun.spawnSync(["git", "-C", dir, "branch", "--show-current"], { stdout: "pipe", stderr: "ignore", timeout: 2000 });
  const branch = git.exitCode === 0 ? git.stdout.toString().trim() || null : null;
  const spend = Cost.cost_read(Cost.COST_CACHE, now);
  if (spend.due) {
    Cost.cost_refresh(Cost.COST_REFRESH);
  }
  const week = Cost.cost_week(Cost.COST_CACHE, now).spend;
  return { $: "status", dir: path.basename(dir) || "~", branch, spend: spend.spend, stale: spend.stale, week };
}

// how often a device reads its inbox (ms), and the most a command it runs
// for it may take
export const INBOX_EVERY = 5 * 60_000;
const INBOX_WAIT = 30_000;

// a command run for the inbox: its exit code and its output (stdout, else
// stderr); a test's fake
export type Exec = (cmd: string[]) => Promise<{ code: number; out: string }>;

// what the device reads from Google (Google.ts, RED ZONE draft): the
// user's grant from the Keychain each time; a test's fake
export type Reads = { events: (now: Date) => Promise<Google.Event[]>; docs: (now: Date) => Promise<Google.Doc[]>; text: (id: string) => Promise<string> };
export const reads: Reads = {
  events : async (now) => Google.events(await Google.token(Google.store()), now),
  docs   : async (now) => Google.docs(await Google.token(Google.store()), now),
  text   : async (id) => Google.text(await Google.token(Google.store()), id),
};

// a transcript's text the server asked for (its Summarize), or why not
export async function device_transcript(id: string, g: Reads = reads): Promise<View.Client> {
  try {
    return { $: "transcript", id, text: await g.text(id) };
  } catch (err: any) {
    return { $: "transcript", id, error: String(err?.message ?? err).slice(0, 200) };
  }
}

// a command run here, read-only, never longer than INBOX_WAIT; missing: 127
export const exec: Exec = async (cmd) => {
  try {
    const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: INBOX_WAIT });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, out: code === 0 ? out : err.trim() || out };
  } catch (err: any) {
    return { code: 127, out: String(err?.message ?? err) };
  }
};

// a path with ~ for home, whole
function home(dir: string): string {
  return dir.startsWith("~/") ? os.homedir() + dir.slice(1) : dir;
}

// Spaces
// ------
// The repos the cockpit covers: those listed (Rules.spaces, a test's),
// else found: git repos under the roots (UNII_SPACES, comma-separated; by
// default /Volumes/dev/git and ~/.claude) and the home repo. All are
// checked for worktrees to clean up (git runs only where .git/worktrees
// is); the active ones (git files changed in ACTIVE) feed the digest and
// the sidebar, newest first. Found anew every FIND.

export type Space = { path: string; at: number }; // at: its git files' last change (ms)

export const ROOTS = ["/Volumes/dev/git", "~/.claude"];
const DEPTH = 4;
const SKIP = new Set(["node_modules", "vendor", "dist", "build", "target"]);
export const ACTIVE = 14 * 86400e3;
const FIND = 30 * 60e3;
// the most active spaces the digest asks GitHub about
const DIGESTED = 40;

// the roots, as UNII_SPACES says (none: ROOTS)
export function device_roots(env: string | undefined): string[] {
  const roots = (env ?? "").split(",").map((s: string) => s.trim()).filter((s: string) => s !== "");
  return (roots.length > 0 ? roots : ROOTS).map(home);
}

// a repo's last activity: its HEAD's, index's and last fetch's change
function activity(repo: string): number {
  let at = 0;
  for (const f of ["HEAD", "index", "FETCH_HEAD", "logs/HEAD"]) {
    try {
      at = Math.max(at, fs.statSync(repo + "/.git/" + f).mtimeMs);
    } catch {
      continue;
    }
  }
  return at;
}

// the git repos under the roots (a root that is one, itself), DEPTH
// folders down at most, not inside a repo, node_modules, a build or a
// hidden folder; a linked worktree's .git is a file: not a repo here.
// The home repo first, then newest first
export function device_discover(roots: string[], now: number, home_repo?: string): Space[] {
  const found = new Map<string, Space>();
  const walk = (dir: string, depth: number) => {
    let kids: fs.Dirent[];
    try {
      kids = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (kids.some((k) => k.name === ".git" && k.isDirectory())) {
      found.set(dir, { path: dir, at: activity(dir) });
      return;
    }
    if (depth === DEPTH) {
      return;
    }
    for (const k of kids) {
      if (k.isDirectory() && !k.name.startsWith(".") && !SKIP.has(k.name)) {
        walk(dir + "/" + k.name, depth + 1);
      }
    }
  };
  roots.forEach((r) => walk(r.replace(/\/+$/, ""), 0));
  const all = [...found.values()].sort((a, b) => b.at - a.at);
  const first = home_repo === undefined ? null : home(home_repo).replace(/\/+$/, "");
  return first === null ? all : [{ path: first, at: now }, ...all.filter((s) => s.path !== first)];
}

export function device_active(s: Space, now: number): boolean {
  return now - s.at <= ACTIVE;
}

let found: { at: number; key: string; spaces: Space[] } | null = null;

// the spaces: listed (all active), else found (kept FIND)
export function device_spaces(rules: Rules, now: number): { spaces: Space[]; listed: boolean } {
  if (rules.spaces !== undefined) {
    return { spaces: rules.spaces.map((p) => ({ path: home(p), at: now })), listed: true };
  }
  const roots = device_roots(process.env.UNII_SPACES);
  const key = roots.join(",") + "|" + (rules.home ?? "");
  if (found === null || found.key !== key || now - found.at > FIND) {
    found = { at: now, key, spaces: device_discover(roots, now, rules.home) };
  }
  return { spaces: found.spaces, listed: false };
}

// this device's inbox (Inbox.ts) read with the user's own CLIs, read-only:
// gh (PRs, notifications), acli (Jira), git (each space's worktrees with
// changes, or merged); what fails is said in errors, the rest kept
export async function device_inbox(rules: Rules, run: Exec, now: Date, g: Reads = reads): Promise<View.Client> {
  const errors: string[] = [];
  const said = (tool: string, r: { out: string }) => errors.push(tool + ": " + (r.out.trim().split("\n")[0] || "failed").slice(0, 200));
  const json = (r: { code: number; out: string }, tool: string): any => {
    if (r.code !== 0) {
      said(tool, r);
      return null;
    }
    try {
      return JSON.parse(r.out);
    } catch {
      said(tool, { out: "unreadable output" });
      return null;
    }
  };
  const vars = Object.entries(Inbox.inbox_vars(now)).flatMap(([k, v]) => ["-f", k + "=" + v]);
  const { spaces, listed } = device_spaces(rules, now.getTime());
  const worktreed = listed ? spaces : spaces.filter((s) => fs.existsSync(s.path + "/.git/worktrees"));
  const active = spaces.filter((s) => listed || device_active(s, now.getTime()));
  const jql = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
  // Google's: both read, or none (fail closed), the reason said
  const google = Promise.all([g.events(now), g.docs(now)]).then(([events, docs]) => ({ events, docs }), (err) => {
    errors.push("google: " + String(err?.message ?? err).split("\n")[0].slice(0, 200));
    return null;
  });
  const [gql, notes, jira, clean, digest] = await Promise.all([
    run(["gh", "api", "graphql", "-f", "query=" + Inbox.QUERY, ...vars]),
    run(["gh", "api", "notifications?participating=true&per_page=30"]),
    run(["acli", "jira", "workitem", "search", "--jql", jql, "--json", "--limit", "50"]),
    Promise.all(worktreed.map((s) => device_clean(s.path, run))).then((x) => x.flat()),
    device_digest(active.slice(0, DIGESTED).map((s) => s.path), run, now, said),
  ]);
  const gh = Inbox.inbox_github(json(gql, "gh") ?? {});
  if (gh.error !== undefined) {
    errors.push("gh: " + gh.error.slice(0, 200));
  }
  const tickets = json(jira, "acli");
  const inbox: Inbox.Inbox = {
    at: now.getTime(), login: gh.login, reviews: gh.reviews, mine: gh.mine, merged: gh.merged, today: gh.today,
    tickets: tickets === null ? null : Inbox.inbox_tickets(tickets), clean, notes: Inbox.inbox_notes(json(notes, "gh") ?? []), errors, digest,
    spaces: active.slice(0, Inbox.MOST).map((s) => path.basename(s.path)),
    google: await google,
  };
  return { $: "inbox", inbox };
}

// the team digest: the spaces' GitHub repos (upstream, else origin), their PRs
// merged this week and open; none on GitHub: null
async function device_digest(spaces: string[], run: Exec, now: Date, said: (tool: string, r: { out: string }) => void): Promise<Inbox.Digest | null> {
  // a fork's upstream first: the team's PRs are there, not on the fork
  const remote = async (s: string) => {
    const up = await run(["git", "-C", s, "remote", "get-url", "upstream"]);
    return up.code === 0 ? up : run(["git", "-C", s, "remote", "get-url", "origin"]);
  };
  const remotes = await Promise.all(spaces.map(remote));
  const repos = [...new Set(remotes.filter((r) => r.code === 0).map((r) => Inbox.inbox_repo(r.out)).filter((r): r is string => r !== null))];
  if (repos.length === 0) {
    return null;
  }
  // one search per chunk of repos that fits GitHub's query length
  const chunks = Inbox.digest_chunks(repos, now);
  const digest: Inbox.Digest = { repos: repos.slice(0, chunks.reduce((n, c) => n + c.merged.split("repo:").length - 1, 0)), merged: [], open: [] };
  for (const chunk of chunks) {
    const vars = Object.entries(chunk).flatMap(([k, v]) => ["-f", k + "=" + v]);
    const r = await run(["gh", "api", "graphql", "-f", "query=" + Inbox.DIGEST, ...vars]);
    if (r.code !== 0) {
      said("gh", r);
      return null;
    }
    try {
      const part = Inbox.inbox_digest(JSON.parse(r.out), []);
      digest.merged.push(...part.merged);
      digest.open.push(...part.open);
    } catch {
      said("gh", { out: "unreadable digest" });
      return null;
    }
  }
  return digest;
}

// a space's worktrees to clean up: uncommitted changes, or a merged branch
async function device_clean(space: string, run: Exec): Promise<Inbox.Clean[]> {
  const list = await run(["git", "-C", space, "worktree", "list", "--porcelain"]);
  const trees = list.code === 0 ? Inbox.inbox_worktrees(list.out) : [];
  if (trees.length === 0) {
    return [];
  }
  const base = await run(["git", "-C", space, "rev-parse", "--abbrev-ref", "origin/HEAD"]);
  const merged = base.code !== 0 ? [] : (await run(["git", "-C", space, "branch", "--merged", base.out.trim(), "--format=%(refname:short)"])).out.split("\n").map((b) => b.trim());
  const repo = path.basename(space);
  const rows = await Promise.all(trees.map(async (t) => {
    const st = await run(["git", "-C", t.path, "status", "--porcelain"]);
    const changes = st.code === 0 ? st.out.split("\n").filter((l) => l.trim() !== "").length : 0;
    return { repo, path: t.path, branch: t.branch, changes, merged: t.branch !== null && merged.includes(t.branch) };
  }));
  return rows.filter((r) => r.changes > 0 || r.merged);
}

// `legion device`: connects to the server at url as this device (auth: its
// session's header; query: its name, work dir, whether it does computer
// use) and runs its jobs, with no screen; what goes wrong, to log. A
// lost socket opens again, unless lost() says not (signed out)
export function device_open(url: string, auth: Record<string, string>, query: string, rules: Rules, log: (line: string) => void, lost: (up: boolean) => Promise<boolean> = async () => true): View.View {
  const v = View.view_new();
  const jobs = new Map<string, Run>();
  const send = (msg: View.Client) => View.link_send(v, msg, (a) => a.error !== undefined && log("refused: " + a.error));
  const heard = device_reads(rules, send);
  View.link_open(v, {
    open : (q) => new WebSocket(url.replace(/^http/, "ws") + "/ws" + q + query, { headers: auth } as any),
    post : (path, body) => fetch(url + path, { method: "POST", headers: auth, body }),
    hear : (msg) => {
      for (const out of View.view_hear(v, msg)) {
        send(out);
      }
      if (msg.$ === "jobs" || msg.$ === "job") {
        device_jobs(v, jobs, msg, rules, send);
      }
      heard(msg);
    },
    lost,
  });
  const report = () => send(device_status(rules, Date.now()));
  report();
  setInterval(report, STATUS_EVERY).unref();
  return v;
}

// the reads a device does for the cockpit, the terminal's and legion
// device's alike: the inbox now, every `every` ms (0: never again) and on
// the server's "fetch"; a transcript's text on its "read". Returns what
// hears the server's messages
export function device_reads(rules: Rules, send: (msg: View.Client) => void, run: Exec = exec, g: Reads = reads, every = INBOX_EVERY): (msg: View.Server) => void {
  const inbox = async () => send(await device_inbox(rules, run, new Date(), g));
  void inbox();
  if (every > 0) {
    setInterval(inbox, every).unref();
  }
  return (msg) => {
    if (msg.$ === "fetch") {
      void inbox();
    }
    if (msg.$ === "read") {
      void device_transcript(msg.id, g).then(send);
    }
  };
}
