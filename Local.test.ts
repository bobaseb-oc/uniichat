// Local test
// ==========
// `bun test Local.test.ts`. This build's local-only changes: the Claude
// API's origin set by `anthropic_url` (a proxy, e.g. LiteLLM), and a
// `unii` that opens 127.0.0.1 unless told otherwise and never updates
// itself by `curl | sh`. Each runs in its own process, as Config reads
// the environment once, at its import.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-local-");

// `code` run by bun in this dir, with `env`: its output, trimmed
function run(code: string, env: Record<string, string> = {}): string {
  const out = Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...process.env, UNII_DIR: DIR, ...env } });
  return (out.stdout.toString() + out.stderr.toString()).trim();
}

// `bun Term.ts <args>` with `env` (no UNII_URL): its exit code and output
function term(args: string[], env: Record<string, string> = {}): { code: number; text: string } {
  const { UNII_URL, ...rest } = process.env;
  const out = Bun.spawnSync([process.execPath, import.meta.dir + "/Term.ts", ...args], { env: { ...rest, UNII_HOME: DIR, UNII_NO_TELEMETRY: "1", ...env } });
  return { code: out.exitCode, text: out.stdout.toString() + out.stderr.toString() };
}

test("the Claude API's origin is api.anthropic.com unless anthropic_url sets it", () => {
  const { UNII_ANTHROPIC_URL, ...rest } = process.env;
  const code = 'import { ANTHROPIC_URL } from "./Config.ts"; console.log(ANTHROPIC_URL)';
  const out = Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...rest, UNII_DIR: DIR } });
  expect(out.stdout.toString().trim()).toBe("https://api.anthropic.com");
  expect(run(code, { UNII_ANTHROPIC_URL: "https://proxy.example/" })).toBe("https://proxy.example");
});

test("messages and token counts both go to anthropic_url, with the key", async () => {
  const seen: string[] = [];
  const proxy = Bun.serve({
    hostname : "127.0.0.1",
    port     : 0,
    fetch    : (req) => {
      seen.push(new URL(req.url).pathname + " " + req.headers.get("x-api-key"));
      return Response.json({ input_tokens: 7 });
    },
  });
  const origin = "http://127.0.0.1:" + proxy.port;
  const code = [
    'import { Anthropic } from "./Anthropic.ts";',
    "console.log(Anthropic.wire.url);",
    'console.log(await Anthropic.count("k-test", { speed: "slow" } as any, { max_tokens: 1, stream: true, messages: [] }));',
  ].join("\n");
  const out = Bun.spawn([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...process.env, UNII_DIR: DIR, UNII_ANTHROPIC_URL: origin }, stdout: "pipe" });
  const text = (await new Response(out.stdout).text()).trim();
  proxy.stop(true);
  expect(text).toBe(origin + "/v1/messages\n7");
  expect(seen).toEqual(["/v1/messages/count_tokens k-test"]);
});

test("unii opens the local server unless told another", () => {
  const help = term(["help"]);
  expect(help.text).toContain("else http://127.0.0.1:8788");
  expect(help.text).not.toContain("uniichat.com");
});

test("unii update refuses, and never runs curl", () => {
  const bin = fs.mkdtempSync(os.tmpdir() + "/unii-bin-");
  const mark = bin + "/ran";
  fs.writeFileSync(bin + "/curl", "#!/bin/sh\ntouch '" + mark + "'\n", { mode: 0o755 });
  const out = term(["update"], { PATH: bin + ":" + process.env.PATH });
  expect(out.code).not.toBe(0);
  expect(out.text).toContain("disabled");
  expect(fs.existsSync(mark)).toBe(false);
});

test("web searches per request: 10 unless `searches` sets them (0: no web tool)", () => {
  const { UNII_SEARCHES, ...rest } = process.env;
  const code = 'import { SEARCHES } from "./Tools.ts"; console.log(SEARCHES)';
  const out = Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...rest, UNII_DIR: DIR } });
  expect(out.stdout.toString().trim()).toBe("10");
  expect(run(code, { UNII_SEARCHES: "0" })).toBe("0");
});

test("unii refuses a server not on this computer, given or from UNII_URL", () => {
  for (const [args, env] of [[["https://uniichat.invalid"], {}], [[], { UNII_URL: "https://example.invalid" }]] as const) {
    const out = term([...args], env);
    expect(out.code).not.toBe(0);
    expect(out.text).toContain("this computer only");
  }
});

// the code this build runs (not docs, tests, nor the iOS app it never
// builds), each line not a comment
test("no code names uniichat.com or bend-lang.com", () => {
  const files = Bun.spawnSync(["git", "ls-files"], { cwd: import.meta.dir }).stdout.toString().split("\n")
    .filter((f) => /\.(ts|js|html|sh|txt|swift|css)$|^hello\.md$/.test(f) && !f.endsWith(".test.ts") && !f.startsWith("ios/"));
  const hits = files.flatMap((f) => fs.readFileSync(import.meta.dir + "/" + f, "utf8").split("\n")
    .map((line, n) => [f + ":" + (n + 1), line] as const)
    .filter(([, line]) => /uniichat\.com|bend-lang\.com/.test(line) && !/^\s*(\/\/|#)/.test(line))
    .map(([at]) => at));
  expect(hits).toEqual([]);
});
