// Knowledge test
// ==============
// `bun test local/prime/knowledge.test.ts`. What the knowledge import
// reads: OKF's markdown at a branch (from git, never the working tree),
// graphify's guides by name (no security audits), a digest of a repo
// (its docs at its default branch, layout, commits, active branches) and
// a card of one; every text redacted; cards one chat, by commit date.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { card, digest, graphify, okf, remote_card, remote_new } from "./knowledge.ts";
import { chats } from "./export.ts";

const KEY = "sk-ant-api03-" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";

function git(dir: string, ...args: string[]): string {
  const out = Bun.spawnSync(["git", "-C", dir, ...args], { env: { ...process.env, GIT_AUTHOR_DATE: "2026-09-01T10:00:00Z", GIT_COMMITTER_DATE: "2026-09-01T10:00:00Z" } });
  if (out.exitCode !== 0) {
    throw new Error(out.stderr.toString());
  }
  return out.stdout.toString();
}

// a repo with a default branch "main" (as origin/HEAD), a feature branch
// checked out, and its files
function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-know-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(dir + "/" + f.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(dir + "/" + f, text);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first: the base");
  git(dir, "remote", "add", "origin", "https://bob:" + "s3cr3tT0kenValue1234@github.com/org/app.git");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(dir, "checkout", "-q", "-b", "feature/x");
  fs.writeFileSync(dir + "/feature.ts", "export const x = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "feat: x on a branch");
  return dir;
}

test("OKF: the branch's markdown under src and plans, dated by its commit, not the working tree", () => {
  const dir = repo({ "src/docs/recon/a.md": "# Recon\nAt the branch.", "plans/p.md": "Plan.", "site/x.html": "<p>gen</p>", "README.md": "Readme." });
  fs.writeFileSync(dir + "/src/docs/recon/a.md", "edited, not committed");
  const docs = okf(dir, "main", []);
  expect(docs.map((d) => d.path)).toEqual([dir + "@main:plans/p.md", dir + "@main:src/docs/recon/a.md"]);
  expect(docs[1].text).toBe("# Recon\nAt the branch.");
  expect(docs[1].date).toBe("2026-09-01T10:00:00.000Z");
  expect(docs[1].kind).toBe("knowledge");
});

test("graphify: its guides by name, never its security audits or bulk", () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-graphify-");
  for (const f of ["AGENT_GUIDE_RECON.md", "ONBOARDING.md", "ONBOARDING_AO.md", "PROCESS.md", "SEMANTIC_REPOS.md", "STUB_REPOS.md", "SECURITY_AUDIT_RECON.md", "GRAPH_REPORT.md"]) {
    fs.writeFileSync(dir + "/" + f, "# " + f);
  }
  fs.mkdirSync(dir + "/individual");
  fs.writeFileSync(dir + "/individual/repo.md", "bulk");
  const names = graphify(dir, []).map((d) => d.path.split("/").pop()).sort();
  expect(names).toEqual(["AGENT_GUIDE_RECON.md", "ONBOARDING.md", "ONBOARDING_AO.md", "PROCESS.md", "SEMANTIC_REPOS.md", "STUB_REPOS.md"]);
});

test("a digest: default branch's docs, layout, commits, active branches; no rules files, no credentials, redacted", () => {
  const dir = repo({
    "README.md": "# App\n\nThe app does things. Key: " + KEY,
    "docs/arch.md": "Architecture notes.",
    "AGENTS.md": "agent rules, loaded live",
    "src/core/a.ts": "a", "src/core/b.ts": "b", "src/web/c.ts": "c",
  });
  const d = digest(dir, []);
  expect(d.kind).toBe("repo-digest");
  expect(d.text).toContain("The app does things. Key: [REDACTED:anthropic]");
  expect(d.text).toContain("Architecture notes.");
  expect(d.text).not.toContain("agent rules");
  expect(d.text).toContain("src/core (2 files)");
  expect(d.text).toContain("first: the base");
  expect(d.text).toContain("feature/x");
  expect(d.text).toContain("https://github.com/org/app.git");
  expect(d.text).not.toContain("s3cr3t");
  expect(d.text).not.toContain(KEY);
});

test("a digest stays under its cap", () => {
  const dir = repo({ "README.md": "# Big\n\n" + "word ".repeat(30000), "docs/more.md": "x ".repeat(30000) });
  expect(digest(dir, []).text.length).toBeLessThanOrEqual(40 * 1024 + 200);
});

