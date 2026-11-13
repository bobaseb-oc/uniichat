// Modes
// =====
// The chat's permission mode, as Claude Code's: plan (only reading, until
// the user approves a plan), auto (a reviewer model allows or refuses each
// call that can change things), full (every call, Claude Code's hooks
// only). Pure: Tools.ts asks it what a call may do, on the server, before
// a job goes to a device.
// Plan mode's shell is a read-only allowlist (readonly): commands known to
// only read, joined by pipes and && || ;, with no redirect (but 2>/dev/null
// and 2>&1), substitution, background job, newline, variable assignment
// or path to a program; per command, the flags that would write or run
// other code refused (find -exec, rg --pre, git's writing subcommands...),
// in any form git and GNU take them (abbreviated, =value, run together);
// no word the shell would expand itself (zsh: glob, brace, paren, =cmd).
// RED ZONE (security review SA, DRAFT awaiting the user's sign-off)

// Types
// =====

export type Mode = "plan" | "auto" | "full";

// Constants
// =========

export const MODES: Mode[] = ["plan", "auto", "full"];

// what a mode says of itself, to the user and the agents
export const ABOUT: Record<Mode, string> = {
  plan: "plan mode: agents only read, until you approve a plan",
  auto: "auto mode: a reviewer allows or refuses each change",
  full: "full mode: every call runs (hooks only)",
};

// what an agent refused in plan mode does instead
const AFTER = "Say what you would change instead: in your report, or, for Unii, in the plan it files (plan).";

// the tools that only read, in every mode
const READS = ["read", "glob", "grep", "google", "harvest"];

// the tools auto mode's reviewer checks
const REVIEWED = ["shell", "write", "edit", "computer"];

// RED ZONE (security review follow-up, DRAFT awaiting the user's
// sign-off): the one list of where a secret may be, in any case (macOS's
// disk is case-insensitive). A file's name (a key, credentials, a token,
// .env, a login's dotfile, a service account's JSON), a dir it is in
// (~/.ssh, ~/.aws, ~/.kube...) or a repo's .git/config: Machine's read,
// grep and glob refuse them (Machine.secret), so does Device's files pane
const DOTS = String.raw`\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.pgpass|\.claude\.json`;
const DIRS = String.raw`\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.azure|\.config\/(gh|gcloud)|Library\/Keychains`;
export const SECRET = new RegExp(String.raw`^(\.env.*|.*\.(pem|key|p12|pfx|keychain)|id_[a-z0-9]+|${DOTS}|credentials.*|\.credentials.*|secrets?(\..*)?|tokens?|.*(credential|service[-_]?account|secret|token).*\.json|(.*[-_.])?keys?([-_.].*)?\.json)$`, "i");
export const SECRET_AT = new RegExp(String.raw`(^|\/)(${DIRS})(\/|$)|\/\.git\/config$`, "i");

// a read-only command that may read secrets: still reviewed in auto mode
// (the list above, in the line or its words; not a bare key: too common.
// not set, which flagged git push --set-upstream (K10); env stays: jq -n env
// prints the environment)
const SECRETS = new RegExp(String.raw`printenv|environ|\benv\b|\.env|(${DIRS})\b|${DOTS}|\.git\/config|secret|credential|token|passw|keychain|\.pem\b|\bid_[a-z0-9]+`, "i");

// commands that only read, whatever their arguments
// (not env, which runs its arguments; nor tree -o, uniq's output file,
// file -C: checked below)
const PLAIN = new Set(["ls", "cat", "head", "tail", "wc", "pwd", "echo", "stat", "du", "df", "which", "diff", "cut", "jq", "basename", "dirname", "realpath", "true", "grep", "egrep", "fgrep", "nl", "whoami", "printenv", "tr", "column", "comm"]);

// git's subcommands that only read
const GIT = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame", "grep", "describe", "shortlog", "ls-tree", "cat-file", "reflog", "tag"]);

// git branch/tag flags that write: long ones, and short ones' letters
const GIT_WRITES = ["--delete", "--move", "--copy", "--force", "--set-upstream-to", "--unset-upstream", "--edit-description", "--annotate", "--sign"];
const GIT_SHORTS = /^-[A-Za-z]*[dDmMcCfuas]/;

