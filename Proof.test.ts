import { test, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Proof } from "./Proof.ts";

function dir(): string {
  return fs.mkdtempSync(os.tmpdir() + "/proof-");
}

test("key is made once, 0600 in a 0700 dir, and kept", () => {
  const d = dir() + "/home";
  const a = Proof.key(d);
  expect(a.length).toBe(32);
  expect(fs.statSync(d + "/server-key").mode & 0o777).toBe(0o600);
  expect(fs.statSync(d).mode & 0o777).toBe(0o700);
  expect(Proof.key(d).equals(a)).toBe(true);
});

test("key refuses a file others can read, or a symlink", () => {
  const d = dir();
  Proof.key(d);
  fs.chmodSync(d + "/server-key", 0o644);
  expect(() => Proof.key(d)).toThrow("0600");
  const e = dir();
  fs.writeFileSync(e + "/real", "a".repeat(64), { mode: 0o600 });
  fs.symlinkSync(e + "/real", e + "/server-key");
  expect(() => Proof.key(e)).toThrow("0600");
});

test("answer refuses a malformed nonce and differs by key", () => {
  const n = "ab".repeat(32);
  expect(Proof.answer(Buffer.alloc(32, 1), "x")).toBeNull();
  expect(Proof.answer(Buffer.alloc(32, 1), n + "0")).toBeNull();
  expect(Proof.answer(Buffer.alloc(32, 1), n)).not.toBe(Proof.answer(Buffer.alloc(32, 2), n));
});

test("check passes only the server holding the key", async () => {
  const key = Buffer.alloc(32, 7);
  const serve = (k: Buffer | null, status = 200) => (async (u: any) => {
    const n = new URL(String(u)).searchParams.get("n")!;
    return new Response(k === null ? "nope" : Proof.answer(k, n)!, { status });
  }) as any;
  expect(await Proof.check("http://127.0.0.1:1", key, serve(key))).toBe(true);
  expect(await Proof.check("http://127.0.0.1:1", key, serve(Buffer.alloc(32, 8)))).toBe(false);
  expect(await Proof.check("http://127.0.0.1:1", key, serve(null))).toBe(false);
  expect(await Proof.check("http://127.0.0.1:1", key, serve(key, 500))).toBe(false);
  expect(await Proof.check("http://127.0.0.1:1", key, (async () => { throw new Error("down"); }) as any)).toBe(false);
});
