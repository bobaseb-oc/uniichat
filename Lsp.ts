// Lsp
// ===
// The `lsp` tool (Tools.ts): code intelligence from a language server of
// this computer, the one unii's server runs on (mcp.json "lsp", made by
// local/mcp.ts): pyright for Python, TypeScript's own (tsc --lsp) for
// TypeScript and JavaScript. One server runs per project root (the
// nearest folder up with .git, pyproject.toml, package.json or
// tsconfig.json) and language, started as first wanted and closed after
// IDLE unused, a child in its own process group as Mcp.ts keeps them.
// Messages are JSON in Content-Length frames, counted in bytes. A file is
// opened from disk before it is asked about, and sent again whole when
// its modified time changes. Positions are 1-based for the model, 0-based
// on the wire. Diagnostics are pulled from a server that offers it, else
// waited for (DIAGS) as it pushes them. A failure is one line.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Agent, type Out } from "./Agent.ts";
import { clip } from "./Clip.ts";
import { Mcp, type Link } from "./Mcp.ts";

// Types
// =====

// a language's server: its program and args
export type Lang = { command: string; args: string[] };

export type Args = { operation: string; file: string; line?: number; character?: number; query?: string };

// a server, open or not: the files sent to it (their versions and
// modified times), the diagnostics it pushed, those waited for, what it
// can do
type Srv = {
  name  : string;
  root  : string;
  link  : Promise<Link> | null;
  timer : ReturnType<typeof setTimeout> | null;
  busy  : number; // its requests still waiting (it is not closed meanwhile)
  docs  : Map<string, { version: number; mtime: number }>;
  diags : Map<string, any[]>;
  wait  : Map<string, () => void>;
  caps  : any;
};

export type Pool = {
  langs   : Record<string, Lang>;
  servers : Map<string, Srv>;
  idle    : number;
};

// Constants
// =========

export const OPS = ["definition", "references", "hover", "documentSymbol", "workspaceSymbol", "diagnostics"];

// a file's language by its extension: its server's, and its id on the wire
const EXT: Record<string, [string, string]> = {
  ".py"  : ["python", "python"],
  ".pyi" : ["python", "python"],
  ".ts"  : ["typescript", "typescript"],
  ".mts" : ["typescript", "typescript"],
  ".cts" : ["typescript", "typescript"],
  ".tsx" : ["typescript", "typescriptreact"],
  ".js"  : ["typescript", "javascript"],
  ".mjs" : ["typescript", "javascript"],
  ".cjs" : ["typescript", "javascript"],
  ".jsx" : ["typescript", "javascriptreact"],
};

const ROOTS = [".git", "pyproject.toml", "package.json", "tsconfig.json"];

const IDLE = 600e3;
const ASK = 60e3;
const DIAGS = 10e3;

// SymbolKind (1-26), DiagnosticSeverity (1-4)
const KINDS = ["", "file", "module", "namespace", "package", "class", "method", "property", "field", "constructor", "enum", "interface", "function", "variable", "constant", "string", "number", "boolean", "array", "object", "key", "null", "enum member", "struct", "event", "operator", "type parameter"];
const SEVERITY = ["", "error", "warning", "info", "hint"];

// Lsp
// ===

export namespace Lsp {

  export function pool(langs: Record<string, Lang>, opts: { idle?: number } = {}): Pool {
    return { langs, servers: new Map(), idle: opts.idle ?? IDLE };
  }