// gh's subcommands that only read (an unattended PR review reads its PR
// with them), the flags they may take (none opens a browser or waits),
// and gh api's: a GET of a path on GitHub, no field (that makes it a POST)
// (K10's nouns: the network reads the user chose; auth status takes no
// flag, as its -t prints the token)
const GH: Record<string, string[]> = {
  pr: ["view", "list", "diff", "checks", "status"], issue: ["view", "list", "status"], repo: ["view", "list"],
  run: ["view", "list"], workflow: ["view", "list"], release: ["view", "list"],
  search: ["prs", "issues", "repos", "code", "commits"], auth: ["status"],
};
// a search over the whole home or disk, which holds the logins (a grep -r ~)
const HOME_WIDE = /^(~\/?|\$HOME\/?|\$\{HOME\}\/?|\/|\/Users(\/[^\/]+)?\/?)$/;
// gh -R: OWNER/REPO on GitHub, never HOST/OWNER/REPO
const GH_REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const GH_FLAGS = new Set(["--repo", "-R", "--json", "--jq", "-q", "--template", "-t", "--comments", "-c", "--name-only", "--patch", "--color", "--limit", "-L", "--state", "-s", "--author", "-A", "--label", "-l", "--base", "-B", "--head", "-H", "--search", "-S", "--assignee", "-a", "--branch", "-b", "--required", "--draft", "-d", "--app", "--mention", "--milestone", "-m",
  "--log", "--log-failed", "--job", "-j", "--exit-status", "--attempt", "--verbose", "--workflow", "--event", "--status", "--user", "--commit", "--created",
  "--owner", "--language", "--sort", "--order", "--match", "--updated", "--visibility", "--topic", "--archived", "--no-archived", "--fork", "--source", "--exclude-drafts", "--exclude-pre-releases", "--all", "--yaml", "--ref"]);
const GH_API = new Set(["--paginate", "--jq", "-q", "--template", "-t", "--include", "-i", "--silent", "--slurp", "--verbose"]);

// a branch a plain push may go to without the reviewer: not a default,
// shared or release branch (K10)
const PROTECTED = /^(main|master|develop|trunk|HEAD|gh-pages|release(\/.*)?|\d+(\.\d+)*\.x)$/;
const PUSH_FLAGS = new Set(["-u", "--set-upstream", "-q", "--quiet", "-v", "--verbose"]);

// find's actions that write or run
const FIND_WRITES = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);

// Modes
// =====

export namespace Modes {

  // a saved or sent mode, or auto
  export function read(x: unknown): Mode {
    return MODES.includes(x as Mode) ? (x as Mode) : "auto";
  }

  // the mode after it (Shift+Tab)
  export function next(mode: Mode): Mode {
    return MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
  }

  // why a mode refuses a device tool call; null: it may run (auto's
  // reviewer may still refuse it: reviews)
  // (an MCP tool: only the reads auto mode lets by unreviewed, reviews;
  // reads: config's mcp_reads)
  export function allows(mode: Mode, tool: string, input: any, reads: readonly string[] = []): string | null {
    if (mode !== "plan" || READS.includes(tool) || (tool.startsWith("mcp__") && !Modes.reviews("auto", tool, input, reads))) {
      return null;
    }
    const why = "In plan mode only reading is allowed, until the user approves a plan";
    if (tool === "shell") {
      const not = Modes.readonly(String(input?.command ?? ""));
      return not === null ? null : why + ": " + not + ". " + AFTER;
    }
    return why + ": " + tool + " can change things. " + AFTER;
  }

