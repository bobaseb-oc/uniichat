// Launcher test
// =============
// `bun test Launcher.test.ts`. RED ZONE (security review M2): local/legion
// (local/unii-local.sh, the same file) starts the terminal and `legion
// device` with none of the gateway's or vendors' secrets in their
// environment, so no job they run inherits one. A fake bun on PATH tells
// the names it was given (never a value).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const SECRETS = ["LITELLM_API_KEY", "LITELLM_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "RESEND_API_KEY", "APNS_KEY"];

test("local/legion and unii-local.sh are one file", () => {
  expect(fs.readFileSync(import.meta.dir + "/local/legion", "utf8")).toBe(fs.readFileSync(import.meta.dir + "/local/unii-local.sh", "utf8"));
});

test("the terminal is started with no secret in its environment", () => {
  const bin = fs.mkdtempSync(os.tmpdir() + "/legion-bin-");
  fs.writeFileSync(bin + "/bun", "#!/bin/sh\nenv | cut -d= -f1\n");
  fs.chmodSync(bin + "/bun", 0o755);
  const env: Record<string, string> = { PATH: bin + ":/usr/bin:/bin", HOME: os.homedir(), UNII_DIR: fs.mkdtempSync(os.tmpdir() + "/legion-dir-"), LITELLM_API_BASE: "http://gw.example" };
  for (const k of SECRETS) {
    env[k] = "fake";
  }
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "version"], { env });
  const names = out.stdout.toString().split("\n");
  expect(names).toContain("UNII_IMPORT_DIRS");
  expect(SECRETS.filter((k) => names.includes(k))).toEqual([]);
});
