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
import { Harvest, type Creds, type New } from "./Harvest.ts";
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
  const git = Bun.spawnSync(device_git(dir, "branch", "--show-current"), { stdout: "pipe", stderr: "ignore", timeout: 2000 });
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

// security review L: every git the device runs, in dir, hardened: no
// fsmonitor, hooks, external diff or pager (and --no-textconv where a
// diff shows, GIT_VIEWS); only where device_trusted says
const GIT_SAFE = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-c", "core.pager=cat", "--no-pager"];
export function device_git(dir: string, ...args: string[]): string[] {
  return ["git", "-C", dir, ...GIT_SAFE, ...args];
}

// whether git may run in dir: it is this user's, and the repo's own config
// (not the user's global or the system's) names no filter or textconv
// driver, which a status or a diff would run
export async function device_trusted(dir: string, run: Exec): Promise<boolean> {
  try {
    if (fs.statSync(dir).uid !== process.getuid?.()) {
      return false;
    }
  } catch {
    return false;
  }
  const r = await run(device_git(dir, "config", "--show-scope", "--includes", "--get-regexp", "^filter\\.|\\.textconv$"));
  return r.code === 1 || (r.code === 0 && r.out.split("\n").every((l) => l.trim() === "" || /^(global|system)\s/.test(l)));
}

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
    const up = await run(device_git(s, "remote", "get-url", "upstream"));
    return up.code === 0 ? up : run(device_git(s, "remote", "get-url", "origin"));
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

// a space's worktrees to clean up: uncommitted changes, or a merged
// branch; none of a space git may not run in (device_trusted)
async function device_clean(space: string, run: Exec): Promise<Inbox.Clean[]> {
  if (!await device_trusted(space, run)) {
    return [];
  }
  const list = await run(device_git(space, "worktree", "list", "--porcelain"));
  const trees = list.code === 0 ? Inbox.inbox_worktrees(list.out) : [];
  if (trees.length === 0) {
    return [];
  }
  const base = await run(device_git(space, "rev-parse", "--abbrev-ref", "origin/HEAD"));
  const merged = base.code !== 0 ? [] : (await run(device_git(space, "branch", "--merged", base.out.trim(), "--format=%(refname:short)"))).out.split("\n").map((b) => b.trim());
  const repo = path.basename(space);
  const rows = await Promise.all(trees.map(async (t) => {
    const st = await device_trusted(t.path, run) ? await run(device_git(t.path, "status", "--porcelain")) : { code: 1, out: "" };
    const changes = st.code === 0 ? st.out.split("\n").filter((l) => l.trim() !== "").length : 0;
    return { repo, path: t.path, branch: t.branch, changes, merged: t.branch !== null && merged.includes(t.branch) };
  }));
  return rows.filter((r) => r.changes > 0 || r.merged);
}

// RED ZONE (security review U1, DRAFT awaiting the user's sign-off): how
// a device or terminal reaches the server on this computer: never over
// TCP (any process may take 127.0.0.1:<port> first, and relay the real
// server to get a session), only over its unix socket, <dir>/server.sock
// (Server.ts Main.unix: this user's, 0600, in a 0700 dir, so only this
// user's processes can be the server). url: the server's address, its
// host the Host header (Server.ts Main.ours). No socket: a call fails and
// is tried again, never sent over TCP
export type Wire = { url: string; sock: string };

// Bun reads a ':' in a ws+unix:// path as its end; macOS's socket paths
// are at most 104 bytes, the last a NUL
const SOCK_PATH = /^\/[^:]{1,102}$/;
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

export const NO_SOCKET = "no server socket (none up): not connecting, trying again";

// the wire to the server at url (loopback only) whose dir is dir; a path
// Bun can't open as given is refused, not opened elsewhere
export function device_wire(url: string, dir: string): Wire {
  const sock = dir.replace(/\/$/, "") + "/server.sock";
  if (!SOCK_PATH.test(sock)) {
    throw new Error(sock + ": not a socket path this build opens (absolute, no ':', under 104 bytes)");
  }
  if (!LOOPBACK.includes(new URL(url).hostname)) {
    throw new Error(url + ": not a server on this computer");
  }
  return { url: url.replace(/\/$/, ""), sock };
}

// a request to the server, over its socket only; a redirect is refused
// (it would leave the socket)
export function device_fetch(w: Wire, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(w.url + path, { ...init, unix: w.sock, redirect: "error" } as RequestInit);
}