  // RED ZONE (security review U3, DRAFT awaiting the user's sign-off):
  // the MCP tools auto mode lets by unreviewed, by whole name, of the
  // servers local/mcp.ts sets up: plainly reads (no fetch, navigate,
  // evaluate, execute*, nor a screenshot written to a path). Config's
  // mcp_reads adds more (Tools.ts passes them); any other is reviewed
  // an argument naming a file or dir: an MCP read given one may write there
  const MCP_FILE = /file|path|dir/i;
  export const MCP_READS: readonly string[] = [
    ...["getJiraIssue", "searchJiraIssuesUsingJql", "listJiraIssueComments", "getConfluenceContent", "searchConfluence", "search", "getAccessibleAtlassianResources", "atlassianUserInfo"].map((t) => "mcp__atlassian__" + t),
    ...["browser_snapshot", "browser_console_messages", "browser_network_requests"].map((t) => "mcp__playwright__" + t),
    ...["list_pages", "take_snapshot", "list_console_messages", "get_console_message", "list_network_requests", "get_network_request"].map((t) => "mcp__chrome-devtools__" + t),
  ];

  // whether auto mode's reviewer checks a tool's call: not a plainly
  // read-only shell command (as Claude Code), network reads included, nor
  // a feature branch's plain push (K10), unless it reads secrets (in its
  // line or its words, quotes off), nor an MCP tool whose exact name is on
  // MCP_READS or reads (one cut with a hash, Mcp.name, never is)
  export function reviews(mode: Mode, tool: string, input?: any, reads: readonly string[] = []): boolean {
    if (mode !== "auto") {
      return false;
    }
    if (tool.startsWith("mcp__")) {
      // a file or path argument: the "read" may write it (playwright filename, devtools filePath)
      return /_[0-9a-f]{8}$/.test(tool) || Object.keys(input ?? {}).some((k) => MCP_FILE.test(k)) || !(MCP_READS.includes(tool) || reads.includes(tool));
    }
    if (!REVIEWED.includes(tool)) {
      return false;
    }
    const command = tool === "shell" && typeof input?.command === "string" ? input.command : null;
    // not plain ASCII: the Mac folds lookalikes (a long s is s), so a name may hide
    if (command === null || /[^\x00-\x7f]/.test(command) || SECRETS.test(command) || (Modes.readonly(command) !== null && !Modes.feature_push(command))) {
      return true;
    }
    const lexed = lex(command);
    return typeof lexed === "string" || lexed.flat().some((w) => SECRETS.test(w) || HOME_WIDE.test(w));
  }

  // why a shell command is not plainly read-only; null: it is
  export function readonly(command: string): string | null {
    const lexed = lex(command);
    if (typeof lexed === "string") {
      return lexed;
    }
    if (lexed.length === 0) {
      return "no command";
    }
    for (const words of lexed) {
      const why = words.length === 0 ? "an empty command" : check(words);
      if (why !== null) {
        return why;
      }
    }
    return null;
  }

  // a command line as its commands' words (split at | || && ;), quotes
  // taken off; a string: why it can't be read as plainly read-only
  function lex(line: string): string[][] | string {
    const cmds: string[][] = [[]];
    let word: string | null = null;
    const end = () => {
      if (word !== null) {
        cmds.at(-1)!.push(word);
        word = null;
      }
    };
    for (let k = 0; k < line.length; k++) {
      const c = line[k]!;
      if (c === "'") {
        const close = line.indexOf("'", k + 1);
        if (close < 0) {
          return "an unclosed quote";
        }
        word = (word ?? "") + line.slice(k + 1, close);
        k = close;
      } else if (c === '"') {
        const q = dquote(line, k);
        if (typeof q === "string") {
          return q;
        }
        word = (word ?? "") + q[0];
        k = q[1];
      } else if (c === "\\") {
        if (line[k + 1] === "\n") {
          return "a newline";
        }
        word = (word ?? "") + (line[k + 1] ?? "");
        k += 1;
      } else if (c === " " || c === "\t") {
        end();
      } else if (c === "\n" || c === "\r") {
        return "a newline (one command line only)";
      } else if (c === "`" || (c === "$" && line[k + 1] === "(")) {
        return "a command substitution";
      } else if (c === "<") {
        return "a redirect or process substitution (<)";
      } else if ("{}()*?[]".includes(c) || (c === "=" && word === null) || (c === "$" && "~=^{[".includes(line[k + 1] ?? " "))) {
        return "an unquoted " + c + " (the shell expands it: glob, brace, paren or =cmd)";
      } else if (c === ">") {
        const to = stderr(line, k, word);
        if (typeof to === "string") {
          return to;
        }
        word = null;
        k = to;
      } else if (c === "|" || c === ";" || c === "&") {
        const two = line.slice(k, k + 2);
        if (c === "&" && two !== "&&") {
          return "a background job (&)";
        }
        end();
        if (cmds.at(-1)!.length === 0) {
          return "an empty command";
        }
        cmds.push([]);
        if (two === "&&" || two === "||") {
          k += 1;
        }
      } else {
        word = (word ?? "") + c;
      }
    }
    end();
    return cmds.at(-1)!.length === 0 && cmds.length > 1 ? "an empty command" : cmds.filter((w) => w.length > 0);
  }

