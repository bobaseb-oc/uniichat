#!/usr/bin/env bun
// OKF wiki MCP server
// ===================
// `local/okf-wiki.ts` (stdio, from mcp.extra.json). The agents' lookup of
// the OnCorps Knowledge Framework wiki: search_wiki and get_wiki_page answer
// from the wiki's MkDocs search index (every page's text, one file), fetched
// once a process, at most an hour old, from one pinned https host, size
// capped. record_gap appends what an agent looked for and did not find (or
// found stale) to ~/.unii/okf-gaps.jsonl, redacted, owner-only; that file
// never leaves this computer by itself: turning gaps into an OKF pull
// request is a separate step, which a human merges (tasks/todo.md K5).
// OKF_WIKI_INDEX_FILE reads the index from a file instead (tests, offline).

import * as fs from "node:fs";
import * as os from "node:os";
import { env_secrets, redact } from "./prime/redact.ts";

// Types
// =====

type Doc = { location: string; title: string; text: string };
type Hit = { location: string; title: string; url: string; snippet: string };
type Gap = { topic: string; wanted: string; evidence?: string };

export type Wiki = {
  base  : string;
  fetch : (url: string) => Promise<Response>;
  file? : string;
  docs  : Doc[] | null;
  at    : number;
};

// OKF wiki
// ========

export namespace Wiki {
  export const HOST = "ui-prototypes.oc-dev.oncorps.io";
  export const BASE = "https://" + HOST + "/financial-services/ontology/";
  export const CAP = 8 * 2 ** 20; // the index is ~2 MB
  export const TTL = 3600_000;
  export const PAGE = 20_000; // characters of a page given back
  const SNIPPET = 300;

  export function make(opts: { base?: string; fetch?: Wiki["fetch"]; file?: string } = {}): Wiki {
    const base = opts.base ?? BASE;
    const url = new URL(base);
    if (url.protocol !== "https:" || url.hostname !== HOST || !base.endsWith("/")) {
      throw new Error("okf-wiki: the wiki is " + BASE + ", not " + base);
    }
    return { base, fetch: opts.fetch ?? ((u) => fetch(u, { redirect: "error" })), file: opts.file, docs: null, at: 0 };
  }

  // the index's pages, fetched at most once an hour; a failure is not kept
  export async function docs(w: Wiki): Promise<Doc[]> {
    if (w.docs !== null && Date.now() - w.at < TTL) {
      return w.docs;
    }
    let body: string;
    if (w.file !== undefined) {
      body = fs.readFileSync(w.file, "utf8");
    } else {
      const res = await w.fetch(w.base + "search/search_index.json");
      if (!res.ok) {
        throw new Error("okf-wiki: the index answered " + res.status);
      }
      body = await res.text();
    }
    if (body.length > CAP) {
      throw new Error("okf-wiki: the index is too big");
    }
    const got = JSON.parse(body)?.docs;
    if (!Array.isArray(got)) {
      throw new Error("okf-wiki: no docs in the index");
    }
    w.docs = got.filter((d) => typeof d?.location === "string").map((d) => ({ location: d.location, title: plain(String(d.title ?? "")), text: plain(String(d.text ?? "")) }));
    w.at = Date.now();
    return w.docs;
  }

  // HTML to plain text: tags off, entities read, spaces joined
  export function plain(html: string): string {
    const ents: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
    return html.replace(/<[^>]*>/g, " ").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ents[e]).replace(/\s+/g, " ").replace(/ ([.,;:!?])/g, "$1").trim();
  }

  // the best k pages for a query: each word in a title counts 10, in the
  // text 1 a time up to 5 (so a long page does not win on length)
  export async function search(w: Wiki, query: string, k = 8): Promise<Hit[]> {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 1);
    const count = (text: string, word: string) => text.split(word).length - 1;
    return (await docs(w))
      .map((d) => {
        const title = d.title.toLowerCase();
        const text = d.text.toLowerCase();
        return { d, score: words.reduce((n, x) => n + 10 * count(title, x) + Math.min(5, count(text, x)), 0) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(k, 25)))
      .map(({ d }) => ({ location: d.location, title: d.title, url: w.base + d.location, snippet: d.text.slice(0, SNIPPET) }));
  }

  // a page: its own text then its sections' (location#anchor), capped; null: none
  export async function page(w: Wiki, location: string): Promise<string | null> {
    const at = location.split("#")[0];
    const parts = (await docs(w)).filter((d) => d.location === at || d.location.startsWith(at + "#"));
    if (parts.length === 0) {
      return null;
    }
    const text = parts.map((d) => (d.location === at ? "# " : "## ") + d.title + "\n\n" + d.text).join("\n\n");
    return "Source: " + w.base + at + "\n\n" + text.slice(0, PAGE);
  }

  // a gap, redacted, as one line of the owner-only gap file
  export function gap(file: string, g: Gap): void {
    if (typeof g.topic !== "string" || g.topic.trim() === "" || typeof g.wanted !== "string" || g.wanted.trim() === "") {
      throw new Error("okf-wiki: a gap needs a topic and what was wanted");
    }
    const secrets = env_secrets(process.env);
    const clean = (s: string | undefined) => redact(String(s ?? "").slice(0, 2000), secrets).text;
    const line = { at: new Date().toISOString(), topic: clean(g.topic), wanted: clean(g.wanted), evidence: clean(g.evidence) };
    const fd = fs.openSync(file, "a", 0o600);
    try {
      fs.fchmodSync(fd, 0o600);
      fs.writeSync(fd, JSON.stringify(line) + "\n");
    } finally {
      fs.closeSync(fd);
    }
  }
}

