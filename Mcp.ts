// Mcp
// ===
// A client of MCP servers (~/.unii/mcp.json, local/mcp.ts): each a
// process of this computer spoken to over its stdin and stdout, a JSON
// message a line, or a URL (streamable HTTP: a POST answered as JSON or
// as SSE). A server is opened as a tool of it is first wanted, and closed
// after IDLE unused; its tools are listed once (by page) and kept, anew
// when it says they changed, so the prompt's tools stay the same. A tool
// is offered as mcp__<server>__<tool>, cut to 64 characters with a hash
// if longer, its description marked [server]. A "${VAR}" in a header or
// env value is looked up as the server opens (load: in the file mcp.json
// names, ~/.claude.json), never in the environment: no secret is kept in
// mcp.json, none reaches an agent's shell, none is ever logged. A child
// gets only PATH, HOME and the locale of this process's environment. A
// server that fails to open is skipped, said once in a line; the others
// go on.
// A server process runs in its own process group (detached), so what it
// starts (a browser) is in it too; as unii quits, end() ends every group.
// Their pids and start times are kept in a file (sweep), so the next unii
// ends those a crashed one left, if each is still the process it was.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { Agent, type Out } from "./Agent.ts";
import { AskAI } from "./AskAI.ts";
import { clip, stream_lines } from "./Clip.ts";
import type { Spec } from "./Machine.ts";

// Types
// =====

// a server: a command (and its args, env) or a URL (and its headers), and
// the tools of it offered (none: all)
export type Server = {
  name     : string;
  command? : string;
  args?    : string[];
  env?     : Record<string, string>;
  url?     : string;
  headers? : Record<string, string>;
  tools?   : string[];
};

// an open server: a request to it and its result, a notification to it,
// its end
type Link = {
  ask   : (method: string, params: object, signal: AbortSignal) => Promise<any>;
  tell  : (method: string, params: object) => Promise<void>;
  close : () => void;
};

// a server, open or not: its tools as offered (null: not listed yet),
// whether it failed to open (then it is skipped)
type Conn = {
  server : Server;
  link   : Promise<Link> | null;
  specs  : Spec[] | null;
  timer  : ReturnType<typeof setTimeout> | null;
  off    : boolean;
};

export type Pool = {
  conns : Conn[];
  tools : Map<string, [Conn, string]>; // by the name offered: its server, its own name
  env   : (name: string) => string | undefined;
  log   : (line: string) => void;
  wait  : { open: number; call: number; idle: number };
};

// Constants
// =========

const VERSION = "2025-06-18";

const OPEN = 20e3;
const CALL = 120e3;
const IDLE = 600e3;

// the most characters of a tool's name and description
const NAME = 64;
const INFO = 1000;

// a child's grace to end once told to (SIGTERM), before it is killed
const GRACE = 2e3;

// the children running, their pids to their start times; the file kept of
// them (sweep)
const CHILDREN = new Map<number, string>();
let PIDS = "";

// Mcp
// ===

export namespace Mcp {

  export function pool(servers: Server[], opts: { env?: Pool["env"]; log?: Pool["log"]; open?: number; call?: number; idle?: number } = {}): Pool {
    const conns = servers.map((server) => ({ server, link: null, specs: null, timer: null, off: false }));
    const wait = { open: opts.open ?? OPEN, call: opts.call ?? CALL, idle: opts.idle ?? IDLE };
    return { conns, tools: new Map(), env: opts.env ?? (() => undefined), log: opts.log ?? ((line) => console.error(line)), wait };
  }