  // a redirect at k after the word before it: only stderr thrown away or
  // joined to stdout (2>/dev/null, 2>&1), so where it ends; a string: why not
  function stderr(line: string, k: number, before: string | null): number | string {
    const rest = line.slice(k + 1);
    const tail = /^&1(?=\s|$|[|;&])/.exec(rest) ?? /^\/dev\/null(?=\s|$|[|;&])/.exec(rest);
    return before !== "2" || tail === null ? "a redirect (>)" : k + tail[0].length;
  }

  // a double-quoted word from the quote at k: its text and where it ends
  // (the closing quote); a string: why not (a substitution expands even
  // in double quotes)
  function dquote(line: string, k: number): [string, number] | string {
    let w = "";
    for (k += 1; k < line.length && line[k] !== '"'; k++) {
      if (line[k] === "`" || (line[k] === "$" && line[k + 1] === "(")) {
        return "a command substitution";
      }
      if (line[k] === "$" && (line[k + 1] === "{" || line[k + 1] === "[")) {
        return "a ${...} or $[...] (zsh's flags can run code)";
      }
      if (line[k] === "\\") {
        k += 1;
      }
      w += line[k] ?? "";
    }
    return k >= line.length ? "an unclosed quote" : [w, k];
  }

  // whether an argument is one of the long options named, as git and GNU
  // take them: abbreviated, with or without =value
  function long(a: string, names: string[]): boolean {
    const name = a.split("=")[0]!;
    return name.startsWith("--") && name.length > 2 && names.some((n) => n.startsWith(name));
  }

  // why a gh command is not read-only (GH, GH_FLAGS, GH_API); null: it is
  function gh(args: string[]): string | null {
    const [group = "", sub = "", ...rest] = args;
    if (group === "api") {
      for (let k = 1; k < args.length; k++) {
        const a = args[k]!;
        // a header only to say what it accepts (K10's -H 'Accept: ...'): any
        // other may change the method (X-HTTP-Method-Override)
        const header = a === "-H" || a === "--header" ? args[++k] ?? "" : /^(?:-H|--header=)(.+)$/.exec(a)?.[1];
        if (header !== undefined) {
          if (!/^\s*accept\s*:/i.test(header)) {
            return "gh api -H other than Accept (" + header + ")";
          }
          continue;
        }
        const method = a === "-X" || a === "--method" ? args[++k] : /^(-X|--method=)(.*)$/.exec(a)?.[2];
        if (method !== undefined ? method.toUpperCase() !== "GET" : a.startsWith("-") ? !GH_API.has(a.split("=")[0]!) : a.includes("://")) {
          return "gh api other than a GET of a path on GitHub (" + a + ")";
        }
      }
      return null;
    }
    if (!Object.hasOwn(GH, group) || !GH[group]!.includes(sub)) {
      return "gh " + [group, sub].join(" ").trim() + " is not one that only reads";
    }
    if (group === "auth" && rest.length > 0) {
      return "gh auth status takes no flag here (-t prints the token)";
    }
    const bad = rest.find((a) => a.startsWith("-") && !GH_FLAGS.has(a.split("=")[0]!));
    if (bad !== undefined) {
      return "gh " + group + " " + sub + " " + bad + " (not a flag that only reads)";
    }
    for (let k = 0; k < rest.length; k++) {
      const a = rest[k]!;
      const repo = a === "-R" || a === "--repo" ? rest[++k] ?? "" : /^(?:-R|--repo)=(.*)$/.exec(a)?.[1];
      if (repo !== undefined && !GH_REPO.test(repo)) {
        return "gh -R takes OWNER/REPO on GitHub, not " + repo;
      }
    }
    return null;
  }

