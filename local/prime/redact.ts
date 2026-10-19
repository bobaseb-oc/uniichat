// Redact
// ======
// `bun local/prime/redact.ts`. Stages the manifest's taken sources
// (collect.ts) in ~/.unii-prime, secrets redacted: documents as text
// (staged.json: kind, path, date, text; each at most CAP characters),
// Claude Code logs as JSON lines again (claude/projects/<dir>/, read by
// `/import` through CLAUDE_CONFIG_DIR). A secret is a key of a known
// shape, a token or password assigned a literal, a private key, or the
// exact value of a secret-named environment variable; each becomes
// [REDACTED:<name>]. The report names files and counts, never values.

import * as fs from "node:fs";
import { manifest_read, OUT } from "./collect.ts";

// Constants
// =========

// a staged document's most characters (the rest is cut, and said so)
const CAP = 64 * 1024;

// shapes of secrets, by name, most specific first; a pattern with a
// group keeps it (what names the secret) and redacts the rest
const SHAPES: Array<[string, RegExp]> = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ["anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ["aws", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["github", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g],
  ["slack", /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ["databricks", /\bdapi[0-9a-f]{32}(?:-\d+)?\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ["bearer", /(\bBearer\s+)(?![$<{])[A-Za-z0-9._~+/-]{16,}=*/g],
  ["assigned", /(\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b["']?\s*[:=]\s*["']?)(?!os\.|process\.|\$|<|\{|\[REDACTED)[^\s"'\\,;)]{8,}/gi],
];

// name segments of a variable that holds a secret (PATH is not PAT)
const SECRET_PARTS = new Set(["KEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "SALT", "PAT", "CREDENTIAL", "CREDENTIALS", "AUTH"]);

// Types
// =====

// a count per secret's name
export type Hits = Record<string, number>;

// a document staged
export type Staged = { kind: string; path: string; date: string; text: string };

// Redact
// ======

// the values of the secret-named variables, 12 characters or more
export function env_secrets(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => name.toUpperCase().split("_").some((p) => SECRET_PARTS.has(p)) && (value ?? "").length >= 12)
    .map(([, value]) => value!);
}

export function redact(text: string, secrets: string[], hits: Hits = {}): { text: string; hits: Hits } {
  let out = text;
  for (const value of [...secrets].sort((a, b) => b.length - a.length)) {
    const n = out.split(value).length - 1;
    if (n > 0) {
      out = out.split(value).join("[REDACTED:env]");
      hits.env = (hits.env ?? 0) + n;
    }
  }
  for (const [name, shape] of SHAPES) {
    out = out.replace(shape, (_all, keep?: string) => {
      hits[name] = (hits[name] ?? 0) + 1;
      return (typeof keep === "string" ? keep : "") + "[REDACTED:" + name + "]";
    });
  }
  return { text: out, hits };
}

// a JSON line with every string in it redacted; null: no JSON
export function redact_json(line: string, secrets: string[], hits: Hits = {}): { text: string; hits: Hits } | null {
  let j: unknown;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  const walk = (x: unknown): unknown =>
    typeof x === "string" ? redact(x, secrets, hits).text
    : Array.isArray(x) ? x.map(walk)
    : x !== null && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
    : x;
  return { text: JSON.stringify(walk(j)), hits };
}

// Extract
// =======

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

// the texts of an OOXML part's elements named `tag` (a:t, t)
function xml_texts(xml: string, tag: string): string[] {
  const shape = new RegExp("<" + tag + "(?: [^>]*)?>([^<]*)</" + tag + ">", "g");
  return [...xml.matchAll(shape)].map((m) => m[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]));
}

function run(cmd: string[]): string {
  const out = Bun.spawnSync(cmd);
  if (out.exitCode !== 0) {
    throw new Error(cmd[0] + " failed: " + out.stderr.toString().slice(0, 200));
  }
  return out.stdout.toString();
}

// a document's text: as it is (md, txt), by pdftotext or textutil, or
// from its OOXML parts by unzip (pptx slides, xlsx shared strings; not
// Import.ts zip_file, whose file-slice inflate hangs on Bun 1.3.8)
export function extract(path: string): string {
  const ext = path.split(".").pop()!.toLowerCase();
  switch (ext) {
    case "md":
    case "txt": {
      return fs.readFileSync(path, "utf8");
    }
    case "pdf": {
      return run(["pdftotext", "-enc", "UTF-8", path, "-"]);
    }
    case "docx":
    case "doc":
    case "rtf": {
      return run(["textutil", "-convert", "txt", "-stdout", path]);
    }
    case "pptx": {
      const names = run(["unzip", "-Z1", path]).split("\n").filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      const slide = (n: string) => Number(n.match(/\d+/)![0]);
      return names.sort((a, b) => slide(a) - slide(b)).map((n) => "[slide " + slide(n) + "]\n" + xml_texts(run(["unzip", "-p", path, n]), "a:t").join(" ")).join("\n\n");
    }
    case "xlsx": {
      return xml_texts(run(["unzip", "-p", path, "xl/sharedStrings.xml"]), "t").join(" | ");
    }
    default: {
      throw new Error("no text extractor for ." + ext);
    }
  }
}

function capped(text: string): string {
  return text.length <= CAP ? text : text.slice(0, CAP) + "\n[cut: " + CAP + " of " + text.length + " characters]";
}

// Stage
// =====

function report_line(path: string, hits: Hits): string {
  return path + "\t" + Object.entries(hits).map(([k, n]) => k + "=" + n).join(" ");
}

if (import.meta.main) {
  const secrets = env_secrets(process.env);
  const lines = manifest_read(fs.readFileSync(OUT + "/manifest.txt", "utf8")).filter((l) => l.take);
  const staged: Staged[] = [];
  const report: string[] = [];
  const total: Hits = {};
  const add = (path: string, hits: Hits) => {
    if (Object.keys(hits).length > 0) {
      report.push(report_line(path, hits));
      Object.entries(hits).forEach(([k, n]) => (total[k] = (total[k] ?? 0) + n));
    }
  };
  fs.rmSync(OUT + "/claude", { recursive: true, force: true });
  for (const l of lines.filter((l) => l.kind !== "chatlog")) {
    try {
      const { text, hits } = redact(capped(extract(l.path)), secrets);
      staged.push({ kind: l.kind, path: l.path, date: fs.statSync(l.path).mtime.toISOString(), text });
      add(l.path, hits);
    } catch (err: any) {
      console.error("skip", l.path + ":", err.message);
    }
  }
  let logs = 0;
  for (const l of lines.filter((l) => l.kind === "chatlog")) {
    const dir = OUT + "/claude/projects/" + l.path.split("/").pop();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const f of fs.readdirSync(l.path).filter((f) => f.endsWith(".jsonl"))) {
      const hits: Hits = {};
      const out = fs.readFileSync(l.path + "/" + f, "utf8").split("\n").flatMap((line) => redact_json(line, secrets, hits)?.text ?? []);
      fs.writeFileSync(dir + "/" + f, out.join("\n") + "\n", { mode: 0o600 });
      add(l.path + "/" + f, hits);
      logs += 1;
    }
  }
  fs.writeFileSync(OUT + "/staged.json", JSON.stringify(staged), { mode: 0o600 });
  fs.writeFileSync(OUT + "/redaction-report.txt", report.join("\n") + "\n", { mode: 0o600 });
  console.log("staged:", staged.length, "documents,", logs, "logs");
  console.log("redacted:", Object.entries(total).map(([k, n]) => k + "=" + n).join(" ") || "nothing", "in", report.length, "files (report: " + OUT + "/redaction-report.txt)");
}
