// Term test
// =========
// `bun test Term.test.ts`. RED ZONE (security review H1): `legion device`
// sends its saved session only to a server that proves itself with the
// install's key (Proof.ts): a process that took the port first gets no
// Bearer (not by /api/me, not by the socket); the real server does.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Proof } from "./Proof.ts";

// a fake server: what each request's authorization was; it answers the
// proof as the install's (honest) or not
function fake(key: Buffer, honest: boolean) {
  const auths: string[] = [];
  const srv = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, s) {
      const u = new URL(req.url);
      if (u.pathname === "/api/proof") {
        return new Response(honest ? Proof.answer(key, u.searchParams.get("n") ?? "") ?? "" : "0".repeat(64));
      }
      auths.push(u.pathname + " " + String(req.headers.get("authorization")));
      if (u.pathname === "/ws" && s.upgrade(req)) {
        return undefined;
      }
      return Response.json({ ok: true });
    },
    websocket: { open: (ws) => ws.send(JSON.stringify({ $: "view", parts: [], turn: 0 })), message: () => {} },
  });
  return { srv, auths };
}

// `legion device` against srv, signed in (a saved token), the install's
// key in keys: its output after ms
async function device(port: number, keys: string, ms: number): Promise<string> {
  const home = fs.mkdtempSync(os.tmpdir() + "/legion-term-");
  fs.mkdirSync(home + "/127.0.0.1:" + port, { recursive: true });
  fs.writeFileSync(home + "/127.0.0.1:" + port + "/token", "sekrit", { mode: 0o600 });
  const { UNII_URL, ...rest } = process.env;
  const env = { ...rest, UNII_HOME: home, UNII_DIR: keys, UNII_WORK: home + "/work", UNII_SPACES: home, UNII_NO_TELEMETRY: "1" };
  const proc = Bun.spawn([process.execPath, import.meta.dir + "/Term.ts", "device", "http://127.0.0.1:" + port], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  await Bun.sleep(ms);
  proc.kill();
  return (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
}

test("legion device never sends its session to a server that can't prove itself", async () => {
  const keys = fs.mkdtempSync(os.tmpdir() + "/legion-keys-");
  const { srv, auths } = fake(Proof.key(keys), false);
  try {
    const out = await device(srv.port, keys, 2500);
    expect(auths.filter((a) => a.includes("sekrit"))).toEqual([]);
    expect(out).toContain("not proven");
  } finally {
    srv.stop(true);
  }
});

test("legion device connects with its session to the server that proves itself", async () => {
  const keys = fs.mkdtempSync(os.tmpdir() + "/legion-keys-");
  const { srv, auths } = fake(Proof.key(keys), true);
  try {
    await device(srv.port, keys, 2500);
    expect(auths).toContain("/ws Bearer sekrit");
  } finally {
    srv.stop(true);
  }
});
