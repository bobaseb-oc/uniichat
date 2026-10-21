// Knowledge
// =========
// `bun local/prime/knowledge.ts`. OnCorps knowledge for the memory tree,
// as a Claude website export (~/.unii-prime/knowledge.json, for
// `/import ~/.unii-prime/knowledge.json`), every text redacted:
// - OKF's markdown (src/, plans/) at its branch, read from git, never
//   its working tree; a document a chat, dated by its last commit
// - graphify's guides over all_oncorps (agent guides, onboarding,
//   process, repo lists), by name: never its per-file bulk
// - from no source a security audit (AUDITS)
// - a digest of each repo used most (DIGESTS): its docs at its default
//   branch (origin/HEAD), its layout, last commits and active branches,
//   at most DIGEST characters, dated by its newest commit
// - a card of each all_oncorps repo: its purpose (its README's first
//   paragraph, or its package's description), language, newest commit;
//   all one chat, a card a message, oldest first, so a run later brings
//   only the cards of repos with new commits (Import.ts import_new)
// Nothing is fetched: the repos are read as last pulled.

import * as fs from "node:fs";
import * as path from "node:path";
import { OUT } from "./collect.ts";
import { env_secrets, redact, type Staged } from "./redact.ts";
import { chats } from "./export.ts";

// Constants
// =========

const GIT = "/Volumes/dev/git";

const OKF = { dir: GIT + "/oncorps-knowledge-framework", branch: "PLP-2084-okf" };

const GRAPHIFY = GIT + "/all_oncorps/graphify-out";

const GUIDES = /^(AGENT_GUIDE_[A-Z_]+|ONBOARDING(_[A-Z_]+)?|PROCESS|SEMANTIC_REPOS|STUB_REPOS)\.md$/;

// the repos used most (Claude Code's logs, 2026-09-21 to 2026-10-21)
const DIGESTS = [
  "databricks-pimco-pay-exceptions.git",
  "agent-foundations",
  "agentic-check-writing",
  "ml-table-extractor-financial-reporting",
  "audit-the-scaffold",
  "oncorps-shared-skills",
  "databricks-bank-recon",
].map((r) => GIT + "/" + r);

const CARDS = GIT + "/all_oncorps";

const GROUP = "all_oncorps repo cards";

// a digest's most characters; a README's and another doc's in it
const DIGEST = 40 * 1024;
const README = 12 * 1024;
const DOC = 4 * 1024;

// a card's purpose's most characters
const PURPOSE = 300;

// files the agent reads live (local/rules.md), and copies of others
const RULES = /(^|\/)(AGENTS|CLAUDE)(\.local)?\.md$/i;
const COPIES = /(^|\/)(node_modules|vendor|\.venv|dist|build)\//;

// security audits, wherever they are (OKF keeps copies too): what is weak
// where has no place in a memory an injected text could send away
const AUDITS = /security[-_ ]?audit/i;

const CODE = new Set(["py", "ts", "tsx", "js", "jsx", "php", "sql", "scala", "java", "go", "rs", "cs", "rb", "sh", "swift", "kt", "r"]);

// Git
// ===

function git(dir: string, ...args: string[]): string {
  const out = Bun.spawnSync(["git", "-C", dir, ...args]);
  if (out.exitCode !== 0) {
    throw new Error("git " + args[0] + " failed in " + dir);
  }
  return out.stdout.toString();
}

function iso(date: string): string {
  return new Date(date.trim()).toISOString();
}

// the default branch (origin/HEAD), else what is checked out
function default_ref(dir: string): string {
  try {
    return git(dir, "rev-parse", "--abbrev-ref", "origin/HEAD").trim();
  } catch {
    return "HEAD";
  }
}

function files(dir: string, ref: string, ...under: string[]): string[] {
  return git(dir, "ls-tree", "-r", "--name-only", ref, "--", ...under).split("\n").filter((f) => f !== "" && !COPIES.test(f) && !AUDITS.test(f));
}

function show(dir: string, ref: string, file: string): string {
  return git(dir, "show", ref + ":" + file);
}

// its branches, newest first: date, name, subject
function branches(dir: string, count: number): string[] {
  return git(dir, "for-each-ref", "--sort=-committerdate", "--count=" + (count + 1), "--format=%(committerdate:iso-strict)\t%(refname:short)\t%(subject)", "refs/heads", "refs/remotes")
    .split("\n").filter((l) => l !== "" && !/\torigin\/HEAD\t|\torigin\t/.test(l)).slice(0, count);
}

function cut(text: string, most: number): string {
  return text.length <= most ? text : text.slice(0, most) + "\n[cut: " + most + " of " + text.length + " characters]";
}

function clean(secrets: string[]) {
  return (text: string) => redact(text, secrets).text;
}

// Sources
// =======

export function okf(dir: string, branch: string, secrets: string[]): Staged[] {
  return files(dir, branch, "src", "plans").filter((f) => f.endsWith(".md")).map((f) => ({
    kind : "knowledge",
    path : dir + "@" + branch + ":" + f,
    date : iso(git(dir, "log", "-1", "--format=%cI", branch, "--", f)),
    text : clean(secrets)(show(dir, branch, f)),
  }));
}

export function graphify(dir: string, secrets: string[]): Staged[] {
  return fs.readdirSync(dir).filter((f) => GUIDES.test(f) && !AUDITS.test(f)).map((f) => ({
    kind : "knowledge",
    path : dir + "/" + f,
    date : fs.statSync(dir + "/" + f).mtime.toISOString(),
    text : clean(secrets)(fs.readFileSync(dir + "/" + f, "utf8")),
  }));
}

