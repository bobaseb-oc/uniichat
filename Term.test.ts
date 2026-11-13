// Term test
// =========
// `bun test Term.test.ts`. RED ZONE (security review U1, DRAFT awaiting
// the user's sign-off): `legion device` and `legion login` reach their
// server only over its unix socket (<UNII_DIR>/server.sock, in a 0700
// dir), never over TCP: a process that took the port first (one relaying
// the real server, the old proof's hole) gets no Bearer and no new
// session's key, the real server's socket does.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

// what each request's method, path and authorization was, and the body
type Seen = string[];

// a squatter on a TCP port: it answers everything, as a relay would
function squatter(seen: Seen) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req, s) {
      seen.push(req.method + " " + new URL(req.url).pathname + " " + String(req.headers.get("authorization")) + " " + (await req.text()));
      return s.upgrade(req) ? undefined : Response.json({ ok: true, code: "c" });
    },
    websocket: { open: (ws) => ws.send(JSON.stringify({ $: "view", parts: [], turn: 0 })), message: () => {} },
  });
}

// the real server's socket in dir: it signs in at once
function real(dir: string, seen: Seen) {
  return Bun.serve({
    unix: dir + "/server.sock",
    async fetch(req, s) {
      seen.push(req.method + " " + new URL(req.url).pathname + " " + String(req.headers.get("authorization")) + " " + req.headers.get("host"));
      if (new URL(req.url).pathname === "/api/hello") {
        return Response.json({ bills: false, github: false });
      }
      return s.upgrade(req) ? undefined : Response.json({ ok: true, code: "c" });
    },
    websocket: { open: (ws) => ws.send(JSON.stringify({ $: "view", parts: [], turn: 0 })), message: () => {} },
  });
}

// the server's dir (UNII_DIR), 0700, and a home with this port's token
function dirs(port: number, token: boolean) {
  const dir = fs.mkdtempSync(os.tmpdir() + "/legion-keys-");
  fs.chmodSync(dir, 0o700);
  const home = fs.mkdtempSync(os.tmpdir() + "/legion-term-");
  fs.mkdirSync(home + "/127.0.0.1:" + port, { recursive: true });
  if (token) {
    fs.writeFileSync(home + "/127.0.0.1:" + port + "/token", "sekrit", { mode: 0o600 });
  }
  return { dir, home };
}

// `legion <args> http://127.0.0.1:<port>`: its output after ms, or once it ends
async function legion(args: string[], port: number, dir: string, home: string, ms: number, stdin = ""): Promise<string> {
  const { UNII_URL, ...rest } = process.env;
  const env = { ...rest, UNII_HOME: home, UNII_DIR: dir, UNII_WORK: home + "/work", UNII_SPACES: home, UNII_NO_TELEMETRY: "1" };
  const proc = Bun.spawn([process.execPath, import.meta.dir + "/Term.ts", ...args, "http://127.0.0.1:" + port], { env, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  await Promise.race([proc.exited, Bun.sleep(ms)]);
  proc.kill();
  return (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
}

test("legion device: with no server socket, the TCP port's squatter gets nothing; it says so and waits", async () => {
  const squat: Seen = [];
  const srv = squatter(squat);
  try {
    const { dir, home } = dirs(srv.port, true);
    const out = await legion(["device"], srv.port, dir, home, 2500);
    expect(squat).toEqual([]);
    expect(out).toContain("no server socket");
  } finally {
    srv.stop(true);
  }
});

test("legion device: the real server's socket gets its session, the TCP port's squatter nothing (no relay)", async () => {
  const squat: Seen = [];
  const sq = squatter(squat);
  const seen: Seen = [];
  const { dir, home } = dirs(sq.port, true);
  const srv = real(dir, seen);
  try {
    await legion(["device"], sq.port, dir, home, 2500);
    expect(seen).toContain("GET /api/me Bearer sekrit 127.0.0.1:" + sq.port);
    expect(seen.some((s) => s.startsWith("GET /ws Bearer sekrit"))).toBe(true);
    expect(squat).toEqual([]);
  } finally {
    srv.stop(true);
    sq.stop(true);
  }
});

test("legion login: the new session's key goes to the real server's socket only, never the TCP port", async () => {
  const squat: Seen = [];
  const sq = squatter(squat);
  const { dir, home } = dirs(sq.port, false);
  // no socket: it refuses, sending nothing
  expect(await legion(["login"], sq.port, dir, home, 3000, "me@x.com\n")).toContain("no server");
  expect(squat).toEqual([]);
  const seen: Seen = [];
  const srv = real(dir, seen);
  try {
    expect(await legion(["login"], sq.port, dir, home, 3000, "me@x.com\n")).toContain("Signed in.");
    expect(seen.some((s) => s.startsWith("POST /api/login"))).toBe(true);
    expect(seen.some((s) => s.startsWith("GET /api/wait Bearer "))).toBe(true);
    expect(squat).toEqual([]);
  } finally {
    srv.stop(true);
    sq.stop(true);
  }
});