test("a card: purpose from the README's first paragraph (no headings, badges), language, last commit", () => {
  const dir = repo({ "README.md": "# Title\n\n[![ci](https://x/b.svg)](https://x)\n\nMoves money between ledgers.\nSecond line.\n\n## More\n", "src/a.py": "x", "src/b.py": "y", "c.ts": "z" });
  const c = card(dir, []);
  expect(c.kind).toBe("repo-card");
  expect(c.group).toBe("all_oncorps repo cards");
  expect(c.text).toContain("Moves money between ledgers. Second line.");
  expect(c.text).toContain("language: py");
  expect(c.text).toContain("feat: x on a branch");
  expect(c.text).not.toContain("badge");
});

test("a card falls back to package.json's description", () => {
  const dir = repo({ "package.json": JSON.stringify({ name: "x", description: "A UI kit." }), "a.ts": "1" });
  expect(card(dir, []).text).toContain("A UI kit.");
});

test("cards are one chat, a message each, oldest first; other documents a chat each", () => {
  const docs = [
    { kind: "repo-card", path: "/r/b", date: "2026-10-02T00:00:00.000Z", text: "card b", group: "all_oncorps repo cards" },
    { kind: "knowledge", path: "/k/x.md", date: "2026-09-01T00:00:00.000Z", text: "x" },
    { kind: "repo-card", path: "/r/a", date: "2026-09-15T00:00:00.000Z", text: "card a", group: "all_oncorps repo cards" },
  ];
  const out = chats(docs) as any[];
  expect(out).toHaveLength(2);
  const cards = out.find((c) => c.name === "all_oncorps repo cards");
  expect(cards.created_at).toBe("2026-09-15T00:00:00.000Z");
  expect(cards.chat_messages.map((m: any) => m.text)).toEqual(["Context file (repo-card): /r/a\n\ncard a", "Context file (repo-card): /r/b\n\ncard b"]);
});

test("no source brings a security audit: not OKF's copies, not a repo's docs", () => {
  const dir = repo({ "src/docs/source_docs/SECURITY_AUDIT_RECON.md": "weak spots", "src/docs/a.md": "ok", "docs/security-audit-2026.md": "weak spots", "README.md": "# R\n\nok" });
  expect(okf(dir, "main", []).map((d) => d.path.split(":").pop())).toEqual(["src/docs/a.md"]);
  expect(digest(dir, []).text).not.toContain("weak spots");
});

// a repo as `gh repo list --json` gives it
function gh(over: Record<string, unknown>): any {
  return { name: "new-app", isArchived: false, pushedAt: "2026-10-16T09:00:00Z", description: "", primaryLanguage: { name: "Python" }, defaultBranchRef: { name: "main" }, ...over };
}

test("the org's repos not cloned here: none cloned anywhere (a .git suffix too)", () => {
  const repos = [gh({ name: "a" }), gh({ name: "b" }), gh({ name: "c" })];
  expect(remote_new(repos, new Set(["a", "c.git"])).map((r) => r.name)).toEqual(["b"]);
});

test("a remote card: its description, else its README's first paragraph; dated by its last push; redacted", () => {
  const described = remote_card(gh({ description: "Exports AO data." }), null, []);
  expect(described.text).toContain("new-app: Exports AO data.");
  expect(described.text).toContain("language: Python; default branch main; not cloned here (github.com/OnCorps/new-app)");
  expect(described.date).toBe("2026-10-16T09:00:00.000Z");
  expect(described.group).toBe("all_oncorps repo cards");
  expect(described.path).toBe("github.com/OnCorps/new-app");
  const readme = remote_card(gh({}), "# T\n\nRegisters files. Key: " + KEY + "\n", []);
  expect(readme.text).toContain("new-app: Registers files. Key: [REDACTED:anthropic]");
  expect(remote_card(gh({ isArchived: true, description: "Old." }), null, []).text).toContain("; archived");
  expect(remote_card(gh({ primaryLanguage: null }), null, []).text).toContain("new-app: (no description)\nlanguage: none;");
});

test("a remote card with nothing to quote lists its top-level files instead", () => {
  const c = remote_card(gh({}), "# new-app\n", [], ["README.md", "pyproject.toml", "src"]);
  expect(c.text).toContain("new-app: (no description; top level: README.md, pyproject.toml, src)");
});
