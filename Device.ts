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

import * as os from "node:os";
import * as path from "node:path";
import * as Cost from "./Cost.ts";
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

// the repos the inbox reads worktrees in
export function device_spaces(rules: Rules): string[] {
  const spaces = rules.spaces ?? (process.env.UNII_SPACES ?? "").split(",").map((s: string) => s.trim()).filter((s: string) => s !== "");
  return (spaces.length > 0 ? spaces : rules.home ? [rules.home] : []).map(home);
}

// this device's inbox (Inbox.ts) read with the user's own CLIs, read-only:
// gh (PRs, notifications), acli (Jira), git (each space's worktrees with
// changes, or merged); what fails is said in errors, the rest kept
export async function device_inbox(rules: Rules, run: Exec, now: Date): Promise<View.Client> {
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
  const jql = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
  const [gql, notes, jira, clean, digest] = await Promise.all([
    run(["gh", "api", "graphql", "-f", "query=" + Inbox.QUERY, ...vars]),
    run(["gh", "api", "notifications?participating=true&per_page=30"]),
    run(["acli", "jira", "workitem", "search", "--jql", jql, "--json", "--limit", "50"]),
    Promise.all(device_spaces(rules).map((s) => device_clean(s, run))).then((x) => x.flat()),
    device_digest(rules, run, now, said),
  ]);
  const gh = Inbox.inbox_github(json(gql, "gh") ?? {});
  if (gh.error !== undefined) {
    errors.push("gh: " + gh.error.slice(0, 200));
  }
  const tickets = json(jira, "acli");
  const inbox: Inbox.Inbox = {
    at: now.getTime(), login: gh.login, reviews: gh.reviews, mine: gh.mine, merged: gh.merged, today: gh.today,
    tickets: tickets === null ? null : Inbox.inbox_tickets(tickets), clean, notes: Inbox.inbox_notes(json(notes, "gh") ?? []), errors, digest,
  };
  return { $: "inbox", inbox };
}

// the team digest: the spaces' GitHub repos (their origin), their PRs
// merged this week and open; none on GitHub: null
async function device_digest(rules: Rules, run: Exec, now: Date, said: (tool: string, r: { out: string }) => void): Promise<Inbox.Digest | null> {
  const remotes = await Promise.all(device_spaces(rules).map((s) => run(["git", "-C", s, "remote", "get-url", "origin"])));
  const repos = [...new Set(remotes.filter((r) => r.code === 0).map((r) => Inbox.inbox_repo(r.out)).filter((r): r is string => r !== null))];
  if (repos.length === 0) {
    return null;
  }
  const vars = Object.entries(Inbox.digest_vars(repos, now)).flatMap(([k, v]) => ["-f", k + "=" + v]);
  const r = await run(["gh", "api", "graphql", "-f", "query=" + Inbox.DIGEST, ...vars]);
  if (r.code !== 0) {
    said("gh", r);
    return null;
  }
  try {
    return Inbox.inbox_digest(JSON.parse(r.out), repos);
  } catch {
    said("gh", { out: "unreadable digest" });
    return null;
  }
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
      if (msg.$ === "fetch") {
        void inbox();
      }
    },
    lost,
  });
  const report = () => send(device_status(rules, Date.now()));
  const inbox = async () => send(await device_inbox(rules, exec, new Date()));
  report();
  void inbox();
  setInterval(report, STATUS_EVERY).unref();
  setInterval(inbox, INBOX_EVERY).unref();
  return v;
}