// MCP server
// ==========

const TOOLS = [
  { name: "search_wiki", description: "Search the OnCorps Knowledge Framework (OKF) wiki: company vocabulary, entities, checks, ReconAI/ReviewAI products, repos. Look here before guessing a company fact; cite the url.", inputSchema: { type: "object", properties: { query: { type: "string" }, k: { type: "number", description: "results, at most 25 (default 8)" } }, required: ["query"] } },
  { name: "get_wiki_page", description: "Read one OKF wiki page (a location from search_wiki) as plain text.", inputSchema: { type: "object", properties: { location: { type: "string" } }, required: ["location"] } },
  { name: "record_gap", description: "Record knowledge you needed and could not find in OKF (wiki or okf MCP), or found stale. Never include client data, secrets or personal data. Gaps stay on this computer until a human proposes them to OKF.", inputSchema: { type: "object", properties: { topic: { type: "string" }, wanted: { type: "string", description: "what you looked for, or what is stale and why" }, evidence: { type: "string", description: "repo@commit or page that shows it" } }, required: ["topic", "wanted"] } },
];

async function answer(w: Wiki, name: string, args: any): Promise<string> {
  if (name === "search_wiki") {
    const hits = await Wiki.search(w, String(args?.query ?? ""), Number(args?.k ?? 8));
    return hits.length === 0 ? "No OKF wiki page matches. If this is company knowledge, call record_gap." : JSON.stringify(hits, null, 2);
  }
  if (name === "get_wiki_page") {
    return (await Wiki.page(w, String(args?.location ?? ""))) ?? "No such OKF wiki page.";
  }
  if (name === "record_gap") {
    const dir = os.homedir() + "/.unii";
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    Wiki.gap(dir + "/okf-gaps.jsonl", args ?? {});
    return "Gap recorded.";
  }
  throw new Error("no tool " + name);
}

async function serve(): Promise<void> {
  const w = Wiki.make({ file: process.env.OKF_WIKI_INDEX_FILE });
  const send = (m: object) => process.stdout.write(JSON.stringify(m) + "\n");
  let rest = "";
  const pending: Promise<void>[] = [];
  const handle = async (msg: any) => {
    if (msg?.id === undefined || typeof msg.method !== "string") {
      return;
    }
    const ok = (result: object) => send({ jsonrpc: "2.0", id: msg.id, result });
    if (msg.method === "initialize") {
      ok({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "okf-wiki", version: "1" } });
    } else if (msg.method === "tools/list") {
      ok({ tools: TOOLS });
    } else if (msg.method === "tools/call") {
      try {
        ok({ content: [{ type: "text", text: await answer(w, msg.params?.name, msg.params?.arguments) }] });
      } catch (err: any) {
        ok({ content: [{ type: "text", text: String(err?.message ?? err) }], isError: true });
      }
    } else if (msg.method === "ping") {
      ok({});
    } else {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no method " + msg.method } });
    }
  };
  for await (const chunk of process.stdin) {
    rest += Buffer.from(chunk).toString("utf8");
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines.filter((l) => l.trim() !== "")) {
      try {
        pending.push(handle(JSON.parse(line)));
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      }
    }
  }
  await Promise.all(pending);
}

if (import.meta.main) {
  await serve();
}
