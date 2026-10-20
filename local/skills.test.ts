// Skills test
// ===========
// `bun test local/skills.test.ts`. The skills index holds what Claude
// Code loads: the user's skills (links followed) and the skills of the
// plugins enabled for the user, at their installed version; nothing
// disabled, local to a project, or left in the cache.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { skills, skills_index } from "./skills.ts";

function skill(dir: string, head: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + "/SKILL.md", "---\n" + head + "\n---\n\n# Body\n");
}

function home(): string {
  const h = fs.mkdtempSync(os.tmpdir() + "/unii-skills-");
  const cache = h + "/.claude/plugins/cache";
  skill(h + "/.claude/skills/mine", "name: mine\ndescription: My own skill.");
  skill(h + "/shared/linked", 'name: linked\ndescription: "A linked one: quoted."');
  fs.symlinkSync(h + "/shared/linked", h + "/.claude/skills/linked");
  skill(cache + "/mk/on/2.0/skills/alpha", "name: alpha\ndescription: >\n  Folded over\n  two lines.");
  skill(cache + "/mk/on/1.0/skills/stale", "name: stale\ndescription: An old version's.");
  skill(cache + "/mk/off/1.0/skills/beta", "name: beta\ndescription: Disabled plugin.");
  skill(cache + "/mk/here/1.0/skills/gamma", "name: gamma\ndescription: Local to a project.");
  skill(cache + "/mk/on/2.0/skills/long", "name: long\ndescription: " + "x".repeat(400));
  fs.writeFileSync(h + "/.claude/settings.json", JSON.stringify({ enabledPlugins: { "on@mk": true, "off@mk": false, "here@mk": true } }));
  fs.writeFileSync(h + "/.claude/plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: {
    "on@mk"   : [{ scope: "user", installPath: cache + "/mk/on/2.0" }],
    "off@mk"  : [{ scope: "user", installPath: cache + "/mk/off/1.0" }],
    "here@mk" : [{ scope: "local", projectPath: "/p", installPath: cache + "/mk/here/1.0" }],
  } }));
  return h;
}

test("the user's skills and the enabled plugins' installed ones, by name", () => {
  const h = home();
  const found = skills(h);
  expect(found.map((s) => s.name).sort()).toEqual(["linked", "mine", "on:alpha", "on:long"]);
  expect(found.find((s) => s.name === "on:alpha")!.description).toBe("Folded over two lines.");
  expect(found.find((s) => s.name === "linked")!.description).toBe("A linked one: quoted.");
  expect(found.find((s) => s.name === "on:alpha")!.path).toBe(h + "/.claude/plugins/cache/mk/on/2.0/skills/alpha/SKILL.md");
});

test("the index says how to use a skill and lists each with its path, descriptions cut to 250", () => {
  const h = home();
  const text = skills_index(skills(h));
  expect(text).toStartWith("# Skills\n");
  expect(text).toContain("read its SKILL.md");
  expect(text).toContain("- on:alpha: Folded over two lines. (" + h + "/.claude/plugins/cache/mk/on/2.0/skills/alpha/SKILL.md)");
  expect(text).toContain("- on:long: " + "x".repeat(249) + "…");
  expect(text).not.toContain("beta");
  expect(text).not.toContain("gamma");
  expect(text).not.toContain("stale");
});
