// Collect
// =======
// `bun local/prime/collect.ts`. What primes the memory tree, as a
// manifest to review (~/.unii-prime/manifest.txt): one line per source,
// "+" taken, "-" left out (edit the sign to change it). Kinds:
// instructions (AGENTS/CLAUDE files, deduplicated by content), memory
// (Claude Code's memory files), doc (text, and a few picked documents),
// chatlog (a Claude Code project's logs, by folder). Reads names and
// sizes only; nothing is copied or sent.

import * as fs from "node:fs";
import * as os from "node:os";
import { createHash } from "node:crypto";

// Constants
// =========

const HOME = os.homedir();

export const OUT = HOME + "/.unii-prime";

const GIT = "/Volumes/dev/git";

// instruction files besides the repos': the user's own and the company's
const GLOBAL = [
  HOME + "/.claude/AGENTS.md",
  HOME + "/.claude/CLAUDE.md",
  HOME + "/.claude/CLAUDE.local.md",
  HOME + "/.claude/SOUL.md",
  ...dir_md("/Library/Application Support/OnCorps/oncorps-shared-skills/company-wide"),
];

// a copy of a repo, not a repo of its own (worktrees, dependencies)
const COPY = /\/(\.claude\/worktrees|node_modules|\.git|\.venv|vendor)\/|\/[^/]*-wt-[^/]*\//;

const NAMES = /^(agents|claude)(\.local)?\.md$/i;

const DOCS = ["Documents", "Downloads", "Desktop"].map((d) => HOME + "/" + d);

const TEXT = /\.(md|txt)$/i;

// documents picked by hand ("+"), and others worth a look ("-"), under HOME
const PICKS: Array<[string, string]> = [
  ["+", "Documents/Check_Analyzer_API_Strategy_v2.pptx"],
  ["+", "Downloads/NAV_QC_Principal_Coverage_Gap_v1.pptx"],
  ["+", "Downloads/oncorps-benchmarks-evals-working-plan.pdf"],
  ["+", "Downloads/OnCorps Agentic Infrastructure Proposal.docx"],
  ["+", "Downloads/paper_seba_07_08_2026.pdf"],
  ["+", "Downloads/paper_workshop_main.pdf"],
  ["+", "Documents/hackathon-may-2026/hackathon_recap.pptx"],
  ["+", "Documents/hackathon-may-2026/hackathon-elt-report.pdf"],
  ["+", "Downloads/Engineering AI Maturity at OnCorps.pptx"],
  ["+", "Downloads/Agentic Coding Survey Results (31 responses).pdf"],
  ["+", "Downloads/elt-update-week2.pdf"],
  ["+", "Downloads/Internal AI Tooling — Strategy & Roadmap.pptx"],
  ["+", "Downloads/OnCorps AI - Internal Optimizations - Thought Process.pdf"],
  ["+", "Downloads/DELIVERY_GUIDE_v0.6.1.pdf"],
  ["+", "Downloads/CheckWritingAgent_Hackathon_Presentation.pptx"],
  ["+", "Documents/OnCorpsAI_Competitive_Landscape.pptx"],
  ["+", "Documents/OnCorpsAI_Product_Offerings.pptx"],
  ["+", "Documents/PricingAI_Pitch_Deck.pptx"],
  ["+", "Documents/OnCorps_Onboarding.pptx"],
  ["+", "Downloads/OnCorps AI Update 2026-01-28.pptx"],
  ["+", "Downloads/POC Outline-ICE  OnCorps.docx"],
  ["+", "Downloads/OnCorps ReconAI User Guide.pdf"],
  ["-", "Downloads/pay-manual-v6.pdf"],
  ["-", "Downloads/cdlc_v1.pdf"],
  ["-", "Downloads/oncorps.pdf"],
  ["-", "Downloads/Agentic.pdf"],
  ["-", "Downloads/AI-Assisted.pdf"],
  ["-", "Downloads/Constructing.pdf"],
  ["-", "Downloads/Extracting.pdf"],
  ["-", "Downloads/GoTu_gAIns_in_Engineering_(shared).pdf"],
  ["-", "Documents/how_to_make_good_presentations.pptx"],
  ["-", "Documents/hackathon-may-2026/team6 - jira quality/jira-ticket-quality-demo.pptx"],
  ["-", "Documents/pricing_insights/mock dir structure/faqs/PriceBuilderFAQv4.pdf"],
];

// Types
// =====

