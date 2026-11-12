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
// other code refused (find -exec, rg --pre, git's writing subcommands...).

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
const READS = ["read", "glob", "grep"];

// the tools auto mode's reviewer checks
const REVIEWED = ["shell", "write", "edit"];

// commands that only read, whatever their arguments
// (not env, which runs its arguments; nor tree -o, uniq's output file:
// checked below)
const PLAIN = new Set(["ls", "cat", "head", "tail", "wc", "pwd", "echo", "file", "stat", "du", "df", "which", "diff", "cut", "jq", "basename", "dirname", "realpath", "true", "grep", "egrep", "fgrep", "nl", "whoami", "printenv", "tr", "column", "comm"]);

// git's subcommands that only read
const GIT = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame", "grep", "describe", "shortlog", "ls-tree", "cat-file", "reflog", "tag"]);

// git branch/tag flags that write
const GIT_WRITES = new Set(["-d", "-D", "-m", "-M", "-c", "-C", "-f", "--delete", "--move", "--copy", "--force", "-u", "--set-upstream-to", "--unset-upstream", "--edit-description", "-a", "-s", "--annotate", "--sign"]);

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
  export function allows(mode: Mode, tool: string, input: any): string | null {
    if (mode !== "plan" || READS.includes(tool)) {
      return null;
    }
    const why = "In plan mode only reading is allowed, until the user approves a plan";
    if (tool === "shell") {
      const not = Modes.readonly(String(input?.command ?? ""));
      return not === null ? null : why + ": " + not + ". " + AFTER;
    }
    return why + ": " + tool + " can change things. " + AFTER;
  }

  // whether auto mode's reviewer checks a tool's call
  export function reviews(mode: Mode, tool: string): boolean {
    return mode === "auto" && REVIEWED.includes(tool);
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
        let w = "";
        for (k += 1; k < line.length && line[k] !== '"'; k++) {
          if (line[k] === "`" || (line[k] === "$" && line[k + 1] === "(")) {
            return "a command substitution";
          }
          if (line[k] === "\\") {
            k += 1;
          }
          w += line[k] ?? "";
        }
        if (k >= line.length) {
          return "an unclosed quote";
        }
        word = (word ?? "") + w;
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
      } else if (c === ">") {
        // only stderr thrown away or joined to stdout
        const rest = line.slice(k + 1);
        const tail = /^&1(?=\s|$|[|;&])/.exec(rest) ?? /^\/dev\/null(?=\s|$|[|;&])/.exec(rest);
        if (word !== "2" || tail === null) {
          return "a redirect (>)";
        }
        word = null;
        k += tail[0].length;
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
        return args.some((a) => a === "-o" || a.startsWith("--output") || /^-[a-zA-Z]*o/.test(a)) ? "sort -o writes a file" : null;
      }
      case "tree": {
        return args.some((a) => a === "-o" || a.startsWith("--output")) ? "tree -o writes a file" : null;
      }
      case "uniq": {
        return args.filter((a) => !a.startsWith("-")).length > 1 ? "uniq with an output file" : null;
      }
      case "rg": {
        return args.some((a) => a === "--pre" || a.startsWith("--pre=") || a === "--pre-glob" || a.startsWith("--pre-glob=")) ? "rg --pre runs another program" : null;
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
        if (!GIT.has(sub)) {
          return "git " + sub + " is not one that only reads";
        }
        const rest = args.slice(1);
        if (rest.some((a) => a.startsWith("--output") || a === "--ext-diff" || a.startsWith("--exec"))) {
          return "git " + sub + " with an option that writes or runs";
        }
        if ((sub === "branch" || sub === "tag") && rest.some((a) => GIT_WRITES.has(a) || !a.startsWith("-"))) {
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