  // the pool of mcp.json (local/mcp.ts; none if it is missing): its
  // servers, its placeholders looked up in its secrets file (a variable
  // to a path of keys there), read as each server opens
  export function load(file: string, log?: Pool["log"]): Pool {
    let got: { servers?: Server[]; secrets?: { file?: string; vars?: Record<string, string[]> } } = {};
    try {
      got = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    const secrets = got.secrets ?? {};
    const env = (name: string) => {
      const keys = secrets.vars?.[name];
      if (secrets.file === undefined || !Array.isArray(keys)) {
        return undefined;
      }
      try {
        const val = keys.reduce((at: any, k) => at?.[k], JSON.parse(fs.readFileSync(secrets.file, "utf8")));
        return typeof val === "string" ? val : undefined;
      } catch {
        return undefined;
      }
    };
    return Mcp.pool(Array.isArray(got.servers) ? got.servers : [], { env, log });
  }

  // the tools of the servers listed so far (list() lists the rest)
  export function cached(pool: Pool): Spec[] {
    return pool.conns.flatMap((c) => c.specs ?? []);
  }

  // what a child inherits of this process's environment: where programs
  // are, the user's home and locale; no key of the server's
  export function base(): Record<string, string> {
    const keep = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM"];
    return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]!]));
  }

  // every tool offered, of the servers that open
  export async function list(pool: Pool, signal: AbortSignal): Promise<Spec[]> {
    const lists = await Promise.all(pool.conns.map((c) => Mcp.specs(pool, c, signal)));
    return lists.flat();
  }

  export async function specs(pool: Pool, c: Conn, signal: AbortSignal): Promise<Spec[]> {
    if (c.off || c.specs !== null) {
      return c.specs ?? [];
    }
    const name = c.server.name;
    const sig = AbortSignal.any([signal, AbortSignal.timeout(pool.wait.open)]);
    try {
      const link = await Mcp.open(pool, c, sig);
      const tools: any[] = [];
      let cursor: string | undefined;
      do {
        const page = await link.ask("tools/list", cursor === undefined ? {} : { cursor }, sig);
        tools.push(...(Array.isArray(page?.tools) ? page.tools : []));
        cursor = typeof page?.nextCursor === "string" && page.nextCursor !== "" ? page.nextCursor : undefined;
      } while (cursor !== undefined);
      const keep = c.server.tools;
      const mine = tools.filter((t) => typeof t?.name === "string" && (keep === undefined || keep.includes(t.name)));
      for (const [n, [conn]] of pool.tools) {
        if (conn === c) {
          pool.tools.delete(n);
        }
      }
      c.specs = mine.map((t) => {
        const as = Mcp.name(name, t.name, pool.tools);
        pool.tools.set(as, [c, t.name]);
        const info = ("[" + name + "] " + String(t.description ?? "").trim()).trim().slice(0, INFO);
        return { name: as, info, schema: Mcp.schema(t.inputSchema) };
      });
      return c.specs;
    } catch (err) {
      if (!signal.aborted) {
        c.off = true;
        Mcp.close(c);
        pool.log("mcp: " + name + " skipped: " + Mcp.why(err, sig, pool.wait.open));
      }
      return [];
    }
  }

  export async function call(pool: Pool, name: string, args: object, signal: AbortSignal): Promise<Out> {
    const hit = pool.tools.get(name);
    if (hit === undefined) {
      return { text: "No tool " + name + ".", fail: true };
    }
    const [c, tool] = hit;
    const sig = AbortSignal.any([signal, AbortSignal.timeout(pool.wait.call)]);
    try {
      const link = await Mcp.open(pool, c, sig);
      const res = await link.ask("tools/call", { name: tool, arguments: args }, sig);
      Mcp.touch(pool, c);
      return Mcp.out(res);
    } catch (err) {
      return { text: c.server.name + ": " + (signal.aborted ? "(stopped)" : Mcp.why(err, sig, pool.wait.call)), fail: true };
    }
  }

  // a tool result as text, its images apart, clipped to its head and tail
  export function out(res: any): Out {
    const parts: any[] = Array.isArray(res?.content) ? res.content : [];
    const pics = parts.filter((p) => p?.type === "image" && typeof p.data === "string");
    const text = clip();
    text.add(AskAI.show(parts.filter((p) => p?.type !== "image")));
    return { text: text.text(), fail: res?.isError === true, imgs: pics.map((p) => ({ type: p.mimeType, data: p.data })) };
  }

  // a tool's name as offered: only letters, digits, _ and -; if too long
  // or taken, cut and given a hash of its server and own name
  export function name(server: string, tool: string, taken: Map<string, unknown>): string {
    const as = ("mcp__" + server + "__" + tool).replace(/[^a-zA-Z0-9_-]/g, "_");
    if (as.length <= NAME && !taken.has(as)) {
      return as;
    }
    const hash = createHash("sha256").update(server + "\0" + tool).digest("hex").slice(0, 8);
    return as.slice(0, NAME - 9) + "_" + hash;
  }

  // an input schema as the model APIs take it: an object, no $schema
  export function schema(given: unknown): object {
    const { $schema, ...rest } = given !== null && typeof given === "object" ? given as Record<string, unknown> : {};
    return { ...rest, type: "object" };
  }

  // an error as one line, with no secret (no message made here holds a
  // header's or env's value; a body that is no JSON is not passed on)
  export function why(err: any, signal: AbortSignal, ms: number): string {
    if (signal.aborted && signal.reason?.name === "TimeoutError") {
      return "no answer in " + ms / 1000 + " s.";
    }
    return String(err?.message ?? err).split("\n")[0].slice(0, 200);
  }

  // a server's link, opened if closed; its idle timer started anew
  export function open(pool: Pool, c: Conn, signal: AbortSignal): Promise<Link> {
    Mcp.touch(pool, c);
    c.link ??= Mcp.connect(pool, c, signal).catch((err) => {
      c.link = null;
      throw err;
    });
    return c.link;
  }

  export function touch(pool: Pool, c: Conn): void {
    clearTimeout(c.timer ?? undefined);
    c.timer = setTimeout(() => Mcp.close(c), pool.wait.idle);
    c.timer.unref?.();
  }

  export function close(c: Conn): void {
    clearTimeout(c.timer ?? undefined);
    c.timer = null;
    c.link?.then((link) => link.close(), () => {});
    c.link = null;
  }

  // Links
  // -----

  // a server opened: its placeholders filled, then initialized
  export async function connect(pool: Pool, c: Conn, signal: AbortSignal): Promise<Link> {
    const s = c.server;
    const changed = () => {
      c.specs = null;
    };
    const link = s.url !== undefined
      ? Mcp.http(s.url, Mcp.fill(s.headers ?? {}, pool.env), changed)
      : Mcp.stdio(s.command ?? "", s.args ?? [], Mcp.fill(s.env ?? {}, pool.env), changed);
    try {
      await link.ask("initialize", { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: "unii", version: "1" } }, signal);
      await link.tell("notifications/initialized", {});
      return link;
    } catch (err) {
      link.close();
      throw err;
    }
  }

  // values with each "${VAR}" looked up; a variable unset fails, by
  // its name only
  export function fill(vals: Record<string, string>, env: Pool["env"]): Record<string, string> {
    const one = (v: string) => v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
      const val = env(name);
      if (!val) {
        throw new Error("needs " + name + ", which is not set.");
      }
      return val;
    });
    return Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, one(String(v))]));
  }

  // a JSON-RPC answer's result; its error, or no answer, thrown
  export function reply(msg: any): any {
    if (msg === null || typeof msg !== "object") {
      throw new Error("bad JSON answer.");
    }
    if (msg.error) {
      throw new Error("error " + (msg.error.code ?? "") + ": " + String(msg.error.message ?? ""));
    }
    return msg.result;
  }

  // streamable HTTP: each message a POST, its answer JSON or SSE (one of
  // whose events answers it); the session id and version sent back
  export function http(url: string, headers: Record<string, string>, changed: () => void): Link {
    const head: Record<string, string> = { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" };
    let n = 0;
    const post = (msg: object, signal: AbortSignal) => fetch(url, { method: "POST", headers: head, body: JSON.stringify({ jsonrpc: "2.0", ...msg }), signal });
    const ask = async (method: string, params: object, signal: AbortSignal) => {
      const id = ++n;
      const res = await post({ id, method, params }, signal);
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error("HTTP " + res.status + ".");
      }
      const session = res.headers.get("mcp-session-id");
      if (session !== null) {
        head["mcp-session-id"] = session;
      }
      let msg: any = null;
      try {
        if (res.headers.get("content-type")?.includes("text/event-stream")) {
          for await (const ev of Agent.events(res.body!)) {
            if (ev?.method === "notifications/tools/list_changed") {
              changed();
            }
            if (ev?.id === id && ev.method === undefined) {
              msg = ev;
              break;
            }
          }
        } else {
          msg = await res.json();
        }
      } catch {
        throw new Error("bad JSON answer.");
      }
      const result = Mcp.reply(msg);
      if (method === "initialize") {
        head["mcp-protocol-version"] = String(result?.protocolVersion ?? VERSION);
      }
      return result;
    };
    const tell = async (method: string, params: object) => {
      const res = await post({ method, params }, AbortSignal.timeout(OPEN)).catch(() => null);
      await res?.body?.cancel();
    };
    const close = () => {
      if (head["mcp-session-id"] !== undefined) {
        fetch(url, { method: "DELETE", headers: head, signal: AbortSignal.timeout(OPEN) }).catch(() => {});
      }
    };
    return { ask, tell, close };
  }

  // stdio: a child in its own process group, a JSON message a line each
  // way (a line that is no JSON is ignored: a server's stray log); its
  // pings answered, its other requests refused
  export function stdio(command: string, args: string[], env: Record<string, string>, changed: () => void): Link {
    const proc = Bun.spawn([command, ...args], { env: { ...Mcp.base(), ...env }, stdin: "pipe", stdout: "pipe", stderr: "ignore", detached: true });
    Mcp.adopt(proc.pid);
    const waits = new Map<number, (msg: any) => void>();
    let n = 0;
    let gone = false;
    const send = (msg: object) => {
      try {
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
        proc.stdin.flush();
      } catch {}
    };
    (async () => {
      for await (const lines of stream_lines(proc.stdout)) {
        for (const line of lines.map((l) => l.trim()).filter((l) => l !== "")) {
          const msg = Agent.parse(line) as any;
          if (msg === null || typeof msg !== "object") {
            continue;
          }
          if (msg.method === undefined) {
            waits.get(msg.id)?.(msg);
          } else if (msg.method === "notifications/tools/list_changed") {
            changed();
          } else if (msg.id !== undefined) {
            send(msg.method === "ping" ? { id: msg.id, result: {} } : { id: msg.id, error: { code: -32601, message: "Method not found" } });
          }
        }
      }
    })().catch(() => {}).finally(() => {
      gone = true;
      [...waits.values()].forEach((done) => done(null));
    });
    const ask = (method: string, params: object, signal: AbortSignal) => new Promise<any>((ok, no) => {
      if (signal.aborted || gone) {
        return no(gone ? new Error("the server quit.") : signal.reason);
      }
      const id = ++n;
      const stop = () => {
        waits.delete(id);
        send({ method: "notifications/cancelled", params: { requestId: id } });
        no(signal.reason);
      };
      waits.set(id, (msg) => {
        waits.delete(id);
        signal.removeEventListener("abort", stop);
        try {
          ok(msg === null ? Mcp.reply({ error: { message: "the server quit." } }) : Mcp.reply(msg));
        } catch (err) {
          no(err);
        }
      });
      signal.addEventListener("abort", stop, { once: true });
      send({ id, method, params });
    });
    const tell = async (method: string, params: object) => send({ method, params });
    const close = () => {
      gone = true;
      try {
        proc.stdin.end();
      } catch {}
      Mcp.stop(proc.pid);
    };
    return { ask, tell, close };
  }

  // Children
  // --------

  // a child kept, with its start time, in the file too
  export function adopt(pid: number): void {
    CHILDREN.set(pid, Mcp.started(pid));
    Mcp.save();
  }

  // a process's start time ("": none such)
  export function started(pid: number): string {
    return Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)]).stdout.toString().trim();
  }

  // a child's group told to end, then killed if it hasn't
  export function stop(pid: number): void {
    kill(-pid, "SIGTERM");
    setTimeout(() => {
      kill(-pid, "SIGKILL");
      CHILDREN.delete(pid);
      Mcp.save();
    }, GRACE).unref?.();
  }

  // as this unii quits: every child's group told to end (a browser may
  // close itself); the file stays, so the next start kills any left
  export function end(): void {
    for (const pid of CHILDREN.keys()) {
      kill(-pid, "SIGTERM");
    }
    CHILDREN.clear();
  }

  // at start: the groups of children listed in `file` killed, each only
  // if its process started when it was listed (else its pid is another's
  // now); the file then kept of this unii's children
  export function sweep(file: string): void {
    PIDS = file;
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {}
    for (const line of text.split("\n")) {
      const [pid, start] = line.split("\t");
      const n = Number(pid);
      if (Number.isInteger(n) && n > 1 && start && Mcp.started(n) === start) {
        kill(-n, "SIGKILL");
      }
    }
    Mcp.save();
  }

  export function save(): void {
    if (PIDS !== "") {
      fs.writeFileSync(PIDS, [...CHILDREN].map(([pid, start]) => pid + "\t" + start + "\n").join(""));
    }
  }

}

function kill(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {}
}
