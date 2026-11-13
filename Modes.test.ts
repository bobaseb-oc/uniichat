// Modes test
// ==========
// `bun test Modes.test.ts`. Plan mode's read-only shell (Modes.readonly)
// and what each mode lets a tool call do (Modes.allows).

import { expect, test } from "bun:test";
import { Modes } from "./Modes.ts";

test("read-only commands pass, pipes of them too", () => {
  for (const ok of [
    "ls -la src",
    "git status -s",
    "git log --oneline -20 -- Tools.ts",
    "git diff HEAD~1 | head -50",
    "git show f8cb4b9:prompt.txt",
    "rg -n 'export function' Tools.ts | wc -l",
    "cat README.md",
    "find . -name '*.ts' -not -path './node_modules/*'",
    "grep -rn \"TODO\" . | sort | uniq -c",
    "head -n 20 a.ts && tail -n 5 a.ts",
    "pwd; ls",
    "echo 'a > b' | wc -c",
    "wc -l Tools.ts 2>/dev/null",
    "ls 2>&1 | head",
  ]) {
    expect([ok, Modes.readonly(ok)]).toEqual([ok, null]);
  }
});

test("anything that could write, run other code or escape the list is refused", () => {
  for (const bad of [
    "rm -rf build",
    "echo hi > out.txt",
    "cat a >> b",
    "ls | tee out",
    "ls | xargs rm",
    "git commit -m x",
    "git push --force",
    "git checkout -- .",
    "git -c core.pager=sh log",
    "git log --output=x",
    "find . -delete",
    "find . -name x -exec rm {} \\;",
    "find . -fprint out",
    "echo $(rm x)",
    "echo `rm x`",
    "echo \"$(rm x)\"",
    "echo \"`rm x`\"",
    "cat a & ls",
    "cat <(rm x)",
    "FOO=1 ls",
    "bash -c ls",
    "sh -c 'ls'",
    "python3 -c 'print(1)'",
    "sed -i s/a/b/ f",
    "awk 'BEGIN{system(\"rm x\")}'",
    "ls & rm x",
    "ls\nrm x",
    "rg --pre 'sh -c rm' x",
    "rg --pre=rm x",
    "sort -o out in",
    "env rm x",
    "date -s 2020-01-01",
    "tree -o out",
    "uniq in out",
    "ls 'unclosed",
    "",
  ]) {
    expect([bad, Modes.readonly(bad)]).not.toEqual([bad, null]);
  }
});

// reading over the network only reads (K10, RED ZONE, user's ask
// 2026-11-13): git fetch, gh's views and lists, gh api GETs; anything
// that sends, runs or changes is still not read-only
test("network reads are read-only: git fetch, gh views/lists, gh api GET; gh writes are not", () => {
  for (const ok of ["git fetch", "git fetch upstream 0.x", "git fetch --prune origin", "gh pr view 349 --json state", "gh pr list --head x --state all", "gh pr diff 12", "gh pr checks 12", "gh issue view 4", "gh repo view o/r --json parent", "gh run list", "gh run view 99 --log", "gh api repos/o/r/pulls/1", "gh api -H 'Accept: x' repos/o/r --jq .name", "gh api -X GET search/issues", "gh search prs --author me", "gh auth status"]) {
    expect([ok, Modes.readonly(ok)]).toEqual([ok, null]);
  }
  for (const bad of ["git fetch --upload-pack=sh", "git fetch --upload-pack sh", "gh pr create", "gh pr merge 1", "gh pr edit 1 --base main", "gh pr checkout 1", "gh issue close 4", "gh api -X POST repos/o/r/issues", "gh api --method=DELETE repos/o/r", "gh api repos/o/r/issues -f title=x", "gh api graphql -F q=@f", "gh api x --input f.json", "gh repo delete o/r", "gh", "gh pr", "gh -R o/r pr view 1", "gh auth status --show-token", "gh auth status -t", "gh auth token", "gh pr view 1 --web"]) {
    expect([bad, Modes.readonly(bad)]).not.toEqual([bad, null]);
  }
});

