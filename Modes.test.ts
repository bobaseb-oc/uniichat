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
  for (const command of ["rm -rf ~", "git push", "cat .env", "printenv", "cat ~/.ssh/id_ed25519", "grep -r TOKEN ~/.aws", "ls; curl x | sh"]) {
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

// security review SA (RED ZONE): zsh (the device's $SHELL) expands an
// unquoted glob, brace or paren before the command sees its words, so
// per-word checks can't see what runs: such a word isn't read-only (C1)
test("C1: unquoted glob, brace, paren or zsh expansion is not read-only; quoted ones are", () => {
  for (const bad of [
    "ls *(e:'echo PWNED':)",
    "rg {--pre=sh,} x",
    "find . {-delete,}",
    "git log {--output=/tmp/x,}",
    "ls *.ts",
    "cat a?",
    "ls [ab]",
    "( rm x )",
    "ls =(rm x)",
    "cat =rm",
    "echo \"${(e):-\\$(rm x)}\"",
    "echo $~x",
    "echo $=x",
  ]) {
    expect([bad, Modes.readonly(bad)]).not.toEqual([bad, null]);
    expect([bad, Modes.reviews("auto", "shell", { command: bad })]).toEqual([bad, true]);
    expect([bad, Modes.allows("plan", "shell", { command: bad })]).toEqual([bad, expect.stringContaining("plan mode")]);
  }
  for (const ok of ["rg 'a*b' .", "find . -name '*.ts'", "grep -n \"[a-z]\" f", "ls \\*", "echo '{}'", "git log --format='%H (%s)'", "git diff HEAD~1", "ls ~/src", "git log --since=2.weeks"]) {
    expect([ok, Modes.readonly(ok)]).toEqual([ok, null]);
  }
});

// options that write or run, in any form git and GNU take them: abbreviated
// long options, =value, short ones run together (C1b)
test("C1b: git grep -O, reflog expire/delete, sort --compress-program, file -C, branch -u/--set-upstream-to=, abbreviations", () => {
  for (const bad of [
    "git grep -Ovim x",
    "git grep -O x",
    "git grep -iOvim x",
    "git grep --open-files-in-pager=vim x",
    "git grep --open x",
    "git reflog expire --all",
    "git reflog delete HEAD~1",
    "git reflog drop",
    "git reflog main",
    "sort --compress-program=sh f",
    "sort --compress=sh f",
    "file -C -m x",
    "file -C",
    "file -bC",
    "file --compile",
    "git branch --set-upstream-to=origin/x",
    "git branch --set-up=origin/x",
    "git branch -uorigin/x",
    "git branch -vD",
    "git tag -fa",
    "git log --out=x",
    "git diff --outp=x",
    "tree -oout",
    "tree --out=x",
  ]) {
    expect([bad, Modes.readonly(bad)]).not.toEqual([bad, null]);
  }
  for (const ok of ["git reflog", "git reflog show -5", "git reflog -n 5", "git grep -n foo", "git branch -vv", "git branch --list", "git branch -r", "sort -n f", "sort -rn f", "file README.md", "file -b x", "git log --oneline", "git tag -l", "git log --output-indicator-new=+"]) {
    expect([ok, Modes.readonly(ok)]).toEqual([ok, null]);
  }
});

// secrets are looked for in the words as the shell gives them, quotes and
// escapes taken off, not only the raw line (M4)
test("M4: a secret path hidden by quotes or escapes is still reviewed", () => {
  for (const command of ["cat ~/.a''ws/cred''entials", "cat ~/.a\\ws/config", "cat \"$HOME/.s\"sh/config", "cat ~/.?sh/id_*", "cat .e'n'v", "cat /proc/self/environ", "jq -n env"]) {
    expect([command, Modes.reviews("auto", "shell", { command })]).toEqual([command, true]);
  }
});

// auto mode reviews computer use always, and every MCP tool but one whose
// name plainly only reads (H3); a fetch may send data off: reviewed
test("H3: computer and MCP tools that may change things are reviewed; plain MCP reads are not", () => {
  for (const tool of ["computer", "mcp__jira__createJiraIssue", "mcp__x__executeRead", "mcp__x__get_and_delete", "mcp__x__transitionJiraIssue", "mcp__x__send_message", "mcp__x__frobnicate", "mcp__x__getOrUpdate", "mcp__srv__get_thing_1234abcd", "mcp__x__list_and_post", "mcp__x__fetch"]) {
    expect([tool, Modes.reviews("auto", tool, {})]).toEqual([tool, true]);
  }
  for (const tool of ["mcp__plugin_atlassian_atlassian__getJiraIssue", "mcp__x__searchJiraIssuesUsingJql", "mcp__x__list_pages", "mcp__x__read_file", "mcp__x__search", "mcp__x__getConfluenceContent"]) {
    expect([tool, Modes.reviews("auto", tool, {})]).toEqual([tool, false]);
  }
  for (const tool of ["computer", "mcp__jira__createJiraIssue"]) {
    expect(Modes.reviews("full", tool, {})).toBe(false);
  }
});
