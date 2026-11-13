// Secure test
// ===========
// `bun test Secure.test.ts`: the security review's (SC) guards on the
// site's HTTP, against `./Server.ts <port>` on a fresh dir, signed in as
// a browser is (its emailed link, printed with no mail key, then the
// button's POST): the device's proof, Origin and Host, the headers HTML
// goes with, what an error tells, the bodies read before sign-in.

import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { createHmac } from "node:crypto";

const PORT = 9591;
const SITE = "http://127.0.0.1:" + PORT;
const DIR  = fs.mkdtempSync(os.tmpdir() + "/unii-secure-");
let proc: Bun.Subprocess<"ignore", "pipe", "inherit">;
let printed = "";
let cookie = "";

beforeAll(async () => {
  proc = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", String(PORT)], {
    env    : { ...process.env, UNII_DIR: DIR, UNII_SITE: SITE, UNII_WORK: DIR + "/work" },
    stdout : "pipe",
    stderr : "inherit",
  });
  (async () => {
    for await (const piece of proc.stdout) {
      printed += new TextDecoder().decode(piece);
    }
  })();
  for (let k = 0; k < 100 && (await fetch(SITE + "/api/hello").catch(() => null)) === null; k++) {
    await Bun.sleep(50);
  }
  const asked = await fetch(SITE + "/api/login", { method: "POST", body: JSON.stringify({ who: "me@x.com" }) });
  expect(asked.status).toBe(200);
  for (let k = 0; k < 50 && !printed.includes("/auth?t="); k++) {
    await Bun.sleep(20);
  }
  const t = /\/auth\?t=(\S+)/.exec(printed)?.[1] ?? "";
  const body = new URLSearchParams({ t }).toString();
  const res = await fetch(SITE + "/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: SITE }, body, redirect: "manual" });
  cookie = /^(unii=[^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  expect(cookie).not.toBe("");
});

afterAll(async () => {
  proc.kill();
  await proc.exited;
  fs.rmSync(DIR, { recursive: true, force: true });
});

// RED ZONE (security review H1, DRAFT awaiting the user's sign-off): the
// server answers a device's nonce with HMAC-SHA256 of the install's key
test("/api/proof answers a nonce with the key's HMAC; a malformed one, 400", async () => {
  const key = Buffer.from(fs.readFileSync(DIR + "/server-key", "utf8").trim(), "hex");
  const n = "ab".repeat(32);
  const res = await fetch(SITE + "/api/proof?n=" + n);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe(createHmac("sha256", key).update(n).digest("hex"));
  for (const bad of ["", "xyz", n + "0", n.toUpperCase()]) {
    expect((await fetch(SITE + "/api/proof?n=" + bad)).status).toBe(400);
  }
});

// RED ZONE (security review SC, DRAFT awaiting the user's sign-off): a
// post or socket with an Origin must be the site's; any request's Host
// one the server is (DNS rebinding); none of these said passes
test("Origin: another's refuses posts and sockets; Host: only the site's", async () => {
  const post = (origin: string | null) => fetch(SITE + "/api/logout", { method: "POST", headers: origin === null ? {} : { origin } });
  expect((await post("http://evil.example")).status).toBe(403);
  expect((await post("null")).status).toBe(403);
  expect((await post(SITE)).status).toBe(204);
  expect((await post("http://localhost:" + PORT)).status).toBe(204);
  expect((await post(null)).status).toBe(204);
  const ws = (origin: string | null) => fetch(SITE + "/ws", { headers: { cookie, ...(origin === null ? {} : { origin }) } });
  expect((await ws("http://evil.example")).status).toBe(403);
  expect((await ws(null)).status).toBe(400); // past the guard: not an upgrade
  expect((await ws(SITE)).status).toBe(400);
  const host = (h: string) => fetch(SITE + "/api/hello", { headers: { host: h } });
  expect((await host("evil.example")).status).toBe(403);
  expect((await host("evil.example:" + PORT)).status).toBe(403);
  expect((await host("127.0.0.1:" + PORT)).status).toBe(200);
  expect((await host("localhost:" + PORT)).status).toBe(200);
});

test("HTML goes with a CSP; every answer with nosniff and no referrer; /tree runs no inline script", async () => {
  const page = await fetch(SITE + "/");
  const csp = page.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(page.headers.get("x-content-type-options")).toBe("nosniff");
  expect(page.headers.get("referrer-policy")).toBe("no-referrer");
  const hello = await fetch(SITE + "/api/hello");
  expect(hello.headers.get("x-content-type-options")).toBe("nosniff");
  expect(hello.headers.get("content-security-policy")).toBeNull();
  const signin = await fetch(SITE + "/auth?t=nothing", { redirect: "manual" });
  expect(signin.headers.get("x-content-type-options")).toBe("nosniff");
  const tree = await fetch(SITE + "/tree", { headers: { cookie } });
  expect(tree.status).toBe(200);
  expect(tree.headers.get("content-security-policy")).toContain("script-src 'self'");
  expect(await tree.text()).not.toContain("<script");
});

// what's read before anyone is signed in is small: /api/delete's
test("/api/delete reads at most a small body", async () => {
  const big = JSON.stringify({ confirm: "x".repeat(64 * 1024) });
  expect((await fetch(SITE + "/api/delete", { method: "POST", body: big })).status).toBe(413);
  expect((await fetch(SITE + "/api/delete", { method: "POST", body: JSON.stringify({ confirm: "no" }) })).status).toBe(400);
});

// an error no one meant to show (a bug, a path, a library's words) is
// logged, and the client told only that something failed; one meant for
// the user (Chat.told) is told as it is
const FAIL = `
const { Chat, Main } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
const config = await import(${JSON.stringify(import.meta.dir + "/Config.ts")});
const fs = await import("node:fs");
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const failed = Chat.fail(new Error("ENOENT: /Users/x/.unii/secret"));
const told = Chat.fail(Chat.told("An import has no kind x."));
Cloud.who = () => { throw new Error("SQLITE_CORRUPT at /Users/x/.unii/cloud.db"); };
const res = await Main.http(new Request("http://127.0.0.1/api/hello", { headers: { host: new URL(config.SITE).host } }), {});
const mem = Memory.load(config.DIR + "/m", () => ({}));
Memory.save(mem);
const saved = fs.statSync(config.DIR + "/m/view.json").mode & 0o777;
console.log(JSON.stringify({ failed, told, status: res.status, body: await res.text(), body_max: Main.BODY, buffer: Main.BUFFER, saved }));
process.exit(0);
`;

test("unexpected errors tell the client nothing of them; meant ones are told; limits are finite; the chat's state is 0600", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-secure-");
  fs.writeFileSync(dir + "/fail.ts", FAIL);
  const run = Bun.spawn([process.execPath, dir + "/fail.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "pipe" });
  const out = JSON.parse((await new Response(run.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  const logged = await new Response(run.stderr).text();
  expect(JSON.stringify(out.failed)).not.toContain("secret");
  expect(out.failed.error).toMatch(/went wrong/);
  expect(out.told).toEqual({ error: "An import has no kind x." });
  expect(out.status).toBe(500);
  expect(out.body).not.toContain("SQLITE");
  expect(out.body).not.toContain("/Users");
  expect(logged).toContain("SQLITE_CORRUPT");
  expect(logged).toContain("ENOENT");
  const { FRAME } = await import("./View.ts");
  expect(out.body_max).toBeLessThanOrEqual(2 ** 32);
  expect(out.buffer).toBeGreaterThanOrEqual(FRAME);
  expect(out.buffer).toBeLessThanOrEqual(4 * FRAME);
  // the chat's state (Memory.save) is this user's alone
  expect(out.saved).toBe(0o600);
});

// a body that says it's over Main.BODY is refused (413) before any of it
// is read, signed in or not
test("a body over Main.BODY is refused unread", async () => {
  const head = await new Promise<string>((done) => {
    let out = "";
    Bun.connect({ hostname: "127.0.0.1", port: PORT, socket: {
      open: (s) => void s.write("POST /api/act HTTP/1.1\r\nHost: 127.0.0.1:" + PORT + "\r\nContent-Length: " + (2 ** 32 + 1) + "\r\n\r\nx"),
      data: (s, d) => { out += d.toString(); if (out.includes("\r\n")) { s.end(); done(out); } },
      close: () => done(out),
    } });
    setTimeout(() => done(out), 2000);
  });
  expect(head.split("\r\n")[0]).toBe("HTTP/1.1 413 Request Entity Too Large");
});
