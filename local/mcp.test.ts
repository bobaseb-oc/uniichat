// MCP config test
// ===============
// `bun test local/mcp.test.ts`. mcp.json holds Claude Code's MCP servers
// (~/.claude.json) and the extra ones (mcp.extra.json), changed by the
// user's mcp.local.json; never a secret: each header or env value is a
// placeholder, with where to read it. Excluded and disabled servers are
// left out, and extra servers whose program is not installed.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { mcp_config } from "./mcp.ts";

const SECRET = "ctx7sk-0123456789abcdef";
const OTHER = "env-secret-987";

function home(local: object | null = null): { home: string; root: string } {
  const h = fs.mkdtempSync(os.tmpdir() + "/unii-mcp-config-");
  const root = h + "/repo";
  fs.mkdirSync(root + "/local/tools/node_modules/.bin", { recursive: true });
  fs.writeFileSync(root + "/local/tools/node_modules/.bin/browse", "");
  fs.writeFileSync(h + "/.claude.json", JSON.stringify({ mcpServers: {
    "context7"   : { type: "http", url: "https://mcp.context7.com/mcp", headers: { CONTEXT7_API_KEY: SECRET } },
    "local.tool" : { command: "/usr/bin/tool", args: ["--x"], env: { TOOL_KEY: OTHER } },
    "claude-mem" : { command: "/usr/bin/mem" },
    "old"        : { type: "sse", url: "https://old.test/sse" },
  } }));
  fs.writeFileSync(root + "/local/mcp.extra.json", JSON.stringify({
    browse  : { command: "local/tools/node_modules/.bin/browse", args: ["--user-data-dir", "~/.unii/browser/b"], allowed_origins: ["http://localhost", "http://127.0.0.1"] },
    missing : { command: "local/tools/node_modules/.bin/missing" },
  }));
  if (local !== null) {
    fs.mkdirSync(h + "/.unii", { recursive: true });
    fs.writeFileSync(h + "/.unii/mcp.local.json", JSON.stringify(local));
  }
  return { home: h, root };
}

test("Claude Code's servers come with placeholders only, each with where its value is", () => {
  const h = home();
  const got = mcp_config(h.home, h.root);
  const text = JSON.stringify(got);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(OTHER);
  const ctx = got.servers.find((s) => s.name === "context7")!;
  expect(ctx).toEqual({ name: "context7", url: "https://mcp.context7.com/mcp", headers: { CONTEXT7_API_KEY: "${CONTEXT7_CONTEXT7_API_KEY}" } });
  const tool = got.servers.find((s) => s.name === "local.tool")!;
  expect(tool).toEqual({ name: "local.tool", command: "/usr/bin/tool", args: ["--x"], env: { TOOL_KEY: "${LOCAL_TOOL_TOOL_KEY}" } });
  expect(got.secrets).toEqual({ file: h.home + "/.claude.json", vars: {
    CONTEXT7_CONTEXT7_API_KEY : ["mcpServers", "context7", "headers", "CONTEXT7_API_KEY"],
    LOCAL_TOOL_TOOL_KEY       : ["mcpServers", "local.tool", "env", "TOOL_KEY"],
  } });
});

test("excluded (claude-mem), unsupported (SSE) and uninstalled servers are left out, each said", () => {
  const h = home();
  const got = mcp_config(h.home, h.root);
  const names = got.servers.map((s) => s.name);
  expect(names).not.toContain("claude-mem");
  expect(names).not.toContain("old");
  expect(names).not.toContain("missing");
  expect(got.notes.join("\n")).toContain("old: SSE");
  expect(got.notes.join("\n")).toContain("missing: not installed (npm ci --prefix local/tools)");
});

test("an extra server: its program from the repo, ~/ paths made whole, its allowed origins passed", () => {
  const h = home();
  const browse = mcp_config(h.home, h.root).servers.find((s) => s.name === "browse")!;
  expect(browse).toEqual({ name: "browse", command: h.root + "/local/tools/node_modules/.bin/browse", args: ["--user-data-dir", h.home + "/.unii/browser/b", "--allowed-origins", "http://localhost;http://127.0.0.1"] });
});

test("mcp.local.json turns a server off, limits its tools, sets its origins", () => {
  const h = home({ "context7": { enabled: false }, "local.tool": { tools: ["one"] }, "browse": { allowed_origins: ["http://localhost:3000", "https://app.test"] } });
  const got = mcp_config(h.home, h.root);
  expect(got.servers.map((s) => s.name)).not.toContain("context7");
  expect(got.servers.find((s) => s.name === "local.tool")!.tools).toEqual(["one"]);
  expect(got.servers.find((s) => s.name === "browse")!.args!.slice(-1)).toEqual(["http://localhost:3000;https://app.test"]);
  expect(Object.keys(got.secrets.vars)).toEqual(["LOCAL_TOOL_TOOL_KEY"]);
});

test("no ~/.claude.json, no extras: no servers, no failure", () => {
  const h = fs.mkdtempSync(os.tmpdir() + "/unii-mcp-none-");
  expect(mcp_config(h, h).servers).toEqual([]);
});
