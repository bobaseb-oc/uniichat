// Config test
// ===========
// `bun test Config.test.ts`. Security review I: the Claude API's origin
// (anthropic_url, from LITELLM_API_BASE) is https, or http on this
// computer only (a local gateway); any other refuses to start. Each runs
// in its own process, as Config reads the environment once, at import.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-config-");
const CODE = 'import { ANTHROPIC_URL } from "./Config.ts"; console.log(ANTHROPIC_URL)';

// Config imported with anthropic_url set: its exit code and output
function start(url: string): { code: number; text: string } {
  const out = Bun.spawnSync([process.execPath, "-e", CODE], { cwd: import.meta.dir, env: { ...process.env, UNII_DIR: DIR, UNII_ANTHROPIC_URL: url } });
  return { code: out.exitCode, text: (out.stdout.toString() + out.stderr.toString()).trim() };
}

test("anthropic_url: https, or http on 127.0.0.1, localhost or [::1]", () => {
  for (const url of ["https://litellm.example.com", "http://127.0.0.1:4000", "http://localhost:4000", "http://[::1]:4000"]) {
    expect(start(url)).toEqual({ code: 0, text: url });
  }
});

test("anthropic_url: plain http elsewhere, or no URL, refuses to start", () => {
  for (const url of ["http://litellm.example.com", "http://127.0.0.1.evil.example", "http://10.0.0.5:4000", "ftp://x.example", "not a url"]) {
    const out = start(url);
    expect(out.code).not.toBe(0);
    expect(out.text).toContain("config: anthropic_url");
  }
});
