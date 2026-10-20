// Skills
// ======
// `bun local/skills.ts [out]`. An index of the skills Claude Code loads,
// for the agent's rules (local/rules.md imports it; the wrapper makes it
// at each start, to ~/.unii/skills.md): the user's (~/.claude/skills,
// links followed) and those of the plugins enabled for the user
// (settings.json enabledPlugins), at their installed version
// (installed_plugins.json), never a disabled one, one local to a
// project, or an old version left in the cache. A plugin's skill is
// named "plugin:skill", as Claude Code names it. The agent reads a
// skill's SKILL.md when a task matches it, as Claude Code does.

import * as fs from "node:fs";
import * as os from "node:os";

// Types
// =====

export type Skill = { name: string; description: string; path: string };

// Constants
// =========

// a description's most characters in the index
const SAY = 250;

const HEAD = `# Skills

Packaged instructions, the same your user's Claude Code has. When a task matches one, read its SKILL.md with the shell on this computer's device and follow it; it may point to scripts and files beside it. Skills written for Claude Code may name its tools: use yours.
`;

// Skills
// ======

// a SKILL.md's frontmatter keys: plain, quoted, or folded (> or |) over
// the indented lines after
function front(text: string): Record<string, string> {
  const body = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const out: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv === null) {
      continue;
    }
    let value = kv[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const more: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        more.push(lines[++i].trim());
      }
      value = more.join(" ");
    }
    out[kv[1]] = value.replace(/^(["'])([\s\S]*)\1$/, "$2").replace(/\s+/g, " ").trim();
  }
  return out;
}

// the skills in a folder of skill folders (each with a SKILL.md), named
// with `prefix`
function folder(dir: string, prefix: string): Skill[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).flatMap((d) => {
    const path = dir + "/" + d + "/SKILL.md";
    if (!fs.existsSync(path)) {
      return [];
    }
    const f = front(fs.readFileSync(path, "utf8"));
    return [{ name: prefix + (f.name || d), description: f.description ?? "", path }];
  });
}

function json(path: string): any {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function skills(home: string): Skill[] {
  const enabled = json(home + "/.claude/settings.json").enabledPlugins ?? {};
  const installed = json(home + "/.claude/plugins/installed_plugins.json").plugins ?? {};
  const plugins = Object.entries(installed).flatMap(([key, entries]) => {
    const user = (Array.isArray(entries) ? entries : [entries]).find((e: any) => e?.scope === "user");
    return enabled[key] === true && user?.installPath ? folder(user.installPath + "/skills", key.split("@")[0] + ":") : [];
  });
  return [...folder(home + "/.claude/skills", ""), ...plugins];
}

export function skills_index(list: Skill[]): string {
  const cut = (s: string) => (s.length > SAY ? s.slice(0, SAY - 1) + "…" : s);
  return HEAD + "\n" + list.map((s) => "- " + s.name + ": " + cut(s.description) + " (" + s.path + ")").join("\n") + "\n";
}

if (import.meta.main) {
  const out = process.argv[2] ?? os.homedir() + "/.unii/skills.md";
  const list = skills(os.homedir());
  const text = skills_index(list);
  fs.writeFileSync(out, text);
  console.log("skills:", list.length, "in", out, "(" + text.length + " chars)");
}
