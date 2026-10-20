// Logs test
// =========
// `bun test local/prime/logs.test.ts`. Claude Code's logs re-staged at
// each start: a new or grown log copied again, redacted; one unchanged
// left as it is; claude-mem's sessions and the projects the manifest
// leaves out never copied; subagents' logs (nested) neither.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { logs_skip, logs_sync } from "./logs.ts";

const KEY = "sk-ant-api03-" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";

function line(text: string): string {
  return JSON.stringify({ type: "user", timestamp: "2026-10-20T10:00:00.000Z", message: { role: "user", content: text } }) + "\n";
}

function tree(): { src: string; out: string } {
  const root = fs.mkdtempSync(os.tmpdir() + "/unii-logs-");
  const src = root + "/projects";
  for (const [file, text] of [
    ["-Volumes-dev-git-app/a.jsonl", line("use " + KEY)],
    ["-Volumes-dev-git-app/a/subagents/s.jsonl", line("a subagent's")],
    ["-Users-me--claude-mem-observer-sessions/o.jsonl", line("observer")],
    ["-Volumes-dev-git-left-out/l.jsonl", line("left out")],
  ]) {
    fs.mkdirSync(src + "/" + file.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(src + "/" + file, text);
  }
  return { src, out: root + "/staged" };
}

const MANIFEST = "# sign\tkind\tbytes\tpath\tnote\n-\tchatlog\t10\t/x/projects/-Volumes-dev-git-left-out\t1 logs\n+\tchatlog\t10\t/x/projects/-Volumes-dev-git-app\t1 logs\n";

test("a new log is staged redacted, dated as its source; others skipped", () => {
  const { src, out } = tree();
  const run = logs_sync(src, out, logs_skip(MANIFEST), []);
  expect(run).toEqual({ updated: 1, kept: 0, hits: { anthropic: 1 } });
  const staged = out + "/-Volumes-dev-git-app/a.jsonl";
  expect(fs.readFileSync(staged, "utf8")).toContain("use [REDACTED:anthropic]");
  expect(fs.readFileSync(staged, "utf8")).not.toContain(KEY);
  expect(fs.statSync(staged).mtimeMs).toBe(fs.statSync(src + "/-Volumes-dev-git-app/a.jsonl").mtimeMs);
  expect(fs.readdirSync(out)).toEqual(["-Volumes-dev-git-app"]);
  expect(fs.readdirSync(out + "/-Volumes-dev-git-app")).toEqual(["a.jsonl"]);
});

test("an unchanged log is kept as staged; a grown one is staged again", () => {
  const { src, out } = tree();
  const skip = logs_skip(MANIFEST);
  logs_sync(src, out, skip, []);
  const staged = out + "/-Volumes-dev-git-app/a.jsonl";
  fs.writeFileSync(staged, fs.readFileSync(staged, "utf8") + "marker\n");
  fs.utimesSync(staged, fs.statSync(src + "/-Volumes-dev-git-app/a.jsonl").atime, fs.statSync(src + "/-Volumes-dev-git-app/a.jsonl").mtime);
  expect(logs_sync(src, out, skip, [])).toEqual({ updated: 0, kept: 1, hits: {} });
  expect(fs.readFileSync(staged, "utf8")).toContain("marker");
  // 5 s past its own time: no clock (another test file may fake it)
  const later = new Date(fs.statSync(src + "/-Volumes-dev-git-app/a.jsonl").mtimeMs + 5000);
  fs.appendFileSync(src + "/-Volumes-dev-git-app/a.jsonl", line("a new message"));
  fs.utimesSync(src + "/-Volumes-dev-git-app/a.jsonl", later, later);
  expect(logs_sync(src, out, skip, []).updated).toBe(1);
  const text = fs.readFileSync(staged, "utf8");
  expect(text).toContain("a new message");
  expect(text).not.toContain("marker");
});

test("without a manifest, every project but claude-mem's is staged", () => {
  const { src, out } = tree();
  logs_sync(src, out, logs_skip(""), []);
  expect(fs.readdirSync(out).sort()).toEqual(["-Volumes-dev-git-app", "-Volumes-dev-git-left-out"]);
});

test("an environment secret's value never reaches a staged log", () => {
  const { src, out } = tree();
  const value = "q7Rz-plain-looking-value-0042";
  fs.appendFileSync(src + "/-Volumes-dev-git-app/a.jsonl", line("key " + value));
  logs_sync(src, out, logs_skip(MANIFEST), [value]);
  expect(fs.readFileSync(out + "/-Volumes-dev-git-app/a.jsonl", "utf8")).not.toContain(value);
});
