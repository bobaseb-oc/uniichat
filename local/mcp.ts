// MCP config
// ==========
// `bun local/mcp.ts [out]`. The MCP servers the chat's agent may use
// (Mcp.ts reads them; the wrapper makes them at each start, to
// ~/.unii/mcp.json): Claude Code's own (~/.claude.json mcpServers), then
// the extra ones of mcp.extra.json (programs installed in local/tools),
// each as ~/.unii/mcp.local.json changes it ({"<server>": {"enabled":
// false} | {"tools": [...]} | {"allowed_origins": [...]}}). No secret is
// written: each header or env value becomes a placeholder, kept with the
// path to it in ~/.claude.json, read as the server opens. Left out, each
// said: the excluded (skills.ts), legacy SSE servers, and extra ones not
// installed. Its "lsp" names the language servers of the `lsp` tool (Lsp.ts):
// pyright from PATH, TypeScript's own (tsc --lsp) from local/tools.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Lang } from "../Lsp.ts";
import type { Server } from "../Mcp.ts";
import { EXCLUDE, json } from "./skills.ts";

// Types
// =====

export type Config = {
  servers : Server[];
  secrets : { file: string; vars: Record<string, string[]> };
  lsp     : Record<string, Lang>;
  notes   : string[];
};

// an extra server: as a Server, a URL (signed in to with OAuth if oauth)
// or a program, its path from the repo's root, and the origins its
// browser may open (passed as --allowed-origins)
type Extra = Omit<Server, "name"> & { allowed_origins?: string[] };

// MCP config
// ==========

// which: where a program is on PATH (null: nowhere)
export function mcp_config(home: string, root: string, which: (cmd: string) => string | null = Bun.which): Config {
  const file = home + "/.claude.json";
  const local: Record<string, { enabled?: boolean; tools?: string[]; allowed_origins?: string[] }> = json(home + "/.unii/mcp.local.json");
  const out: Config = { servers: [], secrets: { file, vars: {} }, lsp: {}, notes: [] };
  const on = (name: string) => !EXCLUDE.includes(name) && local[name]?.enabled !== false;
  const tools = (name: string) => (Array.isArray(local[name]?.tools) ? { tools: local[name].tools } : {});
  // a header's or env value as a placeholder, its path kept
  const hide = (name: string, part: string, vals: Record<string, string> | undefined) => Object.fromEntries(Object.keys(vals ?? {}).map((k) => {
    const v = (name + "_" + k).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    out.secrets.vars[v] = ["mcpServers", name, part, k];
    return [k, "${" + v + "}"];
  }));
  for (const [name, s] of Object.entries<any>(json(file).mcpServers ?? {})) {
    if (!on(name)) {
      continue;
    }
    if (s.type === "sse") {
      out.notes.push(name + ": SSE servers are not supported");
    } else if (typeof s.url === "string") {
      const headers = hide(name, "headers", s.headers);
      out.servers.push({ name, url: s.url, ...(s.headers ? { headers } : {}), ...tools(name) });
    } else if (typeof s.command === "string") {
      const env = hide(name, "env", s.env);
      out.servers.push({ name, command: s.command, args: (s.args ?? []).map(String), ...(s.env ? { env } : {}), ...tools(name) });
    }
  }
  const whole = (p: string) => (p.startsWith("~/") ? home + p.slice(1) : p);
  for (const [name, x] of Object.entries<Extra>(json(root + "/local/mcp.extra.json"))) {
    if (!on(name)) {
      continue;
    }
    if (typeof x.url === "string") {
      out.servers.push({ name, url: x.url, ...(x.oauth === true ? { oauth: true } : {}), ...tools(name) });
      continue;
    }
    const command = x.command?.startsWith("/") ? x.command : root + "/" + x.command;
    if (!fs.existsSync(command)) {
      out.notes.push(name + ": not installed (npm ci --prefix local/tools)");
      continue;
    }
    const origins = local[name]?.allowed_origins ?? x.allowed_origins;
    const args = [...(x.args ?? []).map(whole), ...(origins ? ["--allowed-origins", origins.join(";")] : [])];
    out.servers.push({ name, command, args, ...(x.env ? { env: x.env } : {}), ...tools(name) });
  }
  const pyright = which("pyright-langserver");
  if (pyright === null) {
    out.notes.push("lsp python: pyright-langserver not on PATH");
  } else {
    out.lsp.python = { command: pyright, args: ["--stdio"] };
  }
  const tsc = root + "/local/tools/node_modules/.bin/tsc";
  if (fs.existsSync(tsc)) {
    out.lsp.typescript = { command: tsc, args: ["--lsp", "--stdio"] };
  } else {
    out.notes.push("lsp typescript: not installed (npm ci --prefix local/tools)");
  }
  return out;
}

if (import.meta.main) {
  const out = process.argv[2] ?? os.homedir() + "/.unii/mcp.json";
  const got = mcp_config(os.homedir(), path.resolve(import.meta.dir, ".."));
  fs.writeFileSync(out, JSON.stringify({ servers: got.servers, secrets: got.secrets, lsp: got.lsp }, null, 2) + "\n", { mode: 0o600 });
  got.notes.forEach((note) => console.error("mcp: " + note));
  console.log("mcp:", got.servers.map((s) => s.name).join(", ") || "no servers", "| lsp:", Object.keys(got.lsp).join(", ") || "none", "in", out);
}
