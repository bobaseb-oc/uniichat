// Proof
// =====
// RED ZONE (security review H1, DRAFT awaiting the user's sign-off): a
// device proves the server on this computer is the real one before it
// sends its session or takes a job. Any process may bind 127.0.0.1:8788
// first, so a loopback address proves nothing. The server and its devices
// share a per-install key, 32 random bytes in <dir>/server-key, mode 0600
// in a 0700 directory, so only this user can read it. The device sends a
// fresh random nonce; the server answers HMAC-SHA256(key, nonce); the
// device compares in constant time. No key, a bad answer, or any error is
// a refusal (fail closed).

import * as fs from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export namespace Proof {
  // a nonce: 32 random bytes, hex
  export const NONCE = /^[0-9a-f]{64}$/;

  // the install's key in dir, made (0600, its dir 0700) if there is none
  export function key(dir: string): Buffer {
    const path = dir + "/server-key";
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    try {
      const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      fs.writeSync(fd, randomBytes(32).toString("hex"));
      fs.closeSync(fd);
    } catch (e: any) {
      if (e?.code !== "EEXIST") {
        throw e;
      }
    }
    const st = fs.lstatSync(path);
    if (!st.isFile() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid?.()) {
      throw new Error("server-key: must be a file of this user, mode 0600");
    }
    const hex = fs.readFileSync(path, "utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new Error("server-key: unreadable");
    }
    return Buffer.from(hex, "hex");
  }

  // the server's answer to a nonce, or null for a malformed one
  export function answer(key: Buffer, nonce: string): string | null {
    if (!NONCE.test(nonce)) {
      return null;
    }
    return createHmac("sha256", key).update(nonce).digest("hex");
  }

  // whether the server at url holds the key: true only on a right answer
  export async function check(url: string, key: Buffer, get: typeof fetch = fetch): Promise<boolean> {
    try {
      const nonce = randomBytes(32).toString("hex");
      const res = await get(url + "/api/proof?n=" + nonce, { redirect: "error" });
      if (!res.ok) {
        return false;
      }
      const got = Buffer.from((await res.text()).trim(), "utf8");
      const want = Buffer.from(answer(key, nonce)!, "utf8");
      return got.length === want.length && timingSafeEqual(got, want);
    } catch {
      return false;
    }
  }
}