export type Kind = "instructions" | "memory" | "doc" | "chatlog";

// a manifest line: taken or not, its kind, its bytes, its path, a note
export type Line = { take: boolean; kind: Kind; bytes: number; path: string; note?: string };

// Collect
// =======

function dir_md(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => dir + "/" + f) : [];
}

function size(path: string): number {
  return fs.statSync(path).size;
}

function sha(path: string): string {
  return createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}

// the repos' instruction files, by `find` (it prunes the copies fast)
function repo_files(): string[] {
  const prune = ["node_modules", ".git", ".venv", "vendor", "worktrees"].flatMap((n, i) => [...(i ? ["-o"] : []), "-name", n]);
  const out = Bun.spawnSync(["find", GIT, "-type", "d", "(", ...prune, ")", "-prune", "-o", "-type", "f", "-iname", "*.md", "-print"]);
  return out.stdout.toString().split("\n").filter((p) => p && NAMES.test(p.split("/").pop()!) && !COPY.test(p));
}

// instruction files, one per content (the first path found keeps it)
function instructions(): Line[] {
  const seen = new Map<string, Line>();
  for (const path of [...GLOBAL.filter((p) => fs.existsSync(p)), ...repo_files()]) {
    const key = sha(path);
    const line = seen.get(key);
    if (line === undefined) {
      seen.set(key, { take: true, kind: "instructions", bytes: size(path), path });
    } else {
      line.note = "+" + (Number(line.note?.slice(1) ?? 0) + 1) + " identical";
    }
  }
  return [...seen.values()];
}

function projects(): string[] {
  const dir = HOME + "/.claude/projects";
  return fs.readdirSync(dir).map((d) => dir + "/" + d).filter((d) => fs.statSync(d).isDirectory());
}

function memories(): Line[] {
  return projects().flatMap((p) => dir_md(p + "/memory")).map((path) => ({ take: true, kind: "memory" as Kind, bytes: size(path), path }));
}

// each project's logs (top level: no subagents'), but claude-mem's own
function chatlogs(): Line[] {
  return projects().flatMap((dir) => {
    const logs = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    const bytes = logs.reduce((n, f) => n + size(dir + "/" + f), 0);
    const mem = dir.includes("claude-mem-observer");
    return logs.length === 0 ? [] : [{ take: !mem, kind: "chatlog" as Kind, bytes, path: dir, note: logs.length + " logs" + (mem ? ", claude-mem's own" : "") }];
  });
}

function docs(): Line[] {
  const text = DOCS.flatMap((d) => (fs.readdirSync(d, { recursive: true }) as string[]).map((f) => d + "/" + f))
    .filter((p) => TEXT.test(p) && fs.statSync(p).isFile())
    .map((path) => ({ take: true, kind: "doc" as Kind, bytes: size(path), path }));
  const picked = PICKS.map(([sign, rel]) => [sign, HOME + "/" + rel] as const)
    .filter(([, path]) => fs.existsSync(path))
    .map(([sign, path]) => ({ take: sign === "+", kind: "doc" as Kind, bytes: size(path), path }));
  return [...text, ...picked];
}

// Manifest
// ========

export function manifest_line(l: Line): string {
  return [l.take ? "+" : "-", l.kind, String(l.bytes), l.path, l.note ?? ""].join("\t").trimEnd();
}

export function manifest_read(text: string): Line[] {
  return text.split("\n").filter((t) => /^[+-]\t/.test(t)).map((t) => {
    const [sign, kind, bytes, path, note] = t.split("\t");
    return { take: sign === "+", kind: kind as Kind, bytes: Number(bytes), path, note };
  });
}

if (import.meta.main) {
  const lines = [...instructions(), ...memories(), ...docs(), ...chatlogs()];
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const head = "# sign\tkind\tbytes\tpath\tnote  (edit + / - to take or leave a source)\n";
  fs.writeFileSync(OUT + "/manifest.txt", head + lines.map(manifest_line).join("\n") + "\n", { mode: 0o600 });
  for (const kind of ["instructions", "memory", "doc", "chatlog"]) {
    const of = lines.filter((l) => l.kind === kind);
    const taken = of.filter((l) => l.take);
    console.log(kind.padEnd(13), String(taken.length).padStart(4) + " taken /" + String(of.length).padStart(4), (taken.reduce((n, l) => n + l.bytes, 0) / 1e6).toFixed(1) + " MB");
  }
  console.log("manifest:", OUT + "/manifest.txt");
}
