// Device
// ======
// This computer as a device: it runs the server's jobs here
// (Machine.run) and answers their output. The terminal (Term.ts) is one,
// and `unii device` is one with no screen, so the agents' shells work
// while no terminal is open. Both keep the same rules (Rules): computer
// use only where allowed (UNII_COMPUTER=1), an output too large for a
// socket message refused by its size, a job the server no longer lists
// stopped. Approvals stay the server's (a Claude Code worker waits for
// the person's ✓, from the web or a terminal), so a device asks nothing.

import { Machine, type Job } from "./Machine.ts";
import * as View from "./View.ts";

// a job running here: its stop, its send to the background (a shell's),
// its tool's name
export type Run = { abort: AbortController; away: AbortController; name: string };

// where jobs work (the device's work dir; its home repo, Unii's own),
// whether it does computer use, what runs a job (Machine.run; a test's)
export type Rules = { work: string; home?: string; computer: boolean; run?: typeof Machine.run };

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

// `unii device`: connects to the server at url as this device (auth: its
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
    },
    lost,
  });
  return v;
}
