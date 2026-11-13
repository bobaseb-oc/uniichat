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

// RED ZONE (security review U3, DRAFT awaiting the user's sign-off):
// auto mode reviews computer use always, and every MCP tool but one whose
// whole name is on the read-only allowlist (shipped, plus config's
// mcp_reads); a name only looking like a read is reviewed (H3)
test("U3: an MCP tool skips review only if its exact name is allowlisted", () => {
  for (const tool of ["computer", "mcp__jira__createJiraIssue", "mcp__atlassian__executeRead", "mcp__atlassian__executeWrite", "mcp__x__getRevoke", "mcp__x__get_drop_table", "mcp__x__readAndTrigger", "mcp__x__getJiraIssue", "mcp__x__search", "mcp__plugin_atlassian_atlassian__getJiraIssue", "mcp__atlassian__getJiraIssueX", "mcp__playwright__browser_navigate", "mcp__playwright__browser_evaluate", "mcp__chrome-devtools__evaluate_script", "mcp__x__fetch"]) {
    expect([tool, Modes.reviews("auto", tool, {})]).toEqual([tool, true]);
  }
  for (const tool of ["mcp__atlassian__getJiraIssue", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getConfluenceContent", "mcp__playwright__browser_snapshot", "mcp__chrome-devtools__list_pages"]) {
    expect([tool, Modes.reviews("auto", tool, {})]).toEqual([tool, false]);
  }
  for (const tool of ["computer", "mcp__jira__createJiraIssue"]) {
    expect(Modes.reviews("full", tool, {})).toBe(false);
  }
});

test("U3: config's mcp_reads adds exact names; a cut name is reviewed even if listed", () => {
  const cut = "mcp__srv__" + "a".repeat(45) + "_1234abcd";
  const reads = ["mcp__x__list_pages", cut];
  expect(Modes.reviews("auto", "mcp__x__list_pages", {}, reads)).toBe(false);
  expect(Modes.reviews("auto", "mcp__x__list_pages_all", {}, reads)).toBe(true);
  expect(Modes.reviews("auto", "mcp__y__list_pages", {}, reads)).toBe(true);
  expect(Modes.reviews("auto", cut, {}, reads)).toBe(true);
  expect(Modes.reviews("auto", "mcp__x__list_pages", {})).toBe(true);
});

test("U3: the shipped allowlist holds no tool that runs, fetches, navigates or evaluates", () => {
  expect(Modes.MCP_READS.length).toBeGreaterThan(0);
  for (const tool of Modes.MCP_READS) {
    expect([tool, /^mcp__(atlassian|playwright|chrome-devtools)__[A-Za-z_]+$/.test(tool)]).toEqual([tool, true]);
    expect([tool, /exec|fetch|navigat|evaluat|click|fill|type|press|creat|edit|updat|delet|transition|add|upload|run|script/i.test(tool.split("__")[2]!)]).toEqual([tool, false]);
  }
});

// one secret list (Machine's read refuses the same paths): a read-only
// command of one is reviewed in auto mode, whatever its case; a plain one
// that only says key is not
test("the shell's secrets are read's: kube, docker, gh, git-credentials, pgpass, any case", () => {
  for (const command of ["cat ~/.kube/config", "cat ~/.docker/config.json", "cat ~/.config/gh/hosts.yml", "cat ~/.git-credentials", "cat ~/.pgpass", "cat ~/.claude.json", "cat .npmrc", "cat ~/.pypirc", "cat repo/.git/config", "cat ~/.KUBE/config", "cat ~/.SSH/id_rsa", "cat ~/.Aws/credentials"]) {
    expect([command, Modes.reviews("auto", "shell", { command })]).toEqual([command, true]);
  }
  for (const command of ["git log --format=%H keyword", "cat keyboard.md", "ls .dockerignore", "cat docs/kube.md"]) {
    expect([command, Modes.reviews("auto", "shell", { command })]).toEqual([command, false]);
  }
});

// an unattended PR review runs in plan mode and reads the PR with gh: its
// subcommands that only read, with flags that neither write nor open a
// browser; gh api only a GET of a path on GitHub
test("gh: pr/issue/repo views and a GET of gh api only read; anything else is refused", () => {
  for (const ok of [
    "gh pr view 12",
    "gh pr view 12 --comments --json title,body",
    "gh pr diff 12",
    "gh pr diff 12 --name-only --repo o/r",
    "gh pr checks 12",
    "gh pr list --state open --limit 5",
    "gh issue view 3 -R o/r",
    "gh issue list --label bug --json number --jq '.[].number'",
    "gh repo view o/r",
    "gh api repos/o/r/pulls/12/comments",
    "gh api repos/o/r/pulls/12 -X GET --paginate --jq .title",
    "gh api --method=GET repos/o/r",
    "gh api -XGET repos/o/r",
  ]) {
    expect([ok, Modes.readonly(ok)]).toEqual([ok, null]);
    expect([ok, Modes.allows("plan", "shell", { command: ok })]).toEqual([ok, null]);
  }
  for (const bad of [
    "gh",
    "gh pr",
    "gh pr merge 12",
    "gh pr comment 12 -b x",
    "gh pr checkout 12",
    "gh pr view 12 --web",
    "gh pr view 12 -w",
    "gh pr diff 12 --web",
    "gh repo view --web",
    "gh repo clone o/r",
    "gh issue create -t x",
    "gh issue close 3",
    "gh pr checks 12 --watch",
    "gh auth token",
    "gh extension exec x",
    "gh --repo o/r pr view 1",
    "gh api -X POST repos/o/r/issues",
    "gh api --method DELETE repos/o/r",
    "gh api --method=PATCH repos/o/r",
    "gh api -XPUT repos/o/r",
    "gh api repos/o/r/issues -f title=x",
    "gh api repos/o/r/issues -F title=x",
    "gh api repos/o/r/issues --field title=x",
    "gh api repos/o/r/issues --raw-field title=x",
    "gh api repos/o/r/issues --input body.json",
    "gh api graphql -f query=x",
    "gh api https://evil.example/x",
    "gh api --hostname evil.example /user",
    "gh api -H 'X-HTTP-Method-Override: DELETE' repos/o/r",
  ]) {
    expect([bad, Modes.readonly(bad)]).not.toEqual([bad, null]);
  }
});

// round-2 check: a secret path spelled with lookalikes, a grep over the
// whole home, and gh -R naming another host are all reviewed or refused
test("lookalike secret paths and home-wide greps are reviewed; gh -R takes OWNER/REPO only", () => {
  for (const command of ["cat ~/.pgpaſſ", "cat ~/.ſsh/github_ed25519", "grep -r PRIVATE ~", "rg PRIVATE ~/", "grep -rn key $HOME", "rg -l BEGIN /"]) {
    expect([command, Modes.reviews("auto", "shell", { command })]).toEqual([command, true]);
  }
  for (const command of ["grep -rn TODO src", "rg foo .", "cat README.md"]) {
    expect([command, Modes.reviews("auto", "shell", { command })]).toEqual([command, false]);
  }
  expect(Modes.readonly("gh pr view 1 -R o/r")).toBeNull();
  expect(Modes.readonly("gh pr view 1 --repo=o/r.js")).toBeNull();
  for (const command of ["gh pr view 1 -R evil.example/o/r", "gh pr view 1 --repo=evil.example/o/r", "gh pr view 1 --repo https://evil.example/o/r"]) {
    expect([command, Modes.readonly(command)]).toEqual([command, expect.stringContaining("OWNER/REPO")]);
  }
});

// round-4 check: an allowlisted MCP read that is given a file or path
// argument may write it (playwright's filename, devtools' filePath), so
// it is reviewed; reading the Keychain or restarting the device, which
// could time a Keychain prompt, is reviewed too
test("an allowlisted MCP read with a file argument, and security or launchctl, are reviewed", () => {
  expect(Modes.reviews("auto", "mcp__playwright__browser_console_messages", {})).toBe(false);
  for (const input of [{ filename: "/Users/u/.zshenv" }, { filePath: "x" }, { requestFilePath: "x" }, { responseFilePath: "x" }, { outputDir: "x" }]) {
    expect([input, Modes.reviews("auto", "mcp__playwright__browser_console_messages", input)]).toEqual([input, true]);
    expect([input, Modes.reviews("auto", "mcp__chrome-devtools__take_snapshot", input)]).toEqual([input, true]);
  }
  for (const command of ["security find-generic-password -s legion-google-guarded-grant -w", "launchctl kickstart -k gui/501/com.oncorps.legion.device", "/usr/bin/security dump-keychain"]) {
    expect([command, Modes.reviews("auto", "shell", { command })]).toEqual([command, true]);
  }
});

// merged with K10: git takes an abbreviated --upload-pack too, and gh
// api's only header is Accept (any other may override the method)
test("git fetch --upload-p (abbreviated) and gh api -H other than Accept are not read-only", () => {
  for (const bad of ["git fetch --upload-p=sh", "git fetch --upload sh", "gh api --header='X-HTTP-Method-Override: PUT' repos/o/r"]) {
    expect([bad, Modes.readonly(bad)]).not.toEqual([bad, null]);
  }
  expect(Modes.readonly("gh api --header='Accept: application/vnd.github.raw' repos/o/r/readme")).toBeNull();
});

// plan mode runs exactly the MCP reads auto mode lets by unreviewed:
// MCP_READS or the user's mcp_reads (OKF's tools, K), with no file argument
test("plan mode runs the allowlisted MCP reads, the user's too, and nothing else", () => {
  const okf = ["list_cqs", "run_cq", "run_sparql", "describe_vocabulary", "list_root_causes", "list_quirks", "list_remediation_rules"].map((t) => "mcp__okf__" + t);
  for (const t of okf) {
    expect([t, Modes.reviews("auto", t, {}, okf)]).toEqual([t, false]);
    expect([t, Modes.allows("plan", t, {}, okf)]).toEqual([t, null]);
    expect([t, Modes.allows("plan", t, {})]).not.toEqual([t, null]);
  }
  expect(Modes.allows("plan", "mcp__atlassian__getJiraIssue", { issueIdOrKey: "X-1" })).toBeNull();
  expect(Modes.allows("plan", "mcp__atlassian__createJiraIssue", {})).not.toBeNull();
  expect(Modes.allows("plan", "mcp__playwright__browser_snapshot", { filename: "/tmp/x" })).not.toBeNull();
  expect(Modes.allows("plan", "mcp__okf__run_sparql", { path: "x" }, okf)).not.toBeNull();
});