// its remote, any credentials in it gone
function remote(dir: string): string {
  try {
    return git(dir, "remote", "get-url", "origin").trim().replace(/\/\/[^@/]*@/, "//");
  } catch {
    return "(none)";
  }
}

// folders two deep, with their file counts
function layout(list: string[]): string {
  const count = new Map<string, number>();
  for (const f of list) {
    const parts = f.split("/").slice(0, -1).slice(0, 2);
    if (parts.length > 0) {
      count.set(parts.join("/"), (count.get(parts.join("/")) ?? 0) + 1);
    }
  }
  return [...count].sort(([a], [b]) => a.localeCompare(b)).slice(0, 60).map(([d, n]) => d + " (" + n + " files)").join("\n");
}

export function digest(dir: string, secrets: string[]): Staged {
  const ref = default_ref(dir);
  const list = files(dir, ref);
  const active = branches(dir, 10);
  const head = [
    "Repo: " + path.basename(dir) + " (" + dir + ")",
    "Remote: " + remote(dir),
    "Default branch: " + ref + "; checked out: " + git(dir, "branch", "--show-current").trim(),
    "",
    "## Active branches (newest commit first)",
    ...active.map((l) => l.split("\t").map((p, i) => (i === 0 ? p.slice(0, 10) : p)).join("  ")),
    "",
    "## Last commits on " + ref,
    git(dir, "log", "-30", "--format=%cs %h %s", ref).trim(),
    "",
    "## Layout (two folders deep)",
    layout(list),
  ].join("\n");
  const docs = list.filter((f) => f.endsWith(".md") && !RULES.test(f) && !/^readme\.md$/i.test(f) && !/changelog/i.test(f));
  const readme = list.find((f) => /^readme\.md$/i.test(f));
  let text = head + (readme ? "\n\n## README\n" + cut(show(dir, ref, readme), README) : "");
  for (const f of docs) {
    const more = "\n\n## " + f + "\n" + cut(show(dir, ref, f), DOC);
    if (text.length + more.length > DIGEST) {
      text += "\n\n[" + (docs.length - docs.indexOf(f)) + " more docs left out: " + DIGEST + " characters]";
      break;
    }
    text += more;
  }
  const newest = active[0]?.split("\t")[0] ?? git(dir, "log", "-1", "--format=%cI").trim();
  return { kind: "repo-digest", path: dir, date: iso(newest), text: clean(secrets)(cut(text, DIGEST)) };
}

// a README's first paragraph that is prose (no heading, badge, image, tag)
function purpose(md: string): string {
  const para = md.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p !== "" && !/^(#|!\[|\[!\[|<|---|```|\|)/.test(p));
  return (para ?? "").replace(/\s+/g, " ").slice(0, PURPOSE);
}

export function card(dir: string, secrets: string[]): Staged {
  const ref = default_ref(dir);
  const list = files(dir, ref);
  const readme = list.find((f) => /^readme\.md$/i.test(f));
  let what = readme ? purpose(show(dir, ref, readme)) : "";
  if (what === "" && list.includes("package.json")) {
    what = String(JSON.parse(show(dir, ref, "package.json")).description ?? "");
  }
  if (what === "" && list.includes("pyproject.toml")) {
    what = show(dir, ref, "pyproject.toml").match(/^description\s*=\s*"([^"]*)"/m)?.[1] ?? "";
  }
  const langs = new Map<string, number>();
  for (const f of list) {
    const ext = f.split(".").pop()!.toLowerCase();
    if (f.includes(".") && CODE.has(ext)) {
      langs.set(ext, (langs.get(ext) ?? 0) + 1);
    }
  }
  const lang = [...langs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
  const [date, branch, subject] = (branches(dir, 1)[0] ?? "").split("\t");
  const text = [
    path.basename(dir) + ": " + (what || "(no description)"),
    "language: " + lang + "; files: " + list.length + "; default branch " + ref + "; at " + dir,
    "newest commit " + (date ?? "").slice(0, 10) + " on " + branch + ": " + subject,
  ].join("\n");
  return { kind: "repo-card", path: dir, date: iso(date || new Date().toISOString()), text: clean(secrets)(text), group: GROUP };
}

if (import.meta.main) {
  const secrets = env_secrets(process.env);
  const docs: Staged[] = [];
  const skip = (what: string, err: any) => console.error("skip " + what + ": " + String(err?.message ?? err));
  try {
    docs.push(...okf(OKF.dir, OKF.branch, secrets));
  } catch (err) {
    skip("OKF", err);
  }
  try {
    docs.push(...graphify(GRAPHIFY, secrets));
  } catch (err) {
    skip("graphify", err);
  }
  for (const dir of DIGESTS) {
    try {
      docs.push(digest(dir, secrets));
    } catch (err) {
      skip(dir, err);
    }
  }
  for (const d of fs.readdirSync(CARDS).map((d) => CARDS + "/" + d).filter((d) => fs.existsSync(d + "/.git"))) {
    try {
      docs.push(card(d, secrets));
    } catch (err) {
      skip(d, err);
    }
  }
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const out = chats(docs);
  fs.writeFileSync(OUT + "/knowledge.json", JSON.stringify(out), { mode: 0o600 });
  const count = (kind: string) => docs.filter((d) => d.kind === kind).length;
  console.log("knowledge.json:", out.length, "chats:", count("knowledge"), "documents,", count("repo-digest"), "digests,", count("repo-card"), "cards;", (JSON.stringify(out).length / 1e6).toFixed(2), "MB");
}