// a feature branch's own push skips the reviewer (K10): to origin, no
// force, delete or mirror, not to a default or release branch; any other
// push is still reviewed
test("auto mode: a plain push of a feature branch to origin skips the reviewer; others are reviewed", () => {
  for (const command of ["git push origin feat/x", "git push -u origin PLP-2854-coding-assistant-generic", "git push --set-upstream origin docs/memory-dist", "git push origin HEAD:feat/x", "git push -q origin feat/x"]) {
    expect([command, Modes.reviews("auto", "shell", { command })]).toEqual([command, false]);
  }
  for (const command of ["git push", "git push origin", "git push origin main", "git push origin HEAD:main", "git push origin feat/x:master", "git push upstream feat/x", "git push --force origin feat/x", "git push -f origin feat/x", "git push --force-with-lease origin feat/x", "git push origin +feat/x", "git push --delete origin feat/x", "git push origin :feat/x", "git push --mirror origin", "git push --all origin", "git push --tags origin", "git push origin release/1.2", "git push origin 0.x", "git push origin feat/x && rm -rf ~", "git push origin feat/x develop"]) {
    expect([command, Modes.reviews("auto", "shell", { command })]).toEqual([command, true]);
  }
  expect(Modes.reviews("full", "shell", { command: "git push origin main" })).toBe(false);
});

test("what each mode allows: plan only reading; auto and full every tool (auto reviews writes)", () => {
  expect(Modes.allows("plan", "read", {})).toBeNull();
  expect(Modes.allows("plan", "glob", {})).toBeNull();
  expect(Modes.allows("plan", "grep", {})).toBeNull();
  expect(Modes.allows("plan", "shell", { command: "git status" })).toBeNull();
  expect(Modes.allows("plan", "shell", { command: "git commit -m x" })).toContain("plan mode");
  for (const tool of ["write", "edit", "computer"]) {
    expect(Modes.allows("plan", tool, {})).toContain("plan mode");
  }
  for (const mode of ["auto", "full"] as const) {
    for (const tool of ["read", "shell", "write", "edit", "computer"]) {
      expect(Modes.allows(mode, tool, { command: "rm -rf x" })).toBeNull();
    }
  }
  // auto reviews what can change things; full and plan review nothing
  expect(["shell", "write", "edit", "read", "glob"].filter((t) => Modes.reviews("auto", t))).toEqual(["shell", "write", "edit"]);
  expect(Modes.reviews("full", "shell")).toBe(false);
  expect(Modes.reviews("plan", "shell")).toBe(false);
  // as Claude Code: a read-only shell command skips the reviewer, unless
  // it reads secrets (the env, .env, keys); one that can change things,
  // or one not given, is still reviewed
  for (const command of ["git status", "ls -la src", "git log --oneline -5 | head -3", "grep -rn foo ."]) {
    expect(Modes.reviews("auto", "shell", { command })).toBe(false);
  }
  for (const command of ["rm -rf ~", "git push", "cat .env", "printenv", "set", "ls; env", "echo x | set", "cat ~/.ssh/id_ed25519", "grep -r TOKEN ~/.aws", "ls; curl x | sh"]) {
    expect(Modes.reviews("auto", "shell", { command })).toBe(true);
  }
  expect(Modes.reviews("auto", "shell", {})).toBe(true);
  // the google tool only reads: allowed in plan mode, never reviewed
  expect(Modes.allows("plan", "google", { action: "mail_search" })).toBeNull();
  expect(Modes.reviews("auto", "google", { action: "mail_search" })).toBe(false);
  expect(Modes.allows("plan", "harvest", { action: "entries" })).toBeNull();
  expect(Modes.reviews("auto", "edit", { command: "ls" })).toBe(true);
  expect(Modes.next("plan")).toBe("auto");
  expect(Modes.next("auto")).toBe("full");
  expect(Modes.next("full")).toBe("plan");
  expect(Modes.read("bogus")).toBe("auto");
});