// a WebSocket to the server's path, over its socket only
function device_socket(w: Wire, path: string, headers: Record<string, string>): WebSocket {
  return new WebSocket("ws+unix://" + w.sock + ":" + path, { headers: { ...headers, host: new URL(w.url).host } } as any);
}

// RED ZONE U1: the link to the server (auth: the session's header; query:
// this device), over its socket only (device_socket, device_fetch). No
// socket: none opens, it tries again (View.RETRY), said once in log; only
// with one does lost() hear of a loss (signed out?)
export function device_link(v: View.View, w: Wire, auth: () => Record<string, string>, query: string, log: (line: string) => void, hear: (msg: View.Server) => void, lost: (up: boolean) => Promise<boolean>): void {
  let said = false;
  const link: View.Link = {
    open : (q) => device_socket(w, "/ws" + q + query, auth()),
    post : (path, body) => device_fetch(w, path, { method: "POST", headers: auth(), body }),
    hear,
    lost : async (up) => {
      const none = !fs.existsSync(w.sock);
      if (none && !said) {
        log(NO_SOCKET);
      }
      said = none;
      return none || lost(up);
    },
  };
  View.link_open(v, link);
}

// `legion device`: connects to the server (w) as this device (auth: its
// session's header; query: its name, work dir, whether it does computer
// use), over its socket only (device_link), and runs its jobs, with no
// screen; what goes wrong, to log. A lost socket opens again, unless
// lost() says not (signed out)
export function device_open(w: Wire, auth: Record<string, string>, query: string, rules: Rules, log: (line: string) => void, lost: (up: boolean) => Promise<boolean> = async () => true): View.View {
  const v = View.view_new();
  const jobs = new Map<string, Run>();
  const send = (msg: View.Client) => View.link_send(v, msg, (a) => a.error !== undefined && log("refused: " + a.error));
  const heard = device_reads(rules, send);
  const hear = (msg: View.Server) => {
    for (const out of View.view_hear(v, msg)) {
      send(out);
    }
    if (msg.$ === "jobs" || msg.$ === "job") {
      device_jobs(v, jobs, msg, rules, send);
    }
    heard(msg);
  };
  device_link(v, w, () => auth, query, log, hear, lost);
  const report = () => send(device_status(rules, Date.now()));
  report();
  setInterval(report, STATUS_EVERY).unref();
  return v;
}

// The timesheet's Submit (K5, RED ZONE)
// =====================================
// The entries the server sent for the user's Submit (Chat.timesheet),
// each checked again (Harvest.entry_check) and posted once, in order,
// with the token kept in the Keychain; each one's Harvest id or why not.

export type Posts = { creds: () => Promise<Creds>; post: (c: Creds, e: New) => Promise<{ id: number }> };
export const posts: Posts = { creds: () => Harvest.creds(Harvest.store()), post: (c, e) => Harvest.post(c, e) };

export async function device_harvest(id: string, entries: unknown, h: Posts = posts): Promise<View.Client> {
  const list = (Array.isArray(entries) ? entries : []).filter((e: any) => e !== null && typeof e === "object" && Number.isInteger(e.n)) as (New & { n: number })[];
  let c: Creds;
  try {
    c = await h.creds();
  } catch (err: any) {
    return { $: "harvested", id, results: list.map((e) => ({ n: e.n, error: String(err?.message ?? err).slice(0, 300) })) };
  }
  const results: View.Harvested[] = [];
  for (const e of list) {
    const ok = Harvest.entry_check(e);
    if (typeof ok === "string") {
      results.push({ n: e.n, error: "not posted: " + ok });
      continue;
    }
    try {
      results.push({ n: e.n, id: (await h.post(c, ok)).id });
    } catch (err: any) {
      results.push({ n: e.n, error: String(err?.message ?? err).slice(0, 300) });
    }
  }
  return { $: "harvested", id, results };
}

// The files pane and git tab (K4, Terax-like, read-only)
// ======================================================
// What a view asks to see: a file (an agent's relative path from its own
// dir), or a repo's git by one of GIT_VIEWS' fixed commands. Shown only
// under the device's roots (its work dir, home repo, spaces and their
// worktrees at <repo>-worktrees/<slug>), each path's
// symlinks followed first; never a secret's file (Machine.secret), a binary or a
// file past LOOK_BYTES; git's answer cut at LOOK_BYTES.