  // a plain push of a feature branch to origin (K10): one command, git
  // push, only PUSH_FLAGS, origin and one branch (or HEAD:branch), not
  // forced (+), not deleting (:x), not a PROTECTED one
  export function feature_push(command: string): boolean {
    const lexed = lex(command);
    if (typeof lexed === "string" || lexed.length !== 1) {
      return false;
    }
    const [git, push, ...rest] = lexed[0]!;
    if (git !== "git" || push !== "push") {
      return false;
    }
    const flags = rest.filter((a) => a.startsWith("-"));
    const places = rest.filter((a) => !a.startsWith("-"));
    if (flags.some((f) => !PUSH_FLAGS.has(f)) || places.length !== 2 || places[0] !== "origin") {
      return false;
    }
    const branch = /^(?:HEAD:)?([\w./-]+)$/.exec(places[1]!)?.[1];
    return branch !== undefined && !PROTECTED.test(branch) && !branch.startsWith("-") && !branch.includes("..");
  }

  // why one command is not read-only; null: it is
  function check(words: string[]): string | null {
    const [cmd, ...args] = words as [string, ...string[]];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cmd)) {
      return "a variable set before a command";
    }
    if (cmd.includes("/")) {
      return "a program by its path (" + cmd + ")";
    }
    if (PLAIN.has(cmd)) {
      return null;
    }
    switch (cmd) {
      case "sort": {
        return args.some((a) => long(a, ["--output", "--compress-program"]) || /^-[a-zA-Z]*o/.test(a)) ? "sort -o or --compress-program writes or runs" : null;
      }
      case "tree": {
        return args.some((a) => long(a, ["--output"]) || /^-[^-]*o/.test(a)) ? "tree -o writes a file" : null;
      }
      case "file": {
        return args.some((a) => long(a, ["--compile"]) || /^-[a-zA-Z]*C/.test(a)) ? "file -C writes a magic file" : null;
      }
      case "uniq": {
        return args.filter((a) => !a.startsWith("-")).length > 1 ? "uniq with an output file" : null;
      }
      case "rg": {
        return args.some((a) => a === "--pre" || a.startsWith("--pre=") || a === "--pre-glob" || a.startsWith("--pre-glob=")) ? "rg --pre runs another program" : null;
      }
      case "gh": {
        return gh(args);
      }
      case "find": {
        const act = args.find((a) => FIND_WRITES.has(a));
        return act === undefined ? null : "find " + act + " writes or runs";
      }
      case "git": {
        const sub = args[0];
        if (sub === undefined || sub.startsWith("-")) {
          return "git with options before its subcommand";
        }
        if (sub === "fetch") {
          return args.some((a) => long(a, ["--upload-pack"])) ? "git fetch --upload-pack runs another program" : null;
        }
        if (!GIT.has(sub)) {
          return "git " + sub + " is not one that only reads";
        }
        const rest = args.slice(1);
        if (rest.some((a) => long(a, ["--output", "--ext-diff", "--exec", "--open-files-in-pager"]) || (sub === "grep" && /^-[a-zA-Z]*O/.test(a)))) {
          return "git " + sub + " with an option that writes or runs";
        }
        if (sub === "reflog" && rest[0] !== undefined && rest[0] !== "show" && !rest[0].startsWith("-")) {
          return "git reflog " + rest[0] + " (only show reads)";
        }
        if ((sub === "branch" || sub === "tag") && rest.some((a) => long(a, GIT_WRITES) || GIT_SHORTS.test(a) || !a.startsWith("-"))) {
          return "git " + sub + " that makes, moves or deletes one";
        }
        return null;
      }
      default: {
        return cmd + " is not on plan mode's read-only list";
      }
    }
  }
}