  // the pool of mcp.json's "lsp" (none if it is missing)
  export function load(file: string): Pool {
    let got: any = {};
    try {
      got = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    return Lsp.pool(got?.lsp !== null && typeof got?.lsp === "object" ? got.lsp : {});
  }

  // a project's root: the nearest folder up holding a marker, else the
  // file's own folder
  export function root(file: string): string {
    const start = path.dirname(file);
    for (let dir = start; ; dir = path.dirname(dir)) {
      if (ROOTS.some((m) => fs.existsSync(path.join(dir, m)))) {
        return dir;
      }
      if (path.dirname(dir) === dir) {
        return start;
      }
    }
  }

  export async function run(pool: Pool, args: Args, signal: AbortSignal): Promise<Out> {
    const fail = (text: string): Out => ({ text, fail: true });
    const op = String(args.operation);
    const file = String(args.file ?? "");
    if (!OPS.includes(op)) {
      return fail("No operation " + op + "; one of " + OPS.join(", ") + ".");
    }
    if (!path.isAbsolute(file)) {
      return fail("Give the file's absolute path on this computer: " + file);
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return fail("No file " + file + " on this computer.");
    }
    const lang = EXT[path.extname(file).toLowerCase()];
    if (lang === undefined || pool.langs[lang[0]] === undefined) {
      return fail("No language server for " + (path.extname(file) || "extensionless") + " files here (Python, TypeScript, JavaScript).");
    }
    const at = ["definition", "references", "hover"].includes(op);
    const line = Number(args.line);
    const character = Number(args.character);
    if (at && !(Number.isInteger(line) && line >= 1 && Number.isInteger(character) && character >= 1)) {
      return fail(op + " needs line and character (from 1).");
    }
    const srv = Lsp.server(pool, lang[0], Lsp.root(file));
    const sig = AbortSignal.any([signal, AbortSignal.timeout(ASK)]);
    try {
      srv.busy++;
      const link = await Lsp.open(pool, srv, sig);
      const uri = pathToFileURL(file).href;
      Lsp.sync(link, srv, file, uri, lang[1]);
      const doc = { textDocument: { uri } };
      const pos = { ...doc, position: { line: line - 1, character: character - 1 } };
      let text: string;
      switch (op) {
        case "definition": {
          text = Lsp.places(await link.ask("textDocument/definition", pos, sig), true) || "No definition found.";
          break;
        }
        case "references": {
          text = Lsp.places(await link.ask("textDocument/references", { ...pos, context: { includeDeclaration: true } }, sig), true) || "No references found.";
          break;
        }
        case "hover": {
          text = Lsp.hover(await link.ask("textDocument/hover", pos, sig)) || "No hover information.";
          break;
        }
        case "documentSymbol": {
          text = Lsp.symbols(await link.ask("textDocument/documentSymbol", doc, sig), 0) || "No symbols.";
          break;
        }
        case "workspaceSymbol": {
          const found = await link.ask("workspace/symbol", { query: String(args.query ?? "") }, sig);
          text = (found ?? []).map((s: any) => s.name + " (" + (KINDS[s.kind] ?? "symbol") + ") " + Lsp.place(s.location?.uri, s.location?.range, false)).join("\n") || "No symbols.";
          break;
        }
        default: {
          text = Lsp.diagnostics(await Lsp.diags(link, srv, uri, sig), file) || "No diagnostics.";
        }
      }
      const out = clip();
      out.add(text);
      return { text: out.text(), fail: false };
    } catch (err: any) {
      const why = signal.aborted ? "(stopped)" : sig.aborted && sig.reason?.name === "TimeoutError" ? "no answer in " + ASK / 1000 + " s." : String(err?.message ?? err).split("\n")[0].slice(0, 200);
      return fail(srv.name + " language server: " + why);
    } finally {
      srv.busy--;
      Lsp.touch(pool, srv);
    }
  }

  // Servers
  // -------

  export function server(pool: Pool, name: string, root: string): Srv {
    const key = name + "\0" + root;
    const had = pool.servers.get(key);
    if (had !== undefined) {
      return had;
    }
    const srv: Srv = { name, root, link: null, timer: null, busy: 0, docs: new Map(), diags: new Map(), wait: new Map(), caps: {} };
    pool.servers.set(key, srv);
    return srv;
  }

  export function open(pool: Pool, srv: Srv, signal: AbortSignal): Promise<Link> {
    Lsp.touch(pool, srv);
    srv.link ??= Lsp.connect(pool, srv, signal).catch((err) => {
      srv.link = null;
      throw err;
    });
    return srv.link;
  }

  export function touch(pool: Pool, srv: Srv): void {
    clearTimeout(srv.timer ?? undefined);
    srv.timer = setTimeout(() => (srv.busy > 0 ? Lsp.touch(pool, srv) : Lsp.close(srv)), pool.idle);
    srv.timer.unref?.();
  }

  // a server asked to shut down and exit, then ended as a child is
  export function close(srv: Srv): void {
    clearTimeout(srv.timer ?? undefined);
    srv.timer = null;
    const link = srv.link;
    srv.link = null;
    link?.then(async (l) => {
      await l.ask("shutdown", {}, AbortSignal.timeout(2e3)).catch(() => {});
      await l.tell("exit", {});
      l.close();
    }, () => {});
  }

  // a server started in its root, initialized for it
  export async function connect(pool: Pool, srv: Srv, signal: AbortSignal): Promise<Link> {
    const lang = pool.langs[srv.name];
    const proc = Mcp.child(lang.command, lang.args, {}, srv.root);
    const read = Lsp.reader();
    const got = (async function* () {
      for await (const chunk of proc.stdout) {
        yield read(chunk);
      }
    })();
    const folder = { uri: pathToFileURL(srv.root).href, name: path.basename(srv.root) };
    const cancel = (id: number) => ({ method: "$/cancelRequest", params: { id } });
    const link = Mcp.peer(proc, Lsp.frame, got, cancel, (msg) => Lsp.other(srv, msg));
    srv.docs.clear();
    srv.diags.clear();
    try {
      const init = await link.ask("initialize", { processId: process.pid, clientInfo: { name: "unii" }, rootUri: folder.uri, workspaceFolders: [folder], capabilities: CAPS }, signal);
      srv.caps = init?.capabilities ?? {};
      await link.tell("initialized", {});
      return link;
    } catch (err) {
      link.close();
      throw err;
    }
  }

  // what the server sends that answers no request of ours: diagnostics
  // kept; its requests answered as a plain client does (undefined: none
  // such)
  export function other(srv: Srv, msg: any): unknown {
    switch (msg.method) {
      case "textDocument/publishDiagnostics": {
        const uri = String(msg.params?.uri);
        srv.diags.set(uri, Array.isArray(msg.params?.diagnostics) ? msg.params.diagnostics : []);
        srv.wait.get(uri)?.();
        return undefined;
      }
      case "workspace/configuration": {
        return (msg.params?.items ?? []).map(() => null);
      }
      case "client/registerCapability":
      case "client/unregisterCapability":
      case "window/workDoneProgress/create":
      case "window/showMessageRequest": {
        return null;
      }
    }
    return undefined;
  }

  // a message in its frame: a header, the length of its body in bytes
  export function frame(msg: object): string {
    const body = JSON.stringify(msg);
    return "Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body;
  }

  // what reads frames from a byte stream: the messages each chunk ends
  // (one cut short waits for the next; a body that is no JSON is dropped)
  export function reader(): (chunk: Uint8Array) => any[] {
    let buf = Buffer.alloc(0);
    return (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const out: any[] = [];
      for (let end = buf.indexOf("\r\n\r\n"); end >= 0; end = buf.indexOf("\r\n\r\n")) {
        const n = Number(buf.toString("latin1", 0, end).match(/content-length:\s*(\d+)/i)?.[1]);
        if (!Number.isInteger(n)) {
          buf = buf.subarray(end + 4);
          continue;
        }
        if (buf.length < end + 4 + n) {
          break;
        }
        out.push(Agent.parse(buf.toString("utf8", end + 4, end + 4 + n)));
        buf = buf.subarray(end + 4 + n);
      }
      return out;
    };
  }

  // Files
  // -----

  // a file sent to the server: opened the first time, sent whole again
  // when its modified time changed
  export function sync(link: Link, srv: Srv, file: string, uri: string, id: string): void {
    const mtime = fs.statSync(file).mtimeMs;
    const had = srv.docs.get(uri);
    if (had !== undefined && had.mtime === mtime) {
      return;
    }
    const text = fs.readFileSync(file, "utf8");
    srv.diags.delete(uri);
    if (had === undefined) {
      srv.docs.set(uri, { version: 1, mtime });
      link.tell("textDocument/didOpen", { textDocument: { uri, languageId: id, version: 1, text } });
    } else {
      srv.docs.set(uri, { version: had.version + 1, mtime });
      link.tell("textDocument/didChange", { textDocument: { uri, version: had.version + 1 }, contentChanges: [{ text }] });
    }
  }

  // a file's diagnostics: pulled if the server offers it, else those it
  // pushed since the file was last sent, waited for up to DIAGS
  export async function diags(link: Link, srv: Srv, uri: string, signal: AbortSignal): Promise<any[]> {
    if (srv.caps?.diagnosticProvider) {
      const got = await link.ask("textDocument/diagnostic", { textDocument: { uri } }, signal);
      return Array.isArray(got?.items) ? got.items : [];
    }
    if (!srv.diags.has(uri)) {
      await new Promise<void>((ok) => {
        const done = () => {
          clearTimeout(timer);
          srv.wait.delete(uri);
          signal.removeEventListener("abort", done);
          ok();
        };
        const timer = setTimeout(done, DIAGS);
        srv.wait.set(uri, done);
        signal.addEventListener("abort", done, { once: true });
      });
    }
    return srv.diags.get(uri) ?? [];
  }

  // Output
  // ------

  // locations (one, a list, or links) as path:line:col, 1-based, each with
  // its source line if `src`
  export function places(found: any, src: boolean): string {
    const list = found === null || found === undefined ? [] : Array.isArray(found) ? found : [found];
    const texts = new Map<string, string[] | null>();
    return list.map((l: any) => Lsp.place(l.targetUri ?? l.uri, l.targetSelectionRange ?? l.targetRange ?? l.range, src, texts)).join("\n");
  }

  export function place(uri: unknown, range: any, src: boolean, texts = new Map<string, string[] | null>()): string {
    if (typeof uri !== "string") {
      return "(no location)";
    }
    const file = uri.startsWith("file:") ? fileURLToPath(uri) : uri;
    const line = Number(range?.start?.line ?? 0);
    const at = file + ":" + (line + 1) + ":" + (Number(range?.start?.character ?? 0) + 1);
    if (!src) {
      return at;
    }
    if (!texts.has(file)) {
      try {
        texts.set(file, fs.readFileSync(file, "utf8").split("\n"));
      } catch {
        texts.set(file, null);
      }
    }
    const code = texts.get(file)?.[line];
    return code === undefined ? at : at + "\n    " + code.trim();
  }

  export function hover(found: any): string {
    const one = (c: any): string => (typeof c === "string" ? c : String(c?.value ?? ""));
    const c = found?.contents;
    return (Array.isArray(c) ? c.map(one) : [one(c)]).filter((s) => s.trim() !== "").join("\n\n").trim();
  }

  // symbols, nested ones indented under theirs
  export function symbols(list: any, depth: number): string {
    return (Array.isArray(list) ? list : []).map((s: any) => {
      const range = s.selectionRange ?? s.range ?? s.location?.range;
      const me = "  ".repeat(depth) + s.name + " (" + (KINDS[s.kind] ?? "symbol") + ") line " + (Number(range?.start?.line ?? 0) + 1);
      const kids = Lsp.symbols(s.children, depth + 1);
      return kids === "" ? me : me + "\n" + kids;
    }).join("\n");
  }

  export function diagnostics(list: any[], file: string): string {
    const by = (d: any) => Number(d.range?.start?.line ?? 0) * 1e6 + Number(d.range?.start?.character ?? 0);
    return [...list].sort((a, b) => by(a) - by(b)).map((d) => {
      const at = file + ":" + (Number(d.range?.start?.line ?? 0) + 1) + ":" + (Number(d.range?.start?.character ?? 0) + 1);
      const from = [d.source, d.code].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
      return at + " " + (SEVERITY[d.severity] || "error") + ": " + String(d.message ?? "").replace(/\s*\n\s*/g, " ") + (from === "" ? "" : " (" + from + ")");
    }).join("\n");
  }

}

// what this client can take
const CAPS = {
  textDocument: {
    synchronization    : { didSave: false },
    definition         : { linkSupport: true },
    references         : {},
    hover              : { contentFormat: ["markdown", "plaintext"] },
    documentSymbol     : { hierarchicalDocumentSymbolSupport: true },
    publishDiagnostics : {},
    diagnostic         : {},
  },
  // no workspaceFolders: pyright 1.1.408 answers nothing after initialize
  // to a client that says it supports them
  workspace: { symbol: {}, configuration: true },
};