export const LOOK_BYTES = 512 * 1024;
const GIT_VIEWS: Record<string, (rev: string | null) => string[]> = {
  status  : () => ["status", "--porcelain=v1", "--branch"],
  branches: () => ["branch", "--all", "-vv", "--no-color"],
  log     : () => ["log", "--oneline", "--decorate", "--no-color", "-80"],
  diff    : () => ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "HEAD"],
  show    : (rev) => ["show", "--no-color", "--no-ext-diff", "--no-textconv", "--stat", "--patch", rev ?? "HEAD"],
};
const REV = /^([0-9a-f]{4,40}|HEAD(~\d{1,3})?)$/;

// a path's real path, or "" if none
function real_or_none(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return "";
  }
}

// a repo's linked worktrees where local/rules.md puts them, beside it at
// <repo>-worktrees/<slug> (a folder x.git: x-worktrees) (its .git/worktrees/*/gitdir names each one's
// .git); one elsewhere (a temp dir, say) is not shown
function look_worktrees(repo: string): string[] {
  const beside = path.join(path.dirname(repo), path.basename(repo).replace(/\.git$/, "") + "-worktrees");
  let names: string[];
  try {
    names = fs.readdirSync(repo + "/.git/worktrees");
  } catch {
    return [];
  }
  return names.map((n) => {
    try {
      return real_or_none(path.dirname(fs.readFileSync(repo + "/.git/worktrees/" + n + "/gitdir", "utf8").trim()));
    } catch {
      return "";
    }
  }).filter((wt) => wt !== "" && path.dirname(wt) === beside);
}

// the roots a device shows under, real paths: its work dir, home repo,
// spaces and their worktrees
function look_roots(rules: Rules): string[] {
  const all = [rules.work, rules.home, ...device_spaces(rules, Date.now()).spaces.map((s) => s.path)];
  const roots = all.filter((p): p is string => typeof p === "string" && p !== "").map((p) => real_or_none(home(p))).filter((p) => p !== "");
  return [...new Set([...roots, ...roots.flatMap(look_worktrees)])];
}

// a path's real path if under a root; else why not
function look_under(rules: Rules, p: string): string | { why: string } {
  let real: string;
  try {
    real = fs.realpathSync(p);
  } catch {
    return { why: "No file " + p + " here." };
  }
  const roots = look_roots(rules);
  return roots.some((r) => real === r || real.startsWith(r + path.sep)) ? real : { why: p + " is not under this device's work dir, home repo, spaces or their worktrees." };
}

// what a view asked to see, or why not (look_file, look_git, look_dir,
// look_open); launch: opens a file in the user's editor (editor_open)
export async function device_look(rules: Rules, id: string, what: View.Look, launch: (file: string) => Promise<string> = editor_open): Promise<View.Client> {
  const kind = View.LOOK_KINDS.find((k) => k === what?.kind) ?? "file";
  try {
    const shown = what?.kind === "file" ? look_file(rules, what)
      : what?.kind === "git" ? await look_git(rules, what)
      : what?.kind === "dir" ? look_dir(rules, String(what.path ?? ""))
      : what?.kind === "open" ? await look_open(rules, String(what.path ?? ""), launch)
      : "Ask for a file, a folder or a repo's git.";
    return typeof shown === "string" ? { $: "looked", id, kind, error: shown.slice(0, 300) } : { $: "looked", id, kind, ...shown };
  } catch (err: any) {
    return { $: "looked", id, kind, error: String(err?.message ?? err).slice(0, 300) };
  }
}

type Shown = { path: string; op?: string; text: string };

// the files explorer: a folder's entries (View.Looked's "dir" lines),
// folders first, by name, .git never, at most DIR_MOST; @roots: the roots
export const DIR_MOST = 2000;
function look_dir(rules: Rules, given: string): Shown | string {
  if (given === "@roots") {
    return { path: given, text: look_roots(rules).map((r) => "d " + r).join("\n") };
  }
  const real = look_under(rules, home(given));
  if (typeof real !== "string") {
    return real.why;
  }
  if (!fs.statSync(real).isDirectory()) {
    return given + " is not a folder.";
  }
  const line = (k: fs.Dirent) => {
    const at = path.join(real, k.name);
    const dir = k.isDirectory() || k.isSymbolicLink() && fs.statSync(at, { throwIfNoEntry: false })?.isDirectory() === true;
    return (dir ? "d " : Machine.secret(at) ? "s " : "f ") + k.name;
  };
  const kids = fs.readdirSync(real, { withFileTypes: true }).filter((k) => k.name !== ".git" && !k.name.includes("\n"));
  const lines = kids.map(line).sort((a, b) => (a[0] === "d" ? 0 : 1) - (b[0] === "d" ? 0 : 1) || (a.slice(2) < b.slice(2) ? -1 : 1));
  return { path: given, text: lines.slice(0, DIR_MOST).join("\n") };
}

