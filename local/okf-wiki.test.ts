// OKF wiki MCP server test
// ========================
// `bun test local/okf-wiki.test.ts`. The server reads the OKF wiki's
// MkDocs search index from one pinned https host, size capped, and
// answers search_wiki and get_wiki_page from it; record_gap appends a
// redacted gap, owner-only, to a local file that never leaves the machine.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Modes } from "../Modes.ts";
import { Wiki } from "./okf-wiki.ts";

const INDEX = { docs: [
  { location: "", title: "OnCorps Ontology", text: "<p>Shared vocabulary for ReviewAI and ReconAI.</p>" },
  { location: "core-fs/entities/fund/", title: "Fund", text: "<p>A <b>fund</b> is a pooled investment vehicle. Funds have share classes.</p>" },
  { location: "core-fs/entities/fund/#nav", title: "NAV", text: "<p>Net asset value of the fund, per share class.</p>" },
  { location: "recon/checks/", title: "Recon checks", text: "<p>Checks compare a fund's cash to the bank.</p>" },
  { location: "repos/databricks/", title: "Databricks pipelines", text: "<p>databricks-bank-recon runs recon.</p>" },
] };

const fetcher = (body: string, status = 200) => async (url: string) => {
  fetcher.urls.push(url);
  return new Response(body, { status });
};
fetcher.urls = [] as string[];

test("search ranks title hits over text hits and gives a plain-text snippet", async () => {
  const w = Wiki.make({ fetch: fetcher(JSON.stringify(INDEX)) });
  const hits = await Wiki.search(w, "fund", 3);
  expect(hits.map((h) => h.location)).toEqual(["core-fs/entities/fund/", "core-fs/entities/fund/#nav", "recon/checks/"]);
  expect(hits[0].snippet).toBe("A fund is a pooled investment vehicle. Funds have share classes.");
  expect(hits[0].url).toBe(Wiki.BASE + "core-fs/entities/fund/");
  expect(await Wiki.search(w, "zebra", 3)).toEqual([]);
});

test("a page is its sections' text, plain, capped", async () => {
  const w = Wiki.make({ fetch: fetcher(JSON.stringify(INDEX)) });
  const page = await Wiki.page(w, "core-fs/entities/fund/");
  expect(page).toContain("# Fund");
  expect(page).toContain("## NAV");
  expect(page).toContain("Net asset value");
  expect(page).not.toContain("<p>");
  expect(await Wiki.page(w, "nope/")).toBeNull();
});

test("the index is fetched once from the pinned host, then cached", async () => {
  fetcher.urls = [];
  const w = Wiki.make({ fetch: fetcher(JSON.stringify(INDEX)) });
  await Wiki.search(w, "fund", 1);
  await Wiki.page(w, "recon/checks/");
  expect(fetcher.urls).toEqual([Wiki.BASE + "search/search_index.json"]);
});

test("a base off the pinned host, or not https, is refused before any fetch", () => {
  expect(() => Wiki.make({ base: "http://ui-prototypes.oc-dev.oncorps.io/financial-services/ontology/" })).toThrow();
  expect(() => Wiki.make({ base: "https://evil.test/financial-services/ontology/" })).toThrow();
  expect(() => Wiki.make({ base: "https://ui-prototypes.oc-dev.oncorps.io.evil.test/" })).toThrow();
});

test("an oversized or failed index is refused, and not cached", async () => {
  const big = Wiki.make({ fetch: fetcher("x".repeat(Wiki.CAP + 1)) });
  await expect(Wiki.search(big, "fund", 1)).rejects.toThrow(/too big/);
  const bad = Wiki.make({ fetch: fetcher("nope", 500) });
  await expect(Wiki.search(bad, "fund", 1)).rejects.toThrow(/500/);
});

test("record_gap appends one redacted line, owner-only, to the gap file", () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/okf-gap-");
  const file = dir + "/okf-gaps.jsonl";
  Wiki.gap(file, { topic: "share class hedging", wanted: "how ReconAI treats hedged share classes", evidence: "token sk-ant-api03-" + "a".repeat(40) });
  Wiki.gap(file, { topic: "t2", wanted: "w2" });
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.length).toBe(2);
  expect(lines[0].topic).toBe("share class hedging");
  expect(lines[0].evidence).not.toContain("sk-ant-api03-");
  expect(typeof lines[0].at).toBe("string");
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(() => Wiki.gap(file, { topic: "", wanted: "w" })).toThrow();
});

test("the lookups pass auto mode once the user lists them in mcp_reads; record_gap never", () => {
  const reads = ["mcp__okf-wiki__search_wiki", "mcp__okf-wiki__get_wiki_page"];
  expect(Modes.reviews("auto", "mcp__okf-wiki__search_wiki", {}, reads)).toBe(false);
  expect(Modes.reviews("auto", "mcp__okf-wiki__get_wiki_page", {}, reads)).toBe(false);
  expect(Modes.reviews("auto", "mcp__okf-wiki__search_wiki", {})).toBe(true);
  expect(Modes.reviews("auto", "mcp__okf-wiki__record_gap", {}, reads)).toBe(true);
});

test("as an MCP server over stdio: lists its tools and answers a search", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/okf-wiki-");
  fs.writeFileSync(dir + "/index.json", JSON.stringify(INDEX));
  const proc = Bun.spawn([import.meta.dir + "/okf-wiki.ts"], { env: { PATH: process.env.PATH ?? "", HOME: dir, OKF_WIKI_INDEX_FILE: dir + "/index.json" }, stdin: "pipe", stdout: "pipe" });
  const send = (m: object) => proc.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_wiki", arguments: { query: "nav" } } });
  proc.stdin.end();
  const out = (await new Response(proc.stdout).text()).trim().split("\n").map((l) => JSON.parse(l));
  const by = (id: number) => out.find((m) => m.id === id);
  expect(by(1).result.serverInfo.name).toBe("okf-wiki");
  expect(by(2).result.tools.map((t: any) => t.name).sort()).toEqual(["get_wiki_page", "record_gap", "search_wiki"]);
  expect(by(3).result.content[0].text).toContain("core-fs/entities/fund/#nav");
});

test("titles are plain, and a long page's word count does not outrank a page about the words", async () => {
  const long = { location: "ontology/vocabulary/", title: "Parties &amp; <code>scope</code>", text: "<p>" + "share class ".repeat(50) + "</p>" };
  const about = { location: "core-fs/entities/share-class/", title: "Share class hedging", text: "<p>A hedged share class.</p>" };
  const w = Wiki.make({ fetch: fetcher(JSON.stringify({ docs: [long, about] })) });
  const hits = await Wiki.search(w, "share class hedging", 2);
  expect(hits[0].location).toBe("core-fs/entities/share-class/");
  expect(hits[1].title).toBe("Parties & scope");
});