// a file under the roots opened in the user's editor, a secret's too: its
// text never leaves this computer (the user edits what agents can't)
async function look_open(rules: Rules, given: string, launch: (file: string) => Promise<string>): Promise<Shown | string> {
  const real = look_under(rules, home(given));
  if (typeof real !== "string") {
    return real.why;
  }
  if (!fs.statSync(real).isFile()) {
    return given + " is not a file.";
  }
  return { path: given, text: "Opened " + path.basename(real) + " in " + await launch(real) + "." };
}

// VS Code (its `code`, else its app), else the default text editor; no
// shell, the file one argument; what opened it
const VSCODE_APP = "/Applications/Visual Studio Code.app";
async function editor_open(file: string): Promise<string> {
  const [argv, name] = Bun.which("code") !== null ? [["code", file], "VS Code"]
    : fs.existsSync(VSCODE_APP) ? [["open", "-a", VSCODE_APP, file], "VS Code"]
    : [["open", "-t", file], "the default editor"];
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  if (await proc.exited !== 0) {
    throw new Error(name + " didn't open it: " + (await new Response(proc.stderr).text()).trim().slice(0, 200));
  }
  return name;
}

// a file's text (an agent's path from its own dir), or why not
function look_file(rules: Rules, what: View.Look & { kind: "file" }): Shown | string {
  const agent = what.agent === undefined ? null : String(what.agent);
  if (agent !== null && !/^[\w-]{1,64}$/.test(agent)) {
    return "Not an agent's name.";
  }
  const given = String(what.path ?? "");
  const at = path.resolve(agent === null ? home(rules.home ?? rules.work) : path.join(home(rules.work), agent), home(given));
  // by its name and its real path's (a symlink's target)
  if (Machine.secret(at)) {
    return path.basename(at) + " may hold a secret: not shown.";
  }
  const real = look_under(rules, at);
  if (typeof real !== "string") {
    return real.why;
  }
  // security review L: opened not following a symlink (one swapped in
  // since look_under is refused), then the open file checked again: the
  // one at its real path, still under a root, still no secret's
  const fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) {
      return "No file " + given + " here (a directory?).";
    }
    const again = look_under(rules, real);
    const same = typeof again === "string" && !Machine.secret(again) && fs.statSync(again).ino === st.ino && fs.statSync(again).dev === st.dev;
    if (!same) {
      return given + " changed as it was read: not shown.";
    }
    if (st.size > LOOK_BYTES) {
      return given + " is too big to show (" + st.size + " bytes).";
    }
    const data = fs.readFileSync(fd);
    if (data.includes(0)) {
      return given + " is a binary file.";
    }
    return { path: at, text: data.toString("utf8") };
  } finally {
    fs.closeSync(fd);
  }
}

// a repo's git by one of GIT_VIEWS (a file's own repo; @home: the home
// repo), or why not
async function look_git(rules: Rules, what: View.Look & { kind: "git" }): Promise<Shown | string> {
  const view = GIT_VIEWS[String(what.op)];
  if (view === undefined || !Object.hasOwn(GIT_VIEWS, String(what.op))) {
    return "No git view " + String(what.op).slice(0, 20) + ": " + Object.keys(GIT_VIEWS).join(", ") + ".";
  }
  const rev = what.rev === undefined ? null : String(what.rev);
  if (rev !== null && !REV.test(rev)) {
    return "Not a revision: a commit's hash, HEAD or HEAD~n.";
  }
  const repo = String(what.repo ?? "");
  const real = look_under(rules, repo === "@home" ? home(rules.home ?? path.join(rules.work, "main")) : home(repo));
  if (typeof real !== "string") {
    return real.why;
  }
  const dir = fs.statSync(real).isDirectory() ? real : path.dirname(real);
  if (!await device_trusted(dir, exec)) {
    return dir + ": not run: not this user's, or its git config names a filter or textconv driver.";
  }
  const r = await exec(device_git(dir, ...view(rev)));
  if (r.code !== 0) {
    return "git: " + r.out.trim();
  }
  return { path: dir, op: String(what.op), text: r.out.slice(0, LOOK_BYTES) };
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
    if (msg.$ === "look") {
      void device_look(rules, msg.id, msg.what).then(send);
    }
    if (msg.$ === "harvest") {
      void device_harvest(msg.id, msg.entries).then(send);
    }
  };
}
