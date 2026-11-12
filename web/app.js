// Demo.ts
var STATUSES = ["working", "working", "done", "failed", "waiting", "working", "stopped"];
var GOALS = [
  ["Fix flaky login tests", ["auth-api", "web"]],
  ["Ship the export to CSV", ["reports"]],
  ["Upgrade to Bun 1.4", ["legion"]],
  ["Reconcile the Q3 breaks", ["bank-recon"]],
  ["Review rules from merged PRs", ["shared-skills"]],
  ["Docs for the Crew view", ["legion", "docs"]],
  ["Triage the open bugs", ["web"]],
  ["Cut the 2.10 release", ["bank-recon", "infra"]]
];
var PARTS = ["Reproduce it", "Write the failing test", "Fix it", "Review the diff"];
var STEPS = ["Read the failing test", "Find the race", "Fix it", "Run the suite"];
function demo_crew(now) {
  const crew = [];
  for (let m = 0;m < 8; m++) {
    const [title, repos] = GOALS[m];
    crew.push({ name: "Mgr" + m, parent: "main", tier: "manager", model: "opus-5.5", status: "waiting", since: now - (m + 1) * 60000, title, repos });
    for (let w = 0;w < 5; w++) {
      const part = w < PARTS.length ? { title: PARTS[w], repos: [repos[w % repos.length]] } : {};
      const todo = w === 0 ? { todo: STEPS.map((text, k) => ({ text, status: k < m % STEPS.length ? "done" : k === m % STEPS.length ? "doing" : "pending" })) } : {};
      crew.push({ name: "W" + m + "-" + w, parent: "Mgr" + m, tier: "worker", model: "sonnet-5.5", status: STATUSES[(m + w) % STATUSES.length], since: now - (w + 1) * 9000, ...part, ...todo });
    }
  }
  crew.push({ name: "Sub3", parent: "Mgr3", tier: "manager", model: "opus-5.5", status: "waiting", since: now - 30000 });
  crew.push({ name: "W3-sub", parent: "Sub3", tier: "worker", model: "haiku-5.5", status: "working", since: now - 5000 });
  crew.push({ name: "Claude1", parent: "main", tier: "claude", model: "claude-code", status: "asking", since: now, title: "Refactor the device jobs", repos: ["legion"] });
  return crew;
}
function demo_pulses(crew) {
  return crew.map((c, k) => ({
    $: "pulse",
    name: c.name,
    status: c.status,
    act: c.status === "working" ? k % 2 === 0 ? "shell: bun test " + c.name + ".test.ts" : "Reading the failing case in " + c.name : "",
    last: c.status === "done" ? "Done: 12 tests pass." : c.status === "failed" ? "failed: the build broke" : ""
  }));
}

// Clip.ts
var CAP = 30000;
function clip_end(str, at) {
  if (str.length - at <= CAP) {
    return str.length;
  }
  const nl = str.lastIndexOf(`
`, at + CAP - 1);
  const low = str.charCodeAt(at + CAP) >> 10 === 55;
  return nl >= at ? nl + 1 : at + CAP - (low ? 1 : 0);
}
function clip_pages(str) {
  const pages = [];
  let at = 0;
  do {
    const end = clip_end(str, at);
    pages.push(str.slice(at, end));
    at = end;
  } while (at < str.length);
  return pages;
}
async function* stream_lines(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream).getReader();
  let rest = "";
  for (let got = await reader.read();!got.done; got = await reader.read()) {
    const nl = got.value.lastIndexOf(`
`);
    if (nl >= 0) {
      yield (rest + got.value.slice(0, nl)).split(`
`);
      rest = "";
    }
    rest += got.value.slice(nl + 1);
  }
  yield [rest];
}

// Import.ts
var NODE = 512;
var LINE = 480;
var PRICE = { base: 187, byte: 735, depth: 628 };
var PART = 2 ** 20;
var OLD = "Nothing new: these chats are in Unii's memory already.";
var NOT_EXPORT = "Not a Claude or ChatGPT export.";
var MIDWAY = "Meanwhile, Legion can answer with a partial tree.";
var DONE = "Your past chats are in Unii's memory: ask about them any time.";
var DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" });
var COUNT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });
var EXPORTS = { Claude: "Settings › Privacy › Export data", ChatGPT: "Settings › Data controls › Export data" };
var INJECTED = /^(<[a-z_]+[ >]|# AGENTS\.md)/;
var SKIP = /^(<command-|<local-command|\[Request interrupted)/;
function import_file(path) {
  const session = /(^|\/)(projects|sessions|archived_sessions)\//.test(path);
  return session && path.endsWith(".jsonl") && !path.includes("subagents/");
}
async function import_session(file, form, app = "", where = "") {
  const s = { app, form, where, start: "", file, heads: [] };
  for await (const m of import_read(s)) {
    s.heads.push({ kind: m.kind, date: m.date, size: import_size(m), n: s.heads.length });
  }
  s.start = s.heads[0]?.date ?? "";
  return s.heads.length > 0 ? s : null;
}
async function* import_read(s) {
  let date = "";
  for await (const lines of stream_lines(s.file.stream())) {
    for (const line of lines) {
      const msgs = line_msgs(s, line, date);
      date = msgs.at(-1)?.date ?? date;
      yield* msgs;
    }
  }
}
function line_log(s, j, last) {
  s.app ||= j.type === "session_meta" ? "ChatGPT" : "Claude";
  return s.app === "ChatGPT" ? line_codex(s, j, last) : line_claude(s, j, last);
}
function line_msgs(s, line, last) {
  try {
    const j = JSON.parse(line);
    return s.form === "msgs" ? [j] : line_log(s, j, last);
  } catch {
    return [];
  }
}
function import_pick(sessions, want, done) {
  const old = [...sessions].sort((a, b) => a.start.localeCompare(b.start));
  const keep = (m, last) => (want.tools || m.kind === "user" || m.kind === "unii") && m.date >= want.since && import_new(m, last);
  const kept = (s, last) => s.heads.filter((m) => keep(m, last));
  return old.map((s) => ({ ...s, heads: kept(s, done[import_id(s)]) })).filter((s) => s.heads.length > 0);
}
function import_plan(sessions, want, done, count) {
  const all = import_pick(sessions, { ...want, since: "" }, done);
  const shown = import_pick(all, want, {});
  const picked = shown.filter((s) => !want.off.includes(import_id(s)));
  const first = all.map((s) => s.heads[0].date).sort()[0] ?? "";
  const sizes = picked.flatMap((s) => [import_size(import_note(s)), ...s.heads.map((m) => m.size)]);
  return { sessions: shown, picked, msgs: sizes.length - picked.length, first: first.slice(0, 10), sizes, guess: import_usd(count, sizes) };
}
function import_new(m, last) {
  return last === undefined || (m.date ?? "") > last;
}
function import_name(s) {
  return s.app + " " + s.where + ", from " + new Date(s.start).toLocaleString("sv-SE").slice(0, 16);
}
function import_cells(s) {
  const day = DAY.format(new Date(s.start));
  const where = s.where.startsWith("session in ") ? path_short(s.where.slice(11)) : s.where.replace(/^chat "(.*)"$/, "$1") || "untitled";
  return [day, count_short(s.heads.length), where];
}
function count_short(n) {
  return COUNT.format(n).toLowerCase();
}
function path_short(path) {
  const parts = path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~").split("/");
  const head = parts[0] === "" ? 2 : 1;
  return parts.length - head > 3 ? [...parts.slice(0, head + 1), "…", ...parts.slice(-2)].join("/") : parts.join("/");
}
function import_note(s) {
  return { kind: "note", text: import_name(s) + " (imported)", date: s.start };
}
function import_id(s) {
  return import_key(import_note(s));
}
function import_key(note) {
  return note.date + " " + note.text.replace(/^.*?(?= session in | chat ")/, "").replace(/, from [^,]*$/, "");
}
async function* import_body(picked) {
  let part = "";
  for (const s of picked) {
    const kept = new Set(s.heads.map((m) => m.n));
    let n = 0;
    part += JSON.stringify(import_note(s)) + `
`;
    for await (const m of import_read(s)) {
      part += kept.has(n++) ? JSON.stringify(m) + `
` : "";
      if (part.length >= PART) {
        yield part;
        part = "";
      }
    }
  }
  yield part;
}
function import_guess(a, sizes) {
  const usd = [];
  let nodes = sizes.map((bytes) => ({ bytes, depth: 0 }));
  for (let l = 0, i = a;nodes.length > 0; l++, i = Math.floor(i / 2)) {
    usd.push(nodes.map(node_usd));
    const line = (k) => k < 0 ? { bytes: LINE, depth: l } : node_line(nodes[k]);
    const from = Math.floor(i / 2);
    nodes = Array.from({ length: Math.floor((i + nodes.length) / 2) - from }, (_, j) => node_merge(line(2 * (from + j) - i), line(2 * (from + j) + 1 - i)));
  }
  return usd;
}
function import_usd(a, sizes) {
  return import_guess(a, sizes).flat().reduce((x, y) => x + y, 0) / 1e6;
}
function import_size(m) {
  return new TextEncoder().encode(m.kind + ": " + m.text).length;
}
function import_count(n, what) {
  return n.toLocaleString("en-US") + " " + what + (n === 1 ? "message" : "messages");
}
function topup(guess, credits) {
  const need = guess * 1.5 - credits;
  return need > 0 ? Math.ceil(need / 5) * 5 : 0;
}
function guess_usd(usd) {
  return "$" + Math.max(0.01, usd).toFixed(2);
}
function node_usd(node) {
  if (node.bytes <= NODE) {
    return 0;
  }
  const { base, byte, depth } = PRICE;
  return Math.round(base + byte * Math.log2(node.bytes / NODE) + depth * (node.depth + 1));
}
function node_line(node) {
  return node.bytes > NODE ? { bytes: LINE, depth: node.depth + 1 } : { bytes: node.bytes, depth: 0 };
}
function node_merge(a, b) {
  return { bytes: a.bytes + 1 + b.bytes, depth: Math.max(a.depth, b.depth) };
}
async function import_export(file) {
  const zip = await file.slice(0, 2).text() === "PK";
  const json = zip ? await zip_file(file, "conversations.json") : file;
  if (json === null) {
    throw new Error("No conversations.json in the zip.");
  }
  const chats = await json.text().then(JSON.parse).catch(() => null);
  if (!Array.isArray(chats) || !chats.every((chat) => chat?.mapping !== undefined || Array.isArray(chat?.chat_messages))) {
    throw new Error(NOT_EXPORT);
  }
  const sessions = await Promise.all(chats.map(chat_session));
  return sessions.filter((s) => s !== null);
}
function chat_session(chat) {
  const [app, msgs] = chat.mapping ? ["ChatGPT", chat_openai(chat)] : ["Claude", chat_claude(chat)];
  const file = new Blob(msgs.map((m) => JSON.stringify(m) + `
`));
  return import_session(file, "msgs", app, 'chat "' + String(chat.title ?? chat.name ?? "") + '"');
}
function chat_openai(chat) {
  const nodes = [];
  for (let id = chat.current_node;id; id = chat.mapping[id]?.parent) {
    nodes.unshift(chat.mapping[id]?.message);
  }
  let date = import_date(chat.create_time, "");
  return nodes.flatMap((m) => {
    const role = m?.author?.role;
    const type = String(m?.content?.content_type);
    const kind = role === "user" ? "user" : role === "assistant" ? m.recipient === "all" ? "unii" : "tool" : role === "tool" ? "echo" : null;
    const skip = kind === null || m.metadata?.is_visually_hidden_from_conversation === true || type === "thoughts" || type === "reasoning_recap";
    date = import_date(m?.create_time, date);
    return skip ? [] : msgs_of(kind, (kind === "tool" ? m.recipient + " " : "") + parts_text(m.content.parts ?? [m.content.text]), date);
  });
}
function chat_claude(chat) {
  let date = import_date(chat.created_at, "");
  return (chat.chat_messages ?? []).flatMap((m) => {
    date = import_date(m.created_at, date);
    const kind = m.sender === "human" ? "user" : "unii";
    const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.text ?? "") }];
    const files = [...m.attachments ?? [], ...m.files ?? []].map((f) => ({ type: "text", text: "[file " + f.file_name + "]" }));
    return blocks_msgs(kind, [...blocks, ...files], date);
  });
}
async function zip_file(zip, name) {
  const view = async (at, n) => new DataView(await zip.slice(at, at + n).arrayBuffer());
  const back = Math.min(zip.size, 65577);
  const tail = await view(zip.size - back, back);
  let end = tail.byteLength - 22;
  while (end >= 0 && tail.getUint32(end, true) !== 101010256) {
    end -= 1;
  }
  if (end < 0) {
    return null;
  }
  const wide = end >= 20 && tail.getUint32(end - 20, true) === 117853008;
  const z64 = wide ? await view(Number(tail.getBigUint64(end - 12, true)), 56) : null;
  const count = z64 === null ? tail.getUint16(end + 10, true) : Number(z64.getBigUint64(32, true));
  const size = z64 === null ? tail.getUint32(end + 12, true) : Number(z64.getBigUint64(40, true));
  const from = z64 === null ? tail.getUint32(end + 16, true) : Number(z64.getBigUint64(48, true));
  const dir = await view(from, size);
  for (let p = 0, k = 0;k < count; k++) {
    const entry = new TextDecoder().decode(new Uint8Array(dir.buffer, p + 46, dir.getUint16(p + 28, true)));
    const [, packed, at] = zip_sizes(dir, p);
    if (entry === name || entry.endsWith("/" + name)) {
      const head = await view(at, 30);
      const data = zip.slice(at + 30 + head.getUint16(26, true) + head.getUint16(28, true)).slice(0, packed);
      return dir.getUint16(p + 10, true) === 8 ? new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob() : data;
    }
    p += 46 + dir.getUint16(p + 28, true) + dir.getUint16(p + 30, true) + dir.getUint16(p + 32, true);
  }
  return null;
}
function zip_sizes(dir, p) {
  const short = [p + 24, p + 20, p + 42].map((at) => dir.getUint32(at, true));
  const extra = p + 46 + dir.getUint16(p + 28, true);
  let x = extra;
  while (x + 4 <= extra + dir.getUint16(p + 30, true) && dir.getUint16(x, true) !== 1) {
    x += 4 + dir.getUint16(x + 2, true);
  }
  let k = 0;
  return short.map((n) => n === 4294967295 ? Number(dir.getBigUint64(x + 4 + 8 * k++, true)) : n);
}
function line_claude(s, j, last) {
  const date = import_date(j.timestamp, last);
  const own = (j.type === "user" || j.type === "assistant") && !j.isMeta && !j.isSidechain && !j.isCompactSummary;
  const content = j.message?.content;
  const blocks = !own ? [] : typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  s.where ||= j.cwd ? "session in " + j.cwd : "";
  if (j.type === "attachment" && j.attachment?.type === "queued_command") {
    return msgs_of("user", String(j.attachment.prompt ?? ""), date);
  }
  return blocks_msgs(j.type === "user" ? "user" : "unii", blocks, date);
}
function blocks_msgs(kind, blocks, date) {
  const say = blocks.filter((b) => b.type === "image" || b.type === "text" && !SKIP.test(b.text));
  const tools = blocks.flatMap((b) => b.type === "tool_use" ? msgs_of("tool", b.name + " " + JSON.stringify(b.input), date) : b.type === "tool_result" ? msgs_of("echo", parts_text(b.content), date) : []);
  return [...msgs_of(kind, parts_text(say), date), ...tools];
}
function line_codex(s, j, last) {
  const p = j.payload ?? {};
  const date = import_date(j.timestamp, last);
  if (j.type === "session_meta") {
    s.where = p.source?.subagent ?? p.source?.internal ? "" : "session in " + String(p.cwd ?? "");
  }
  return j.type === "response_item" && s.where !== "" ? item_codex(p, date) : [];
}
function item_codex(p, date) {
  switch (p.type) {
    case "message": {
      const kind = p.role === "user" ? "user" : p.role === "assistant" ? "unii" : null;
      const parts = (p.content ?? []).filter((c) => !INJECTED.test(c.text ?? ""));
      return kind === null ? [] : msgs_of(kind, parts_text(parts), date);
    }
    case "function_call": {
      return msgs_of("tool", p.name + " " + p.arguments, date);
    }
    case "custom_tool_call": {
      return msgs_of("tool", p.name + " " + JSON.stringify({ input: p.input }), date);
    }
    case "local_shell_call": {
      return msgs_of("tool", "shell " + JSON.stringify({ command: p.action?.command }), date);
    }
    case "function_call_output":
    case "custom_tool_call_output": {
      return msgs_of("echo", parts_text(p.output), date);
    }
  }
  return [];
}
function import_date(at, last) {
  const ms = typeof at === "number" ? at * 1000 : Date.parse(String(at));
  return Number.isNaN(ms) ? last : new Date(ms).toISOString();
}
function msgs_of(kind, text, date) {
  const pages = text.trim() === "" ? [] : clip_pages(text);
  return pages.map((page, k) => ({ kind, text: page, date, more: k < pages.length - 1 }));
}
function parts_text(content) {
  if (typeof content === "string") {
    return content;
  }
  const parts = Array.isArray(content) ? content : [];
  return parts.map((c) => typeof c === "string" ? c : typeof c.text === "string" ? c.text : String(c.type ?? c.content_type).includes("image") ? "[image]" : "").join(`
`);
}

// Theme.ts
var WHO = { work: "Report", note: "Note" };
var KIND = {
  user: { dim: false, it: false },
  work: { dim: false, it: false },
  unii: { dim: false, it: false },
  tool: { dim: true, it: false },
  echo: { dim: true, it: false },
  note: { dim: true, it: true },
  mind: { dim: true, it: true }
};
var TOOL = {
  zoom: "\uD83D\uDD0D",
  date: "\uD83D\uDCC5",
  shell: "⌨️",
  read: "\uD83D\uDCD6",
  write: "\uD83D\uDCC4",
  edit: "\uD83D\uDCDD",
  spawn: "\uD83E\uDD16",
  tell: "\uD83D\uDCAC",
  computer: "\uD83D\uDDB1️"
};
var TOOL_ANY = "\uD83D\uDD27";
var GLYPH = {
  tab: "◯",
  here: "●",
  input: "> ",
  open: "▾"
};
function tool_glyph(name) {
  return TOOL[name] ?? TOOL_ANY;
}
function theme_css() {
  return Object.entries(KIND).map(([k, look]) => look_css(k, look)).join("");
}
function look_css(kind, look) {
  const ink = look.dim ? "mid" : "ink";
  const style = look.it ? "italic" : "normal";
  const body = "--fg:var(--" + ink + ");--it:" + style;
  return ".msg." + kind + "{" + body + "}";
}

// Modes.ts
var MODES = ["plan", "auto", "full"];
var AFTER = "Say what you would change instead: in your report, or, for Unii, in the plan it files (plan).";
var READS = ["read", "glob", "grep"];
var REVIEWED = ["shell", "write", "edit"];
var PLAIN = new Set(["ls", "cat", "head", "tail", "wc", "pwd", "echo", "file", "stat", "du", "df", "which", "diff", "cut", "jq", "basename", "dirname", "realpath", "true", "grep", "egrep", "fgrep", "nl", "whoami", "printenv", "tr", "column", "comm"]);
var GIT = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame", "grep", "describe", "shortlog", "ls-tree", "cat-file", "reflog", "tag"]);
var GIT_WRITES = new Set(["-d", "-D", "-m", "-M", "-c", "-C", "-f", "--delete", "--move", "--copy", "--force", "-u", "--set-upstream-to", "--unset-upstream", "--edit-description", "-a", "-s", "--annotate", "--sign"]);
var FIND_WRITES = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);
var Modes;
((Modes2) => {
  function read(x) {
    return MODES.includes(x) ? x : "auto";
  }
  Modes2.read = read;
  function next(mode) {
    return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  }
  Modes2.next = next;
  function allows(mode, tool, input) {
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
  Modes2.allows = allows;
  function reviews(mode, tool) {
    return mode === "auto" && REVIEWED.includes(tool);
  }
  Modes2.reviews = reviews;
  function readonly(command) {
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
  Modes2.readonly = readonly;
  function lex(line) {
    const cmds = [[]];
    let word = null;
    const end = () => {
      if (word !== null) {
        cmds.at(-1).push(word);
        word = null;
      }
    };
    for (let k = 0;k < line.length; k++) {
      const c = line[k];
      if (c === "'") {
        const close2 = line.indexOf("'", k + 1);
        if (close2 < 0) {
          return "an unclosed quote";
        }
        word = (word ?? "") + line.slice(k + 1, close2);
        k = close2;
      } else if (c === '"') {
        let w = "";
        for (k += 1;k < line.length && line[k] !== '"'; k++) {
          if (line[k] === "`" || line[k] === "$" && line[k + 1] === "(") {
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
        if (line[k + 1] === `
`) {
          return "a newline";
        }
        word = (word ?? "") + (line[k + 1] ?? "");
        k += 1;
      } else if (c === " " || c === "\t") {
        end();
      } else if (c === `
` || c === "\r") {
        return "a newline (one command line only)";
      } else if (c === "`" || c === "$" && line[k + 1] === "(") {
        return "a command substitution";
      } else if (c === "<") {
        return "a redirect or process substitution (<)";
      } else if (c === ">") {
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
        if (cmds.at(-1).length === 0) {
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
    return cmds.at(-1).length === 0 && cmds.length > 1 ? "an empty command" : cmds.filter((w) => w.length > 0);
  }
  function check(words) {
    const [cmd, ...args] = words;
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
})(Modes ||= {});

// Call.ts
var SHORT = 60;
var CALL = /^(\S+) (\{[\s\S]*)$/;
var MCP = /^mcp__.+?__/;
var READS2 = new Map([
  ["shell", (x) => ({ head: String(x.command ?? ""), blocks: [] })],
  ["read", (x) => ({ head: String(x.path ?? "") + lines_show(x.offset, x.limit), blocks: [] })],
  ["write", (x) => ({ head: String(x.path ?? ""), blocks: [] })],
  ["edit", (x) => Array.isArray(x.edits) ? { head: edits_files(x.edits), blocks: [] } : input_shown(x)],
  ["zoom", (x) => ({ head: msg_show(x.id, x.n) + (x.at === undefined ? "" : " from char " + x.at), blocks: [] })],
  ["date", (x) => ({ head: msg_show(x.id, 1), blocks: [] })],
  ["spawn", (x) => ({ head: tasks_show(x.tasks, x.effort), blocks: (Array.isArray(x.tasks) ? x.tasks : []).flatMap(text_block) })],
  ["tell", (x) => ({ head: String(x.name ?? ""), blocks: text_block(x.message) })],
  ["computer", (x) => ({ head: "", blocks: text_block(x.task) })]
]);
function report_read(text) {
  const m = /^\[([^\]\n]+)\]\s*([\s\S]*?)(?:\s*Full chat: zoom\("[^"\n]*"\))?\s*$/.exec(text);
  return m === null ? null : { name: m[1], text: m[2] };
}
function call_parse(text) {
  const m = CALL.exec(text);
  const input = m === null ? null : input_parse(m[2]);
  if (m === null || input === null) {
    return { name: "", head: text, device: "", blocks: [] };
  }
  const name = m[1].replace(MCP, "");
  const { device, ...rest } = input;
  const shown = (READS2.get(name) ?? input_shown)(rest);
  return { name, device: typeof device === "string" ? device : "", ...shown };
}
function call_line(c) {
  const blocks = c.blocks.map((b) => (b.k === "" ? "" : b.k + ": ") + b.x);
  const where = c.device === "" ? [] : ["· " + c.device];
  return [c.head, ...blocks, ...where].join(" ").replace(/\s+/g, " ").trim();
}
function call_text(c) {
  return [(c.name + " " + c.head).trim(), ...c.blocks.map((b) => b.x)].join(`
`);
}
function input_shown(input) {
  const keys = Object.keys(input);
  const args = [];
  const blocks = [];
  for (const k of keys) {
    const v = input[k];
    const json = JSON.stringify(v);
    const word = typeof v !== "string" || /^[^\s"\\]*$/.test(v);
    if (json.length <= SHORT && word) {
      args.push(json);
    } else {
      const x = typeof v === "string" ? v : JSON.stringify(v, null, 2);
      blocks.push({ $: "Code", k: keys.length > 1 ? k : "", x });
    }
  }
  return { head: args.join(" "), blocks };
}
function text_block(x) {
  return typeof x === "string" && x !== "" ? [{ $: "Code", k: "", x: x.replace(/\n$/, "") }] : [];
}
function msg_show(id, n) {
  const many = typeof n === "number" && n > 1 ? "+" + n : "";
  return typeof id === "number" ? "#" + id + many : String(id ?? "");
}
function tasks_show(tasks, effort) {
  const n = Array.isArray(tasks) ? tasks.length : 0;
  return n + (n === 1 ? " agent" : " agents") + (typeof effort === "string" ? " · " + effort : "");
}
function lines_show(offset, limit) {
  const from = typeof offset === "number" ? offset : 1;
  const to = typeof limit === "number" ? String(from + limit - 1) : "";
  return offset === undefined && limit === undefined ? "" : ":" + from + "-" + to;
}
function edits_files(edits) {
  const paths = edits.map((e) => e?.path).filter((p) => typeof p === "string");
  return [...new Set(paths)].join(", ");
}
function input_parse(text) {
  const shut = [];
  let quote = false;
  let esc = false;
  let field = 0;
  for (let i = 0;i < text.length; i++) {
    const c = text[i];
    if (quote) {
      quote = esc || c !== '"';
      esc = !esc && c === "\\";
    } else if (c === '"') {
      quote = true;
    } else if (c === "{" || c === "[") {
      shut.push(c === "{" ? "}" : "]");
      field = shut.length === 1 ? i + 1 : field;
    } else if (c === "}" || c === "]") {
      shut.pop();
    } else if (c === "," && shut.length === 1) {
      field = i;
    }
  }
  const open2 = quote ? (esc ? text.slice(0, -1) : text) + '"' : text;
  const full = open2.replace(/[\s,]*$/, "") + shut.reverse().join("");
  return object_parse(full) ?? object_parse(text.slice(0, field) + "}");
}
function object_parse(text) {
  try {
    const x = JSON.parse(text);
    return typeof x === "object" && x !== null && !Array.isArray(x) ? x : null;
  } catch {
    return null;
  }
}

// Names.ts
var ADJS = `
red blue green yellow orange purple pink brown black white gray silver golden
amber azure bronze copper jade lemon lime mint navy peach plum ruby violet
cherry honey big small tiny huge giant little tall short long round flat thick
thin deep soft hard smooth rough fuzzy fluffy shiny crunchy crispy leafy spiky
hot cold warm cool icy frosty snowy rainy sunny cloudy windy stormy foggy
misty sweet sour salty spicy juicy minty nutty creamy smoky tasty fresh bright
dark quiet loud happy jolly merry calm brave bold clever wise kind gentle
lucky proud quick swift fast slow eager busy sleepy silly funny shy neat noble
grand royal mighty strong steady nimble lively cozy old new young ancient
wooden stone paper iron magic cosmic lunar solar polar wild
`.split(/\s+/).filter(Boolean);
var NOUNS = `
ant bat bear bee beetle bird bison camel cat cheetah chicken clam cobra cougar
cow crab crane crow deer dog dolphin donkey dove dragon duck eagle eel elk
falcon finch fish flamingo fox frog gazelle gecko giraffe goat goose gorilla
hamster hare hawk hedgehog heron hippo horse hyena iguana jaguar jay kangaroo
kitten koala lamb lemur leopard lion lizard llama lobster moose moth mouse
mule octopus orca otter owl ox oyster panda parrot pelican penguin pig pigeon
pony puffin puma rabbit raccoon raven rhino robin salmon seal shark sheep
shrimp skunk sloth snail snake sparrow spider squid squirrel swan tiger toad
toucan trout tuna turkey turtle walrus wasp whale wolf wombat yak zebra apple
banana bagel cookie mango melon muffin noodle pancake pepper potato pretzel
radish taco waffle
`.split(/\s+/).filter(Boolean);
var NAME = "(?:" + ADJS.map(name_word).join("|") + ")-?(?:" + NOUNS.map(name_word).join("|") + ")";
function name_word(word) {
  return word[0].toUpperCase() + word.slice(1);
}

// Md.ts
var NAME2 = new RegExp("\\[(" + NAME + ")\\]", "g");
var SPAN = new RegExp([
  /`([^`\n]+)`/.source,
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/(?!\/)[^\s)]*)\)/.source,
  NAME2.source,
  /\*\*([^*\n]+)\*\*/.source,
  /(?<![*\w])\*([^*\s][^*\n]*?)\*(?![\w*])/.source,
  /(?<![^\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/.source
].join("|"), "g");
var LIST = /^\s*([-*+]|\d+[.)])\s+/;
var MORE = /^\s{2,}\S/;
var FENCE = /^\s*```/;
var HEAD = /^(#{1,6})\s+(.*)$/;
var RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
var QUOT = /^\s*>\s?/;
var ROW = /^\s*\|.*\|\s*$/;
var BAR = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
var NEW = /^\+\+\+ (.*)$/;
var READ = /^\[(lines (\d+)-\d+ of \d+[^\]]*)\]$/;
var HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
function Text(x) {
  return { $: "Text", x };
}
function Name(x) {
  return { $: "Name", x };
}
function spans_by(s, re, mark) {
  const out = [];
  let at = 0;
  for (const m of s.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) {
      out.push(Text(s.slice(at, i)));
    }
    out.push(mark(m));
    at = i + m[0].length;
  }
  if (at < s.length) {
    out.push(Text(s.slice(at)));
  }
  return out;
}
function span_parse(s) {
  return spans_by(s, SPAN, span_mark);
}
function span_mark(m) {
  if (m[1] !== undefined) {
    return { $: "Code", x: m[1] };
  }
  if (m[2] !== undefined) {
    return { $: "Link", x: m[2], k: m[3] };
  }
  if (m[4] !== undefined) {
    return Name(m[4]);
  }
  if (m[5] !== undefined) {
    return { $: "Bold", x: m[5] };
  }
  if (m[6] !== undefined) {
    return { $: "Ital", x: m[6] };
  }
  return { $: "Link", x: m[7], k: m[7] };
}
function md_flat(s) {
  return span_parse(s).map((span) => span.x).join("");
}
function md_plain(s) {
  const paras = s.replace(/\r/g, "").split(/\n(?:[ \t]*\n)+/);
  const kept = paras.filter((p) => p.trim() !== "");
  return kept.map((p) => ({ $: "Para", x: p.split(`
`).map(plain_line) }));
}
function plain_line(s) {
  return spans_by(s, NAME2, (m) => Name(m[1]));
}
function md_output(s) {
  const lines = s.replace(/\r/g, "").split(`
`);
  const read = READ.exec(lines[lines.length - 1]);
  if (read !== null) {
    return [{ $: "File", k: read[1], n: Number(read[2]), x: lines.slice(0, -1) }];
  }
  const out = [];
  let [i, at] = [0, 0];
  while (i < lines.length) {
    const [diff, next] = diff_parse(lines, i);
    if (diff !== null) {
      out.push(...output_lines(lines.slice(at, i)), diff);
      at = next;
    }
    i = next;
  }
  return [...out, ...output_lines(lines.slice(at))];
}
function output_lines(lines) {
  const from = lines.findIndex((l) => l.trim() !== "");
  const upto = lines.findLastIndex((l) => l.trim() !== "");
  return from < 0 ? [] : [{ $: "File", k: "result", n: 1, x: lines.slice(from, upto + 1) }];
}
function diff_parse(lines, i) {
  const file = NEW.exec(lines[i + 1] ?? "");
  const hunks = [];
  if (file === null || !lines[i].startsWith("--- ")) {
    return [null, i + 1];
  }
  let j = i + 2;
  for (let h = HUNK.exec(lines[j] ?? "");h !== null; h = HUNK.exec(lines[j] ?? "")) {
    const [hunk, next] = hunk_parse(lines, j + 1, h);
    if (hunk === null) {
      return [null, i + 1];
    }
    hunks.push(hunk);
    j = next;
  }
  return hunks.length === 0 ? [null, i + 1] : [{ $: "Diff", k: file[1], x: hunks }, j];
}
function hunk_parse(lines, j, h) {
  let [olds, news] = [Number(h[2] ?? 1), Number(h[4] ?? 1)];
  let [o, n] = [Number(h[1]), Number(h[3])];
  const out = [];
  for (;olds > 0 || news > 0; j++) {
    const s = lines[j]?.[0];
    const x = lines[j]?.slice(1) ?? "";
    if (s === " " && olds > 0 && news > 0) {
      out.push({ s, n: n++, x });
      [o, olds, news] = [o + 1, olds - 1, news - 1];
    } else if (s === "-" && olds > 0) {
      out.push({ s, n: o++, x });
      olds--;
    } else if (s === "+" && news > 0) {
      out.push({ s, n: n++, x });
      news--;
    } else if (s !== "\\") {
      return [null, j];
    }
  }
  return [out, j];
}
function md_parse(src) {
  const lines = src.replace(/\r/g, "").split(`
`);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const [block, next] = block_parse(lines, i);
    if (block !== null) {
      out.push(block);
    }
    i = next;
  }
  return out;
}
function block_parse(lines, i) {
  const line = lines[i];
  const head = HEAD.exec(line);
  const numbered = list_numbered(line);
  const runs = (test) => lines_run(lines, i, test);
  if (line.trim() === "") {
    return [null, i + 1];
  }
  if (FENCE.test(line)) {
    const end = runs((l) => !FENCE.test(l));
    const k = line.trim().slice(3).trim();
    const x = lines.slice(i + 1, end).join(`
`);
    return [{ $: "Code", k, x }, end + 1];
  }
  if (head !== null) {
    const x = span_parse(head[2]);
    return [{ $: "Head", k: head[1].length, x }, i + 1];
  }
  if (RULE.test(line)) {
    return [{ $: "Rule" }, i + 1];
  }
  if (QUOT.test(line)) {
    const end = runs((l) => QUOT.test(l));
    const body = lines.slice(i, end).map((l) => l.replace(QUOT, ""));
    return [{ $: "Quot", x: md_parse(body.join(`
`)) }, end];
  }
  if (numbered !== null) {
    const item = (l) => list_numbered(l) === numbered;
    const end = runs((l) => item(l) || MORE.test(l));
    const items = [];
    for (const l of lines.slice(i, end)) {
      if (item(l)) {
        items.push(l.replace(LIST, ""));
      } else {
        items[items.length - 1] += " " + l.trim();
      }
    }
    return [{ $: "List", k: numbered, x: items.map(span_parse) }, end];
  }
  if (ROW.test(line) && BAR.test(lines[i + 1] ?? "")) {
    const end = lines_run(lines, i + 1, (l) => ROW.test(l));
    const rows = [line, ...lines.slice(i + 2, end)];
    return [{ $: "Tabl", x: rows.map(row_cells) }, end];
  }
  const end = runs((l, j) => l.trim() !== "" && !block_starts(lines, j));
  const x = lines.slice(i, end).map(span_parse);
  return [{ $: "Para", x }, end];
}
function lines_run(lines, i, test) {
  let j = i + 1;
  while (j < lines.length && test(lines[j], j)) {
    j++;
  }
  return j;
}
function block_starts(lines, j) {
  const l = lines[j];
  return FENCE.test(l) || HEAD.test(l) || RULE.test(l) || QUOT.test(l) || LIST.test(l) || ROW.test(l) && BAR.test(lines[j + 1] ?? "");
}
function list_numbered(l) {
  const m = LIST.exec(l);
  return m === null ? null : /\d/.test(m[1]);
}
function row_cells(line) {
  const cells = line.trim().replace(/^\||(?<!\\)\|$/g, "").split(/(?<!\\)\|/);
  return cells.map((c) => span_parse(c.trim().replace(/\\\|/g, "|")));
}

// Pick.ts
var OPUS = { label: "opus-5.5", id: "claude-opus-5-5", speeds: ["slow", "fast"] };
var SONNET = { label: "sonnet-5.5", id: "claude-sonnet-5-5", speeds: ["slow"] };
var HAIKU = { label: "haiku-5.5", id: "claude-haiku-5-5", speeds: ["slow"] };
var OPENAI = [
  { label: "gpt-6-luna", id: "gpt-6-luna", speeds: ["slow", "fast"] },
  { label: "gpt-6.1-sol", id: "gpt-6.1-sol", speeds: ["slow", "fast"] },
  { label: "gpt-6-astra", id: "gpt-6-astra", speeds: ["slow", "fast", "ultrafast"] }
];
var MODELS = {
  "claude-api": [OPUS, SONNET, HAIKU],
  "openai-api": OPENAI
};
var EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var SPEEDS = ["slow", "fast", "ultrafast"];
var LABELS = [...new Set(Object.values(MODELS).flat().map((m) => m.label))];
var Pick;
((Pick2) => {
  function model(vendor, label) {
    return MODELS[vendor].find((m) => m.label === label);
  }
  Pick2.model = model;
  function on(pick, vendor, model) {
    const below = SPEEDS.slice(0, SPEEDS.indexOf(pick.speed) + 1);
    const speed = below.filter((s) => model.speeds.includes(s)).pop() ?? "slow";
    return { ...pick, vendor, model: model.label, speed };
  }
  Pick2.on = on;
  function models(vendors, labels) {
    return vendors.flatMap((v) => MODELS[v].filter((m) => labels.includes(m.label)).map((m) => [v, m]));
  }
  Pick2.models = models;
  function options(pick, move, { vendors, models }) {
    const speeds = Pick.model(pick.vendor, pick.model)?.speeds ?? [];
    const all = (vs) => Pick.models(vs, models).map(([v, m]) => [m.label, Pick.on(pick, v, m)]);
    switch (move) {
      case "next":
      case "prev":
      case "model": {
        return all(vendors);
      }
      case "up":
      case "down":
      case "effort": {
        return EFFORTS.map((effort) => [effort, { ...pick, effort }]);
      }
      case "speed": {
        return speeds.map((speed) => [speed, { ...pick, speed }]);
      }
    }
  }
  Pick2.options = options;
  function move(pick, move, offer, to) {
    const list = Pick.options(pick, move, offer);
    const n = list.length;
    const at = list.findIndex(([, p]) => Pick.label(p) === Pick.label(pick));
    const d = move === "prev" || move === "down" ? -1 : 1;
    const ends = move === "up" || move === "down";
    const next = ends ? Math.max(0, Math.min(n - 1, at + d)) : (at + d + n) % n;
    const like = list.filter(([part]) => part.toLowerCase().includes(String(to).toLowerCase()));
    const hit = to === undefined ? list[next] : list.find(([part]) => part === to) ?? (like.length === 1 ? like[0] : undefined);
    return hit === undefined ? null : hit[1];
  }
  Pick2.move = move;
  function label(pick) {
    return [pick.vendor, pick.model, pick.effort, pick.speed].join(":");
  }
  Pick2.label = label;
  function ask(pick) {
    const model = Pick.model(pick.vendor, pick.model);
    return { ...pick, model: model?.id ?? pick.model };
  }
  Pick2.ask = ask;
  function read(x, offer) {
    const model = offer.vendors.includes(x.vendor) && offer.models.includes(x.model) ? Pick.model(x.vendor, x.model) : undefined;
    if (model === undefined || !EFFORTS.includes(x.effort) || !model.speeds.includes(x.speed)) {
      return null;
    }
    return { vendor: x.vendor, model: x.model, effort: x.effort, speed: x.speed };
  }
  Pick2.read = read;
  function load(saved, offer, def) {
    return Pick.read(saved ?? def, offer) ?? def;
  }
  Pick2.load = load;
})(Pick ||= {});

// Price.ts
var SEARCH = 0.01;
var RATES = {
  "claude-opus-5-5": { input: 4, write: 5, read: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, write: 2.5, read: 0.1, output: 10 },
  "claude-haiku-5-5": { input: 0.1, write: 0.125, read: 0.01, output: 0.5 },
  "gpt-6-astra": { input: 10, write: 12.5, read: 1, output: 50 },
  "gpt-6.1-sol": { input: 2, write: 2, read: 0.1, output: 10 },
  "gpt-6-luna": { input: 0.1, write: 0.1, read: 0.01, output: 0.5 }
};
var PROMPT = 1e5;
var LONG = {
  "claude-haiku-5-5": { input: 0.5, write: 0.625, read: 0.05, output: 2.5 }
};
var MINUTES = {
  "gpt-transcribe": 0.0045
};
var SPEEDS2 = { slow: 1, fast: 2, ultrafast: 6 };
var Price;
((Price2) => {
  function usage(speed) {
    return { input: 0, write: 0, read: 0, output: 0, searches: 0, seconds: 0, speed };
  }
  Price2.usage = usage;
  function rate(model) {
    return RATES[model];
  }
  Price2.rate = rate;
  function times(speed) {
    return SPEEDS2[speed] ?? 1;
  }
  Price2.times = times;
  function cost(model, use) {
    const long = use.input + use.write + use.read > PROMPT ? LONG[model] : undefined;
    const rate = long ?? RATES[model];
    const minute = MINUTES[model];
    if (rate === undefined && minute === undefined) {
      throw new Error("no price for " + model);
    }
    const tokens = rate === undefined ? 0 : use.input * rate.input + use.write * rate.write + use.read * rate.read + use.output * rate.output;
    const audio = minute === undefined ? 0 : use.seconds / 60 * minute * 1e6;
    return Math.ceil(tokens * Price.times(use.speed) + use.searches * SEARCH * 1e6 + audio);
  }
  Price2.cost = cost;
})(Price ||= {});

// View.ts
var BROKE = "out of credit";
var PACE = 0.0001;
var email_ask = (github) => "First, what's your email" + (github ? " or @github" : "") + "? I'll send you a quick sign-up link.";
var OPENING = 3;
var SUMMARIES = "summaries";
var MAIN = "Legion";
var TURN = "Unii's turn";
var WIRE = 2;
var PING = 1e4;
var RETRY = 1000;
var TICK = "+";
var MOVE = 4001;
var FRAME = 2 ** 22;
var HINT = "Message Legion";
var AI = "Unii is an AI, not a person, and can make mistakes.";
var NOTICE = 3 * 60 * 60 * 1000;
var WAIT = "compressing…";
var SUMS = "compressing earlier messages…";
var UNSENT = "Sends once connected.";
var TOOL2 = "tool: ";
var FOLD = "The whole chat, folded into the fewest blocks.";
var TOPUP = ["#", "Date", "Credit", "Paid", "Left", ""];
var SERVED = {
  chat: ["reply", "replies"],
  compactor: ["summary", "summaries"],
  import: ["import summary", "import summaries"],
  voice: ["voice note", "voice notes"],
  agent: ["agent step", "agent steps"],
  computer: ["computer step", "computer steps"],
  earlier: ["earlier use", "earlier uses"]
};
function Cap(text) {
  return { $: "Cap", text };
}
var CREW = { asking: "?", failed: "✗", working: "●", waiting: "◐", stopped: "■", done: "✓" };
var STATUSES2 = ["asking", "failed", "working", "waiting", "stopped", "done"];
var ALERT_GAP = 20000;
function view_new() {
  return {
    busy: false,
    wait: "",
    agents: [],
    crew: [],
    pick: null,
    vendors: [],
    models: LABELS,
    bills: false,
    credits: null,
    importing: null,
    parts: [],
    turn: Infinity,
    fold: null,
    nodes: new Map,
    whole: new Map,
    open: new Map,
    live: [],
    minds: new Map,
    pages: new Map,
    page: null,
    expanded: new Set,
    pulses: new Map,
    heard: null,
    alerted: new Map,
    notes: [],
    tab: crypto.randomUUID(),
    out: [],
    ws: null,
    up: false,
    flush: () => {}
  };
}
function view_hear(v, msg) {
  switch (msg.$) {
    case "know": {
      view_learn(v, msg);
      return [];
    }
    case "view": {
      v.parts = msg.parts;
      v.turn = msg.turn;
      return v.fold === null ? [] : [{ $: "root" }];
    }
    case "zoom":
    case "jobs":
    case "job": {
      return [];
    }
    case "root": {
      v.fold = v.fold === null ? null : msg.parts;
      return [];
    }
    case "entry": {
      view_entry(v, msg);
      return [];
    }
    case "delta": {
      const live = view_live(v, msg.agent);
      if (live !== null) {
        live_push(live, msg.kind, msg.text, msg.fresh);
      }
      return [];
    }
    case "live": {
      const live = view_live(v, msg.agent);
      if (live !== null) {
        live_set(live, msg.live);
      }
      return [];
    }
    case "state": {
      const { $, ...state } = msg;
      Object.assign(v, state, { crew: state.crew ?? [] });
      return [];
    }
    case "agent": {
      const page = v.pages.get(msg.name);
      if (page === undefined) {
        return [];
      }
      if (msg.found) {
        page.log = [];
        return [];
      }
      v.pages.delete(msg.name);
      if (v.page === page) {
        v.page = null;
      }
      v.notes.push("No agent " + msg.name + ".");
      return [];
    }
    case "note": {
      v.notes.push(msg.text);
      return [];
    }
    case "pulse": {
      v.pulses.set(msg.name, msg);
      return [];
    }
    case "ack": {
      const post = v.out.find((p) => p.msg.id === msg.id);
      v.out = v.out.filter((p) => p !== post);
      post?.done(msg);
      return [];
    }
    default: {
      return [];
    }
  }
}
function view_act(v, act) {
  switch (act.$) {
    case "Send": {
      const text = act.text.trim();
      const images = act.images ?? [];
      const word = /^\/[a-z]+(?=\s|$)/i.exec(text)?.[0];
      const goal = word === "/goal" ? text.slice(word.length).trim() : null;
      if (!view_typing(v)) {
        return [];
      }
      if (text.startsWith("!")) {
        const command = text.slice(1).trim();
        v.notes.push(...command === "" ? ["! needs a command: !<command>, run with the shell on a device."] : []);
        return command === "" ? [] : [{ $: "bang", command }];
      }
      if (v.page !== null) {
        return text === "" ? [] : [{ $: "tell", name: v.page.name, text }];
      }
      if (text === "" && images.length === 0) {
        return v.busy ? [{ $: "stop", name: TURN }] : [];
      }
      if (word === "/halt") {
        return [{ $: "goal", text: null }];
      }
      if (word === "/agent") {
        const task = text.slice(word.length).trim();
        v.notes.push(...task === "" ? ["/agent needs a task: /agent <task>."] : []);
        return task === "" ? [] : [{ $: "spawn", task }];
      }
      if (goal === "") {
        v.notes.push("/goal needs one: /goal <message>.");
        return [];
      }
      if (word !== undefined && goal === null) {
        v.notes.push(word + " is no command; nothing was sent. The terminal's /help lists its commands; the site's are in its ☰ menu.");
        return [];
      }
      const blob = new Blob([...images, text]);
      const say = { $: "say", sizes: images.map((b) => b.size), body: () => blob };
      v.fold = null;
      return goal === null ? [say] : [{ $: "goal", text: goal }, say];
    }
    case "Move": {
      const from = v.out.flatMap((p) => p.msg.$ === "pick" ? [p.msg.to] : []).at(-1) ?? v.pick;
      if (from === null) {
        return [];
      }
      const to = Pick.move(from, act.move, v, act.to);
      if (act.move === "speed" && Pick.options(from, "speed", v).length === 1) {
        v.notes.push(from.model + " has no fast.");
        return [];
      }
      if (to === null) {
        const parts = Pick.options(from, act.move, v).map(([part]) => part);
        v.notes.push("No " + [act.move, act.to].join(" ").trim() + "; one of: " + [...new Set(parts)].join(", ") + ".");
        return [];
      }
      return [{ $: "pick", to }];
    }
    case "Open": {
      v.open.set(act.id + "+" + act.n, true);
      return act.n === 1 ? [] : [{ $: "zoom", part: [act.id, act.n] }];
    }
    case "Shut": {
      v.open.set(act.id + "+" + act.n, false);
      return [];
    }
    case "Fold": {
      v.open.clear();
      v.fold = act.on ? [] : null;
      return act.on ? [{ $: "root" }] : [];
    }
    case "Dismiss": {
      return [{ $: "dismiss", name: act.name }];
    }
    case "Approve": {
      return [{ $: "approve", name: act.name, yes: act.yes }];
    }
    case "Stop": {
      return [{ $: "stop", name: act.name }];
    }
    case "Tell": {
      const text = act.text.trim();
      return text === "" ? [] : [{ $: "tell", name: act.name, text }];
    }
    case "Answer": {
      const text = act.text.trim();
      return text === "" ? [] : [{ $: "answer", q: act.q, text }];
    }
    case "Drop": {
      return [{ $: "answer", q: act.q }];
    }
    case "Mode": {
      return [{ $: "mode", mode: act.mode ?? Modes.next(Modes.read(v.mode)) }];
    }
    case "Verdict": {
      const text = (act.text ?? "").trim();
      return [{ $: "plan", yes: act.yes, ...act.mode === undefined ? {} : { mode: act.mode }, ...text === "" ? {} : { text } }];
    }
    case "Consent": {
      return [{ $: "consent", n: act.n, yes: act.yes }];
    }
    case "Expand": {
      if (!v.expanded.delete(act.name)) {
        v.expanded.add(act.name);
      }
      return [];
    }
    case "Goto": {
      if (act.name === null) {
        v.page = null;
        return [];
      }
      const known = v.pages.get(act.name);
      v.page = known ?? { name: act.name, log: null, live: [] };
      v.pages.set(act.name, v.page);
      return known === undefined ? [{ $: "agent", name: act.name }] : [];
    }
  }
}
function view_body(v) {
  if (v.page !== null) {
    return page_rows(v, v.page);
  }
  if (v.fold !== null) {
    const tops = v.fold.flatMap(([id, n]) => part_rows(v, id, n, Infinity, false));
    return [Cap(FOLD), ...tops];
  }
  return [Cap(AI), ...view_rows(v, v.parts).flat()];
}
function view_rows(v, parts) {
  return parts.map(([id, n], k) => {
    const rows = part_rows(v, id, n, v.turn, true);
    return part_due(v, [id, n], parts[k - 1]) ? [Cap(AI), ...rows] : rows;
  });
}
function view_tail(v, live = view_stream(v)) {
  if (v.page === null && v.fold !== null) {
    return [];
  }
  const rows = live.flatMap((l) => entry_rows(null, l.kind, l.text));
  const load = v.page === null && v.importing !== null ? [Cap(progress_show(v, v.importing))] : [];
  const said = v.page === null && !v.up ? v.out.flatMap((p) => entry_rows(null, "user", p.said)) : [];
  const kept = said.length > 0 ? [...said, Cap(UNSENT)] : [];
  if (v.page !== null || rows.length > 0 || v.wait === "") {
    return [...rows, ...kept, ...load];
  }
  return [Cap(v.wait === SUMMARIES ? SUMS : "waiting for " + v.wait + "…"), ...kept, ...load];
}
function view_stream(v) {
  return v.page === null ? v.live : v.page.live;
}
function progress_show(v, p) {
  const n = (k) => k.toLocaleString("en-US");
  const merges = p.open.reduce((x, y) => x + y, 0);
  const phase = p.open[0] > 0 ? "Summarizing messages: " + n(p.msgs - p.open[0]) + " of " + n(p.msgs) : "Merging the top of the tree: " + merges + (merges === 1 ? " merge" : " merges") + " left · about " + Math.ceil((p.total - p.done) * PACE) + " min";
  const why = p.why === null ? "" : p.why === BROKE ? " · waiting for credit: add $" + progress_need(p, v.credits) + " and it goes on by itself" : " · paused";
  const usd = v.bills ? " · $" + p.spent.toFixed(2) + " spent, estimated $" + p.left.toFixed(2) + " left" : "";
  return phase + usd + why;
}
function progress_need(p, credits) {
  return Math.max(5, topup(p.left, credits ?? 0));
}
function view_tabs(v) {
  const at = v.page === null ? null : v.page.name;
  const known = v.crew.length > 0 ? view_crew(v, 0).map((r) => r.name) : v.agents;
  const names = at === null || known.includes(at) ? known : [...known, at];
  return [null, ...names].map((name) => {
    const here = name === at;
    const text = (here ? GLYPH.here : GLYPH.tab) + " " + (name ?? MAIN);
    return { name, here, text };
  });
}
function view_fold(v) {
  if (v.page !== null) {
    return null;
  }
  return v.fold === null ? "fold all" : "unfold all";
}
function view_typing(_v) {
  return true;
}
function view_crew(v, now) {
  const known = new Set(v.crew.map((c) => c.name));
  const kids = (parent) => v.crew.filter((c) => c.parent === parent || parent === "main" && !known.has(c.parent)).filter((c) => c.name !== parent).sort((a, b) => STATUSES2.indexOf(a.status) - STATUSES2.indexOf(b.status) || b.since - a.since);
  const rows = [];
  const add = (parent, depth) => {
    for (const c of kids(parent)) {
      if (rows.length < v.crew.length && !rows.some((r) => r.name === c.name)) {
        rows.push({ ...c, depth, text: "  ".repeat(depth) + CREW[c.status] + " " + view_label(c) + " · " + c.tier + " · " + c.model + " · " + ago(now - c.since) });
        add(c.name, depth + 1);
      }
    }
  };
  add("main", 0);
  return rows;
}
function view_todo(c, step = false) {
  const list = c.todo ?? [];
  if (list.length === 0) {
    return "";
  }
  const done = list.filter((x) => x.status === "done").length + "/" + list.length;
  const doing = list.find((x) => x.status === "doing")?.text;
  return step && doing !== undefined ? done + ": " + doing : done;
}
function view_label(c) {
  const repos = c.repos === undefined || c.repos.length === 0 ? "" : " [" + c.repos.join(", ") + "]";
  return (c.title === undefined ? c.name : c.title + " (" + c.name + ")") + repos;
}
function view_alerts(v, now) {
  const was = v.heard;
  v.heard = { busy: v.busy, status: new Map(v.crew.map((c) => [c.name, c.status])) };
  if (was === null) {
    return [];
  }
  const fresh = (status) => v.crew.filter((c) => c.status === status && was.status.get(c.name) !== status);
  const asks = fresh("asking").map((c) => ({ key: c.name + " asks", title: c.name + " asks to start", body: "Claude Code: /approve or /deny it (on its page, the site's ✓ or ×).", name: c.name }));
  const failed = [...asks, ...fresh("failed").map((c) => ({ key: c.name + " failed", title: c.name + " failed", body: c.tier + " · " + c.model + ": open it to see why.", name: c.name }))];
  const ended = was.busy && !v.busy ? [{ key: "turn", title: MAIN + " answered", body: "Its turn ended: your move.", name: null }] : [];
  const asked = view_questions(v).map((q) => ({ key: "question " + q.id, title: MAIN + " asks", body: q.text.split(`
`)[0].slice(0, 200), name: null }));
  const plan = v.plan ? [{ key: "plan " + v.plan.date, title: "Plan ready", body: MAIN + "'s plan waits for your approval (/plan).", name: null }] : [];
  const calls = (v.calls ?? []).map((c) => ({ key: "call " + c.id + " " + c.what, title: c.who + " wants to run a command", body: c.what.slice(0, 200) + ": /allow " + c.id + " or /refuse " + c.id + ".", name: null }));
  const once = [...asked, ...plan, ...calls].filter((a) => !v.alerted.has(a.key));
  once.forEach((a) => v.alerted.set(a.key, now));
  return [...failed, ...ended].filter((a) => {
    const due = now - (v.alerted.get(a.key) ?? -Infinity) >= ALERT_GAP;
    if (due) {
      v.alerted.set(a.key, now);
    }
    return due;
  }).concat(once);
}
function view_tree(v, now) {
  const rows = view_crew(v, now);
  const up = new Map(v.crew.map((c) => [c.name, c.parent]));
  const focus = new Set;
  for (let at = up.get(v.page?.name ?? ""), k = 0;at !== undefined && k < rows.length; k++) {
    focus.add(at);
    at = up.get(at);
  }
  const out = [];
  let shut = Infinity;
  rows.forEach((r, i) => {
    if (r.depth > shut) {
      return;
    }
    shut = Infinity;
    const end = rows.findIndex((s, j) => j > i && s.depth <= r.depth);
    const under = rows.slice(i + 1, end < 0 ? rows.length : end);
    const open2 = under.length > 0 && (v.expanded.has(r.name) || focus.has(r.name));
    out.push({ ...r, kids: under.length, rollup: rollup(under), open: open2 });
    if (under.length > 0 && !open2) {
      shut = r.depth;
    }
  });
  return out;
}
var ROLLUP = ["working", "waiting", "asking", "failed", "stopped", "done"];
function rollup(crew) {
  return ROLLUP.map((s) => [s, crew.filter((c) => c.status === s).length]).filter(([, n]) => n > 0).map(([s, n]) => n + " " + s).join(", ");
}
var STALL = 120000;
var LANE = { user: "told", tool: "tool", unii: "words", work: "words", note: "note", echo: "note" };
function view_lane(v, now) {
  const page = v.page;
  if (page === null) {
    return [];
  }
  const line = (text) => text.split(`
`).map((l) => l.trim()).filter((l) => l !== "").at(-1)?.slice(0, 120) ?? "";
  const said = (page.log ?? []).flatMap((e, k) => {
    const t = Date.parse(e.date ?? "");
    const kind = LANE[e.kind];
    return kind === undefined || Number.isNaN(t) ? [] : [{ k, at: 0, kind, label: line(e.text), t }];
  });
  const kids = v.crew.filter((c) => c.parent === page.name).map((c) => ({ k: null, at: 0, kind: "spawn", label: "started " + c.name, t: c.since }));
  const marks = [...said, ...kids].sort((a, b) => a.t - b.t);
  if (marks.length === 0) {
    return [];
  }
  const busy = v.crew.some((c) => c.name === page.name && (c.status === "working" || c.status === "waiting"));
  const end = busy ? Math.max(now, marks[marks.length - 1].t) : marks[marks.length - 1].t;
  const quiet = (a, b) => b - a > STALL ? [{ k: null, at: 0, kind: "stall", label: "quiet " + ago(b - a), t: (a + b) / 2 }] : [];
  const all = marks.flatMap((m, i) => i === 0 ? [m] : [...quiet(marks[i - 1].t, m.t), m]);
  const tail = busy && end - marks[marks.length - 1].t > STALL ? [{ k: null, at: 0, kind: "stall", label: "quiet " + ago(end - marks[marks.length - 1].t), t: end }] : [];
  const t0 = marks[0].t;
  return [...all, ...tail].map((m) => ({ ...m, at: end === t0 ? 0 : (m.t - t0) / (end - t0) }));
}
var WATCH = 16;
function view_watch(v, tiles = []) {
  return [...new Set([...v.page === null ? [] : [v.page.name], ...tiles])].slice(0, WATCH);
}
function view_tiles(v, now) {
  const rows = view_crew(v, now);
  return rows.flatMap((r, i) => {
    if (r.depth > 0) {
      return [];
    }
    const end = rows.findIndex((s, j) => j > i && s.depth === 0);
    const under = rows.slice(i + 1, end < 0 ? rows.length : end);
    const { depth, text, ...crew } = r;
    return [{ ...crew, dots: under.map((u) => ({ name: u.name, status: u.status })), rollup: rollup(under) }];
  });
}
function view_needs(v) {
  return [...v.crew.filter((c) => c.status === "asking"), ...v.crew.filter((c) => c.status === "failed")];
}
function view_pill(v) {
  const asked = view_questions(v).length + view_waiting(v);
  if (v.crew.length === 0) {
    return asked > 0 ? asked + " need you" : "";
  }
  const need = view_needs(v).length + asked;
  return v.crew.filter((c) => c.status === "working").length + " working" + (need > 0 ? ", " + need + " need you" : "");
}
function status_text(s) {
  const usd = (n) => n < 0.01 ? "$" + n.toFixed(4) : "$" + n.toFixed(2);
  return [
    ...s.up ? [] : ["offline"],
    s.dir + (s.branch === null ? "" : " ⎇ " + s.branch),
    s.model,
    ...s.working === 0 ? [] : [s.working + (s.working === 1 ? " agent" : " agents") + " at work"],
    ...s.spend.spend === null ? [] : [usd(s.spend.spend) + (s.spend.stale ? "*" : "") + " today"],
    ...s.mode === undefined ? [] : [s.mode + " mode"],
    ...!s.waiting ? [] : [s.waiting + " waiting for you"],
    ...!s.questions ? [] : [s.questions + (s.questions === 1 ? " question" : " questions") + " (/questions)"]
  ].join(" · ");
}
function view_status(v) {
  const s = v.status;
  if (s === undefined || s === null) {
    return "";
  }
  const spend = { spend: s.spend, stale: s.stale };
  return s.device + ": " + status_text({ up: v.up, dir: s.dir, branch: s.branch, model: v.pick?.model ?? "?", working: v.agents.length, spend, questions: view_questions(v).length, mode: v.mode, waiting: view_waiting(v) });
}
function view_waiting(v) {
  return (v.plan ? 1 : 0) + (v.calls ?? []).length;
}
function view_questions(v) {
  return [...v.questions ?? []].sort((a, b) => a.id - b.id);
}
function view_route(hash) {
  const m = /^#(chat|crew)(?:\/(.+))?$/.exec(hash);
  if (m === null || m[1] === "chat") {
    return { mode: "chat", name: null };
  }
  return { mode: "crew", name: m[2] === undefined ? null : decodeURIComponent(m[2]) };
}
function view_hash(mode, name) {
  return mode === "chat" ? "#chat" : "#crew" + (name === null ? "" : "/" + encodeURIComponent(name));
}
function ago(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : Math.floor(s / 3600) + "h";
}
function view_pick(v) {
  if (v.pick === null) {
    return [];
  }
  const { model, effort, speed } = v.pick;
  const rate = Price.rate(Pick.ask(v.pick).model);
  const price = rate === undefined ? "" : ": $" + rate.input + "/M tokens in, $" + rate.output + "/M out";
  return [
    { text: model, move: "model", hint: model + price },
    { text: effort, move: "effort", hint: effort + " effort: how long it thinks first; more is smarter, slower and costs more" },
    { text: speed, move: "speed", hint: speed + ": ×" + Price.times(speed) + " the price" }
  ];
}
function view_count(v) {
  return v.parts.reduce((end, [id, n]) => Math.max(end, id + n), 0);
}
function view_credits(v) {
  return v.credits === null ? null : usd_show(v.credits);
}
function view_learn(v, pack) {
  for (const [key, node] of Object.entries(pack.nodes ?? {})) {
    v.nodes.set(key, node);
  }
  for (const [id, entry] of Object.entries(pack.whole ?? {})) {
    v.whole.set(Number(id), entry);
  }
}
function view_entry(v, msg) {
  const { $, agent, id, ...entry } = msg;
  const last = v.parts[v.parts.length - 1];
  if (agent !== undefined) {
    const log = v.pages.get(agent)?.log;
    if (Array.isArray(log)) {
      log.push(entry);
    }
  } else if (id !== undefined) {
    v.whole.set(id, entry);
    v.parts.push([id, 1]);
  } else if (msg.kind === "mind" && last !== undefined) {
    const at = last[0] + last[1] - 1;
    v.minds.set(at, [...v.minds.get(at) ?? [], msg.text]);
  }
}
function view_live(v, agent) {
  if (agent === undefined) {
    return v.live;
  }
  return v.pages.get(agent)?.live ?? null;
}
function link_open(v, link) {
  const ws = link.open("?tab=" + v.tab + "&wire=" + WIRE);
  let heard = Date.now();
  const tick = setInterval(() => Date.now() - heard > PING && drop(), PING / 2);
  async function drop(moved = false) {
    const up = v.up;
    ws.onmessage = null;
    ws.onclose = null;
    clearInterval(tick);
    ws.close();
    [v.ws, v.up] = [null, false];
    if (moved || await link.lost(up)) {
      setTimeout(() => link_open(v, link), moved ? 0 : RETRY);
    }
  }
  function flush() {
    for (const post of v.up && v.ws === ws ? v.out.filter((p) => p.ws !== ws) : []) {
      post.ws = ws;
      if ("body" in post.msg) {
        upload(post);
      } else {
        ws.send(JSON.stringify(post.msg));
      }
    }
  }
  async function upload(post) {
    const { body, ...rest } = post.msg;
    const query = Object.entries(rest).map(([k, x]) => k + "=" + encodeURIComponent(String(x)));
    const res = await link.post("/api/act?" + query.join("&"), await body()).catch(() => null);
    const out = await res?.json().catch(() => null);
    if (out != null) {
      link.hear({ $: "ack", id: post.msg.id, ...out });
    } else if (post.ws === ws && v.ws === ws) {
      drop();
    }
  }
  [v.ws, v.flush] = [ws, flush];
  ws.onmessage = (ev) => {
    heard = Date.now();
    if (ev.data === TICK) {
      return;
    }
    const msg = JSON.parse(String(ev.data));
    const join = msg.$ === "view" && !v.up;
    if (join) {
      v.up = true;
      v.pages.clear();
    }
    link.hear(msg);
    if (join) {
      view_act(v, { $: "Goto", name: v.page?.name ?? null }).forEach((out) => link_send(v, out));
      flush();
    }
  };
  ws.onclose = (ev) => drop(ev.code === MOVE);
}
function link_send(v, msg, done = (a) => link_note(v, a), said = "") {
  v.out.push({ msg: { id: crypto.randomUUID(), ...msg }, ws: null, done, said });
  v.flush();
}
function link_note(v, a) {
  if (a.error !== undefined) {
    v.notes.push(a.error);
  }
}
async function post(url, body, auth = {}) {
  const headers = { ...auth, "content-type": "application/json" };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).catch(() => null);
  const out = res === null ? { error: "Can't reach the server." } : await res.json().catch(() => res.ok ? {} : { error: "HTTP " + res.status });
  return { ...out, ok: res?.ok === true, status: res?.status ?? 0 };
}
function part_due(v, part, before) {
  const last = before === undefined ? NaN : part_window(v, before);
  return part[1] === 1 && part[0] >= v.turn && !Number.isNaN(last) && part_window(v, part) !== last;
}
function part_window(v, [id, n]) {
  const date = n === 1 ? v.whole.get(id)?.date : v.nodes.get(id + "+" + n)?.to;
  return Math.floor(Date.parse(date ?? "") / NOTICE);
}
function part_rows(v, id, n, t, talk) {
  const key = id + "+" + n;
  const entry = v.whole.get(id);
  const half = n / 2;
  if (n === 1 && id >= t && entry !== undefined) {
    const minds = v.minds.get(id) ?? [];
    const after = minds.flatMap((x) => entry_rows(null, "mind", x));
    return [...whole_rows(id, entry), ...after];
  }
  const open2 = talk && n === 1 && ["user", "unii"].includes(entry?.kind ?? "");
  if (!(v.open.get(key) ?? open2)) {
    return sum_rows(id, n, v.nodes.get(key));
  }
  const text = n === 1 ? "fold" : GLYPH.open + " " + n + "x · fold";
  if (n > 1) {
    const rows = [...part_rows(v, id, half, t, talk), ...part_rows(v, id + half, half, t, talk)];
    return [{ $: "Box", id, n, text, rows }];
  }
  const rows = entry === undefined ? [] : whole_rows(id, entry);
  return [{ $: "Box", id, n, text, rows }];
}
var ROWS = new WeakMap;
function whole_rows(id, entry) {
  const rows = ROWS.get(entry) ?? entry_rows(id, entry.kind, entry.text, entry.images);
  ROWS.set(entry, rows);
  return rows;
}
function sum_rows(id, n, node = { text: WAIT, to: "" }) {
  const rows = ROWS.get(node) ?? [{ $: "Sum", id, n, text: md_flat(node.text), call: sum_call(n, node.text) }];
  ROWS.set(node, rows);
  return rows;
}
function page_rows(v, page, from = 0) {
  const head = Cap(page.name + (v.agents.includes(page.name) ? " · at work" : " · done"));
  return [head, ...(page.log ?? []).slice(from).flatMap((e) => whole_rows(null, e))];
}
function live_push(live, kind, text, fresh = false) {
  const top = live[live.length - 1];
  if (top !== undefined && top.kind === kind && !fresh) {
    top.text += text;
  } else {
    live.push({ kind, text });
  }
}
function live_set(live, now) {
  const goes = live.every((l, k) => now[k]?.kind === l.kind && now[k].text.startsWith(l.text));
  const held = goes ? live : [];
  const next = now.map((l, k) => k < held.length ? Object.assign(held[k], l) : l);
  live.splice(0, live.length, ...next);
}
function sum_call(n, text) {
  const call = n === 1 && text.startsWith(TOOL2) ? call_parse(text.slice(TOOL2.length)) : null;
  return call === null || call.name === "" ? null : call;
}
function topup_cells(t) {
  const usd = (cents) => usd_show(cents / 100);
  const paid = t.source === "apple" ? "App Store" : usd(t.paid_cents);
  const left = usd(t.left_cents) + (t.status === "paid" ? "" : " · " + t.status);
  const bill = t.receipt_url ? "[Receipt](" + t.receipt_url + ")" : "";
  return ["#" + t.id, day_show(new Date(t.at)), usd(t.credits_cents), paid, left, bill];
}
function account_days(a) {
  const days = new Map;
  for (const s of a.calls ?? []) {
    const date = day_show(new Date(s.at));
    const day = days.get(date) ?? { counts: new Map, micros: 0 };
    const name = SERVED[s.kind] ?? SERVED.earlier;
    day.counts.set(name, (day.counts.get(name) ?? 0) + 1);
    day.micros += s.micros;
    days.set(date, day);
  }
  return [...days].map(([date, day]) => {
    const what = [...day.counts].map(([name, n]) => n + " " + name[n === 1 ? 0 : 1]);
    return { date, what: what.join(", "), usd: day.micros / 1e6 };
  });
}
function day_show(d) {
  const year = d.getFullYear() === new Date().getFullYear() ? undefined : "numeric";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year });
}
function cost_show(usd) {
  return usd > 0 && usd < 0.005 ? "<$0.01" : usd_show(usd);
}
function usd_show(usd) {
  return (usd < 0 ? "-$" : "$") + Math.abs(usd).toFixed(2);
}
function entry_rows(id, kind, text, images = []) {
  const call = kind === "tool" ? call_parse(text) : null;
  const report = kind === "work" ? report_read(text) : null;
  const body = call === null ? entry_body(kind, report?.text ?? text) : [];
  const who = report?.name ?? WHO[kind] ?? "";
  return call === null && body.length === 0 && images.length === 0 ? [] : [{ $: "Msg", id, kind, who, text, body, call, images }];
}
function entry_body(kind, text) {
  switch (kind) {
    case "user":
    case "work": {
      return md_plain(text);
    }
    case "echo": {
      return md_output(text);
    }
    default: {
      return md_parse(text);
    }
  }
}

// web/src/Html.ts
var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
var TALL = 4000;
var SHEETS = `<svg viewBox="0 0 16 16" width="15" height="15"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H4.3A1.8 1.8 0 0 0 2.5 3.3v4.4a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg>`;
var CHECK = `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;
var MARKS = { " ": "", "-": "del", "+": "add" };
function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}
function act_html(act) {
  return ` data-act="${esc(JSON.stringify(act))}"`;
}
function copy_html(text) {
  return `<button class="copy" data-copy="${esc(text)}" title="Copy">${SHEETS}</button>`;
}
var MADE = new WeakMap;
function row_html(row) {
  const html = MADE.get(row) ?? row_make(row);
  MADE.set(row, html);
  return html;
}
function row_make(row) {
  switch (row.$) {
    case "Sum": {
      const open2 = act_html({ $: "Open", id: row.id, n: row.n });
      const text = row.call === null ? esc(row.text) : head_html(row.call, call_line(row.call), "");
      return `<div class="block"${open2} data-a="${row.id}"><span class="lv">${row.n}x</span><div>${text}</div></div>`;
    }
    case "Box": {
      const shut = act_html({ $: "Shut", id: row.id, n: row.n });
      const one = row.n === 1 ? " one" : "";
      const rows = row.rows.map(row_html).join("");
      return `<div class="open${one}" data-a="${row.id}"><button class="fold"${shut}>${esc(row.text)}</button>${rows}</div>`;
    }
    case "Msg": {
      const at = row.id === null ? "" : ` data-a="${row.id}"`;
      const copy = copy_html(row.call === null ? row.text : call_text(row.call));
      const body = row.call === null ? row.body.map(block_html).join("") : call_html(row.call);
      const pics = images_html(row.images);
      const tall = ["user", "work"].includes(row.kind) && row.text.length + 80 * row.text.split(`
`).length > TALL;
      const fold = tall ? `<div class="clip">${body}</div><details class="more"><summary></summary></details>` : body;
      const who = row.who === "" ? "" : ` data-who="${esc(row.who)}"`;
      return `<div class="msg ${row.kind}"${at}${who}>${copy}${fold}${pics}</div>`;
    }
    case "Cap": {
      return `<p class="cap">${esc(row.text)}</p>`;
    }
  }
}
function call_html(c) {
  return head_html(c, c.head, c.device) + c.blocks.map(block_html).join("");
}
function head_html(c, text, device) {
  const icon = `<span class="ic">${tool_glyph(c.name)}</span>`;
  const verb = c.name === "" ? "" : `<b>${esc(c.name)}</b> `;
  const where = device === "" ? "" : `<span class="on">· ${esc(device)}</span>`;
  return `<p class="call">${where}${icon}${verb}${esc(text)}</p>`;
}
function images_html(names) {
  const pics = names.map((name) => {
    const url = "/image/" + esc(name);
    return `<a href="${url}" target="_blank"><img src="${url}" alt="${esc(name)}" loading="lazy"></a>`;
  });
  return names.length === 0 ? "" : `<div class="pics">${pics.join("")}</div>`;
}
function pick_html(fold, on, knobs) {
  const parts = knobs.map((k) => `<button title="${esc(k.hint)}"${act_html({ $: "Move", move: k.move })}>${esc(k.text)}</button>`);
  const all = fold === null ? [] : [`<button class="all"${act_html({ $: "Fold", on })}>${esc(fold)}</button>`];
  return [...all, `<span class="rule"></span>`, ...parts.flatMap((part, i) => i === 0 ? [part] : [`<span class="dot">·</span>`, part])];
}
function acts_html(c) {
  const x = (label, title, a, cls = "") => `<button class="x${cls}" title="${title}"${act_html(a)}>${label}</button>`;
  switch (c.status) {
    case "working":
    case "waiting":
      return x("■", "stop", { $: "Stop", name: c.name });
    case "asking":
      return x("✓", "approve", { $: "Approve", name: c.name, yes: true }, " yes") + x("×", "deny", { $: "Approve", name: c.name, yes: false });
    default:
      return x("×", "dismiss", { $: "Dismiss", name: c.name });
  }
}
function who_html(c, chips = true) {
  return `<b>${esc(c.title ?? c.name)}</b>${chips ? repos_html(c) : ""}`;
}
function repos_html(c) {
  return (c.repos ?? []).map((r) => `<span class="repo">${esc(r)}</span>`).join("");
}
function also(c) {
  return c.title === undefined ? "" : c.name + " · ";
}
function focus_href(name) {
  return ` href="${esc(view_hash("crew", name))}"`;
}
function tree_html(v, now) {
  return view_tree(v, now).map((r) => {
    const here = v.page?.name === r.name ? " here" : "";
    const caret = r.kids === 0 ? `<span class="caret"></span>` : `<button class="caret" title="${r.open ? "fold" : "open"}"${act_html({ $: "Expand", name: r.name })}>${r.open ? "▾" : "▸"}</button>`;
    const ago = r.text.slice(r.text.lastIndexOf(" · ") + 3);
    const info = r.kids > 0 && !r.open ? r.rollup : r.tier + " · " + r.model + " · " + ago;
    const what = `<span class="st">${CREW[r.status]}</span>${who_html(r, false)}<span class="meta">${esc(info)}</span>`;
    const repos = (r.repos ?? []).length === 0 ? "" : " · " + r.repos.join(", ");
    const title = esc(r.name + " · " + r.tier + " · " + r.model + " · " + r.status + " · " + ago + repos);
    return `<div class="node d${Math.min(r.depth, 4)} ${r.status}${here}">${caret}<a${focus_href(r.name)} title="${title}">${what}</a>${acts_html(r)}${line_html(v, r)}</div>`;
  });
}
function line_html(v, c) {
  const p = v.pulses.get(c.name);
  const at = c.status === "working" || c.status === "waiting" || c.status === "asking";
  const text = p === undefined ? "" : at ? p.act || p.last : p.last || p.act;
  return text === "" ? "" : `<div class="line">${esc(text)}</div>`;
}
function grid_html(v, now) {
  return view_tiles(v, now).map((t) => {
    const dots = t.dots.map((d) => `<a class="dot ${d.status}"${focus_href(d.name)} title="${esc(d.name + " · " + d.status)}"></a>`).join("");
    const todo = view_todo(t);
    const head = `<a class="head"${focus_href(t.name)}><span class="st">${CREW[t.status]}</span>${who_html(t, false)}${todo === "" ? "" : `<span class="todo">${esc(todo)}</span>`}<span class="meta">${esc(also(t) + t.tier + " · " + t.model)}</span></a>`;
    const repos = repos_html(t);
    const roll = t.rollup === "" ? "" : `<div class="roll">${esc(t.rollup)}</div>`;
    const tell = `<form class="tell" data-tell="${esc(t.name)}"><input placeholder="Tell ${esc(t.name)}…" aria-label="tell ${esc(t.name)}"></form>`;
    return `<div class="tile ${t.status}"><div class="top">${head}${acts_html(t)}</div>${repos === "" ? "" : `<div class="repos">${repos}</div>`}${dots === "" ? "" : `<div class="dots">${dots}</div>`}${roll}${line_html(v, t)}${tell}</div>`;
  });
}
function lane_html(v, now) {
  const marks = view_lane(v, now);
  if (marks.length === 0) {
    return "";
  }
  const pct = (at) => Math.round(at * 1000) / 10 + "%";
  const mk = marks.map((m) => {
    const attrs = `class="mk ${m.kind}" style="left:${pct(m.at)}" title="${esc(new Date(m.t).toLocaleTimeString() + " · " + m.label)}"`;
    return m.k === null ? `<span ${attrs}></span>` : `<button ${attrs} data-seek="${m.k}"></button>`;
  });
  return `<div class="lane">${mk.join("")}</div>`;
}
function needs_html(v) {
  const plan = v.plan ? [`<div class="need question"><a href="#chat" data-qs-open><b>Plan ready</b> <span class="meta">waiting for your approval</span></a></div>`] : [];
  const calls = (v.calls ?? []).map((c) => `<div class="need asking"><a href="#chat" data-qs-open><b>${esc(c.who)} wants to run</b> <span class="meta">${esc(c.what.slice(0, 80))}</span></a></div>`);
  const asked = [...plan, ...calls, ...view_questions(v).map((q) => `<div class="need question"><a href="#chat" data-qs-open><b>? ${esc(q.text.split(`
`)[0])}</b> <span class="meta">question ${q.id}</span></a></div>`)];
  return [...asked, ...view_needs(v).map((c) => {
    const why = c.status === "asking" ? "asks to start" : "failed";
    const name = c.title === undefined ? "" : ` <span class="meta">${esc(c.name)}</span>`;
    return `<div class="need ${c.status}"><a${focus_href(c.name)}><b>${esc(c.title ?? c.name)}</b>${name} ${why}</a>${acts_html(c)}</div>`;
  })];
}
function waiting_html(v) {
  const b = (label, a, cls = "qo") => `<button class="${cls}"${act_html(a)}>${label}</button>`;
  const plan = v.plan ? [`<div class="q plan"><div class="qh"><b>Plan</b><span class="meta">${esc(new Date(v.plan.date).toLocaleString())}</span></div><div class="qt">${esc(v.plan.text)}</div><div class="qos">${b("Approve: auto", { $: "Verdict", yes: true, mode: "auto" })}${b("Approve: full", { $: "Verdict", yes: true, mode: "full" })}</div><form class="qa" data-verdict><input placeholder="Send it back: what to change…" aria-label="send the plan back with feedback"></form></div>`] : [];
  const calls = (v.calls ?? []).map((c) => `<div class="q call"><div class="qh"><b>${c.id}</b><span class="meta">${esc(c.who)} wants to run (auto mode's reviewer couldn't check it)</span></div><div class="qt">${esc(c.what)}</div><div class="qos">${b("Run it", { $: "Consent", n: c.id, yes: true })}${b("Refuse", { $: "Consent", n: c.id, yes: false })}</div></div>`);
  return [...plan, ...calls];
}
function questions_html(v) {
  return view_questions(v).map((q) => {
    const quick = (q.options ?? []).map((o) => `<button class="qo"${act_html({ $: "Answer", q: q.id, text: o })}>${esc(o)}</button>`).join("");
    const head = `<div class="qh"><b>${q.id}</b><span class="meta">${esc(new Date(q.date).toLocaleString())}</span><button class="x" title="dismiss"${act_html({ $: "Drop", q: q.id })}>×</button></div>`;
    const box = `<form class="qa" data-q="${q.id}"><input placeholder="Answer…" aria-label="answer question ${q.id}"></form>`;
    return `<div class="q">${head}<div class="qt">${esc(q.text)}</div>${quick === "" ? "" : `<div class="qos">${quick}</div>`}${box}</div>`;
  });
}
function focus_html(v) {
  const name = v.page?.name ?? null;
  if (name === null) {
    return `<div class="focus"><b>${esc(MAIN)}</b> <span class="meta">orchestrator · ${v.busy ? "working" : "idle"} · type to tell it</span></div>`;
  }
  const c = v.crew.find((x) => x.name === name);
  if (c === undefined) {
    return `<div class="focus"><b>${esc(name)}</b></div>`;
  }
  const todo = (c.todo ?? []).length === 0 ? "" : `<ol class="todo">${c.todo.map((x) => `<li class="${esc(x.status)}">${esc(x.text)}</li>`).join("")}</ol>`;
  return `<div class="focus ${c.status}">${who_html(c)} <span class="meta">${esc(also(c) + c.tier + " · " + c.model + " · " + c.status)} · type to tell it</span>${acts_html(c)}${todo}</div>`;
}
function mode_html(mode, pill, asked = 0, perm) {
  const here = (m) => m === mode ? ` class="here"` : "";
  const tag = pill === "" ? "" : ` <span class="pill${pill.includes("need you") ? " need" : ""}">${esc(pill)}</span>`;
  const qs = asked === 0 ? [] : [`<button class="qs" data-qs title="your questions">? ${asked}</button>`];
  const chip = perm === undefined ? [] : [`<button class="perm ${perm}" title="the mode: Shift+Tab in the box cycles it"${act_html({ $: "Mode" })}>${perm} mode</button>`];
  return [`<a href="#chat"${here("chat")}>Chat</a>`, `<a href="#crew"${here("crew")}>Crew${tag}</a>`, ...chip, ...qs];
}
function tabs_html(tabs) {
  return tabs.map((tab) => {
    const here = tab.here ? ` class="here"` : "";
    return `<button${here}${act_html({ $: "Goto", name: tab.name })}>${esc(tab.text)}</button>`;
  });
}
function credit_html(app) {
  const buttons = [10, 25, 50, 100].map((usd) => `<button data-usd="${usd}">$${usd}</button>`).join("");
  return `<div class="credit"><div class="usd">${buttons}</div>${fine_html(app)}</div>`;
}
function fine_html(app) {
  const fee = app ? "Paid at the App Store's price." : "+10% platform fee (min $0.80).";
  return `<p class="fine">${fee} Buying accepts the <a href="/terms.html" target="_blank">terms</a>.</p>`;
}
function account_html(a, app) {
  const tops = a.topups ?? [];
  const days = account_days(a);
  const balance = a.credits === null ? "" : section_html("Balance", `<p class="big">${usd_show(a.credits)}</p>` + credit_html(app));
  const usage = section_html("Usage", days.length === 0 ? `<p class="sub">Nothing yet.</p>` : table_html("days", ["Day", "Use", "Cost"], days.map((d) => [d.date, d.what, cost_show(d.usd)])));
  const buys = tops.length === 0 ? "" : section_html("Purchases", table_html("buys", TOPUP, tops.map(topup_cells)));
  const money = a.bills ? balance + usage + buys : "";
  const item = (what, note, act) => `<div class="item"><p>${what}${note === "" ? "" : `<small>${note}</small>`}</p>${act}</div>`;
  const closes = a.bills ? `<p>This also closes your BendAI account (same sign-in). Credit you bought and didn't use goes back to your card.</p>` : "";
  const kill = `<form class="kill" hidden>${closes}<p>Type <b>${esc(a.name)}</b> to confirm.</p><input name="name" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(a.name)}"><p class="why"></p><div><button type="button" class="chip keep">Cancel</button><button class="chip red" disabled>Delete for good</button></div></form>`;
  const acts = [
    item(esc(a.name), "", `<button class="chip out">Sign out</button>`),
    item("Export memory", "Chat and account, in one file.", `<a class="chip" href="/export">Download</a>`),
    item("Delete account", "Erases chat and memory for good.", `<button class="chip red del">Delete</button>`)
  ];
  const account = section_html("Sign-in and data", acts.join("") + kill);
  const links = a.bills ? `<p class="foot"><a href="/pricing" target="_blank">Prices</a> · <a href="/terms.html" target="_blank">Terms</a> · <a href="/privacy.html" target="_blank">Privacy</a> · <a href="mailto:contact@higherorderco.com">Help</a></p>` : "";
  return `<a class="back" href="/" data-go="/">← Chat</a><h1>Account</h1>` + money + account + links;
}
function section_html(title, body) {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}
function table_html(cls, head, rows) {
  const cells = (row, tag) => row.map((x) => `<${tag}>${spans_html(span_parse(x))}</${tag}>`).join("");
  const body = rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("");
  return `<div class="wide ${cls}"><table><tr>${cells(head, "th")}</tr>${body}</table></div>`;
}
function block_html(b) {
  switch (b.$) {
    case "Para": {
      return `<p>${b.x.map(spans_html).join("<br>")}</p>`;
    }
    case "Head": {
      const tag = "h" + Math.min(4, b.k + 1);
      return `<${tag}>${spans_html(b.x)}</${tag}>`;
    }
    case "Code": {
      const lang = b.k === "" ? "" : `<span class="lang">${esc(b.k)}</span>`;
      return `<pre>${copy_html(b.x)}${lang}<code>${esc(b.x)}</code></pre>`;
    }
    case "Rule": {
      return "<hr>";
    }
    case "Quot": {
      return `<blockquote>${b.x.map(block_html).join("")}</blockquote>`;
    }
    case "List": {
      const tag = b.k ? "ol" : "ul";
      const items = b.x.map((item) => `<li>${spans_html(item)}</li>`);
      return `<${tag}>${items.join("")}</${tag}>`;
    }
    case "Tabl": {
      const rows = b.x.map((row, i) => {
        const tag = i === 0 ? "th" : "td";
        const cells = row.map((cell) => `<${tag}>${spans_html(cell)}</${tag}>`);
        return `<tr>${cells.join("")}</tr>`;
      });
      return `<table>${rows.join("")}</table>`;
    }
    case "Diff": {
      return diff_html(b.k, b.x);
    }
    case "File": {
      return file_html(b.k, b.n, b.x);
    }
  }
}
function diff_html(file, hunks) {
  const all = hunks.flat();
  const nw = all.reduce((w, l) => Math.max(w, String(l.n).length), 0);
  const adds = all.filter((l) => l.s === "+").length;
  const dels = all.filter((l) => l.s === "-").length;
  const head = `<span class="lang">${esc(file)} <b class="add">+${adds}</b> <b class="del">-${dels}</b></span>`;
  const line = (l) => `<span class="${MARKS[l.s]}"><i>${l.n}</i>${l.s} ${esc(l.x)}</span>`;
  const lines = hunks.map((h) => h.map(line).join("")).join(`<span class="gap">⋯</span>`);
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${lines}</code></pre>`;
}
function file_html(shown, from, lines) {
  const nw = String(from + lines.length - 1).length;
  const head = `<span class="lang">${esc(shown)}</span>`;
  const body = lines.map((x, k) => `<span class="file"><i>${from + k}</i>${esc(x)}</span>`).join("");
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${body}</code></pre>`;
}
function spans_html(spans) {
  return spans.map(span_html).join("");
}
function span_html(s) {
  switch (s.$) {
    case "Text": {
      return esc(s.x).replaceAll("Legion", `<span class="brand">Legion</span>`);
    }
    case "Code": {
      return `<code>${esc(s.x)}</code>`;
    }
    case "Bold": {
      return `<strong>${esc(s.x)}</strong>`;
    }
    case "Ital": {
      return `<em>${esc(s.x)}</em>`;
    }
    case "Link": {
      return `<a href="${esc(s.k)}" target="_blank" rel="noopener">${esc(s.x)}</a>`;
    }
    case "Name": {
      return `<button class="name"${act_html({ $: "Goto", name: s.x })}>[${esc(s.x)}]</button>`;
    }
  }
}

// web/src/main.ts
var APP = window.webkit?.messageHandlers?.unii ?? null;
var DESK = matchMedia("(hover: hover)");
var TERMINAL = "Signed in from a terminal? Run `legion web` there and this page opens signed in.";
var EXPIRED = "That sign-in link expired. What's your email? I'll send you a new one.";
var GUEST_AI = `By signing in, you accept the <a href="/terms.html" target="_blank">terms</a> and <a href="/privacy.html" target="_blank">privacy policy</a>, and that Anthropic's and OpenAI's models answer you.`;
var SENT = (email) => `Thanks! I sent a link to ${email}. Open it, and we'll go on from here.`;
var NONE = "No Claude or ChatGPT chats in that folder. Choose ~/.claude or ~/.codex.";
var PAYING = "Waiting for your payment in the new tab…";
var PAID = new BroadcastChannel("unii.paid");
var SCENES = `
  <div class="scene"><p>Your entire life.</p><p>One single chat.</p></div>
  <div class="scene"><i class="mark"></i><h1>Legion</h1></div>`;
var v = view_new();
var BOX = $("textarea");
var DEMO = new URLSearchParams(location.search).get("demo") === "1" ? demo_crew(Date.now()) : null;
var BACK = $("#import [name=back]");
var P = {
  id: "",
  guest: false,
  imgs: [],
  rec: null,
  shown: "",
  end: true,
  stick: true,
  frame: 0,
  rows: true,
  toast: 0,
  found: new Map,
  done: {},
  off: new Set,
  step: "",
  crew: false,
  g: 0,
  watching: "",
  watched: null,
  qhide: false
};
function $(sel) {
  return document.querySelector(sel);
}
function kept(fact) {
  return "unii." + fact + "." + P.id;
}
async function boot() {
  document.head.insertAdjacentHTML("beforeend", `<style>${theme_css()}</style>`);
  const q = new URLSearchParams(location.search);
  history.replaceState(null, "", (location.pathname === "/account" ? "/account" : "/") + location.hash);
  if (q.has("terminal")) {
    solo("Your terminal is signed in.", "You can close this tab and go back to it.");
    return;
  }
  if (q.has("deleted")) {
    solo("Your account was deleted.", `Your chat and Unii's memory are erased. <a href="/">Back to Legion</a>`);
    return;
  }
  if (q.get("paid") === "tab") {
    PAID.postMessage(true);
    close();
    solo("Payment received.", "Close this tab: your import starts in the Legion tab you came from.");
    return;
  }
  const me = await boot_me();
  P.guest = me === null;
  chat();
  if (me === null) {
    history.replaceState(null, "", "/");
    guest(q.has("expired"));
    return;
  }
  P.id = me.id;
  signed();
  route();
  v.bills = me.bills;
  v.credits = me.credits;
  connect();
  if (q.has("paid")) {
    toast("Payment received. Your credit shows up in a moment.");
  }
}
async function boot_me() {
  for (;; ) {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.status === 200 || res?.status === 401) {
      return res.ok ? res.json() : null;
    }
    await new Promise((ok) => setTimeout(ok, RETRY));
  }
}
function solo(title, sub) {
  document.body.className = "solo";
  document.body.innerHTML = `<main><h1>${title}</h1><p class="sub">${sub}</p></main>`;
}
async function guest(expired) {
  document.onvisibilitychange = async () => {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.ok) {
      location.reload();
    }
  };
  const { hello, bills, github } = await fetch("/api/hello").then((res) => res.json());
  const ask = github && APP === null;
  document.body.classList.toggle("bills", bills);
  $(".ai").innerHTML = bills ? GUEST_AI : "";
  BOX.placeholder = "Enter your email" + (ask ? " or @github" : "");
  P.end = false;
  guest_say(hello + `

` + TERMINAL + `

` + (expired ? EXPIRED : email_ask(ask)));
}
async function guest_send(text) {
  P.end = true;
  v.live.push({ kind: "user", text });
  draw(true);
  const res = await post("/api/login", { who: text });
  if (res.url) {
    location.href = res.url;
    return;
  }
  guest_say(res.error ?? SENT(res.who));
}
function guest_say(text) {
  v.live.push({ kind: "unii", text });
  draw(true);
}
function chat() {
  const file = $("input[type=file]");
  BOX.oninput = () => {
    if (!P.guest) {
      sessionStorage.setItem(kept("draft"), BOX.value);
    }
    BOX.style.height = "auto";
    BOX.style.height = Math.min(BOX.scrollHeight, innerHeight * 0.4) + "px";
    draw(true);
  };
  BOX.onkeydown = (ev) => {
    if (ev.key === "Tab" && ev.shiftKey && !P.guest) {
      ev.preventDefault();
      act({ $: "Mode" });
      return;
    }
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229 && (DESK.matches || P.guest)) {
      ev.preventDefault();
      submit();
    }
  };
  BOX.onpaste = (ev) => attach([...ev.clipboardData?.files ?? []]);
  $("form.composer").onsubmit = (ev) => {
    ev.preventDefault();
    submit();
  };
  $(".attach").onclick = () => file.click();
  $("#menu .out").onclick = signout;
  $(".mic").onclick = mic;
  file.onchange = () => {
    attach([...file.files ?? []]);
    file.value = "";
  };
  $("#wallet").insertAdjacentHTML("beforeend", credit_html(APP !== null));
  onpopstate = route;
  importer();
  document.ondragover = (ev) => ev.preventDefault();
  document.ondrop = (ev) => {
    ev.preventDefault();
    attach([...ev.dataTransfer?.files ?? []]);
  };
  document.onclick = click;
  onhashchange = crew_route;
  $("#grid").onsubmit = tell;
  $("#questions").onsubmit = answer;
  $("#crew").addEventListener("click", seek);
  document.addEventListener("keydown", crew_keys);
  crew_route();
  visualViewport.onresize = () => draw(true);
  document.onscroll = () => {
    P.end = innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
  };
  draw(true);
}
function signed() {
  document.body.className = "";
  BOX.placeholder = HINT;
  BOX.removeAttribute("inputmode");
  BOX.removeAttribute("enterkeyhint");
  BOX.removeAttribute("autocomplete");
  BOX.value = sessionStorage.getItem(kept("draft")) ?? "";
  BOX.dispatchEvent(new Event("input"));
}
function submit() {
  const text = BOX.value.trim();
  if (P.guest) {
    BOX.value = "";
    if (text !== "") {
      guest_send(text);
    }
    return;
  }
  act({ $: "Send", text, images: P.imgs });
  pics([]);
  BOX.value = "";
  BOX.dispatchEvent(new Event("input"));
}
function back(sent, out) {
  if (out.error === undefined) {
    return;
  }
  if (BOX.value.trim() === "" && P.imgs.length === 0) {
    BOX.value = sent.text;
    BOX.dispatchEvent(new Event("input"));
    pics(sent.images ?? []);
  }
  if (out.status !== 402) {
    toast(out.error);
    return;
  }
  $("#wallet .title").textContent = out.error;
  $("#wallet").showPopover();
}
function attach(files) {
  if (!P.guest && files.length > 0) {
    pics([...P.imgs, ...files]);
  }
}
function pics(imgs) {
  const els = imgs.map((img) => {
    const el = new Image;
    el.src = URL.createObjectURL(img);
    el.title = "Remove";
    el.onclick = () => pics(imgs.filter((x) => x !== img));
    return el;
  });
  P.imgs = imgs;
  $("#pics").replaceChildren(...els);
  draw(true);
}
function act(a) {
  const said = a.$ === "Send" ? a.text.trim() : "";
  if (a.$ === "Send" && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
  P.end = P.end || a.$ === "Send";
  P.rows = true;
  for (const msg of view_act(v, a)) {
    link_send(v, msg, a.$ === "Send" ? (out) => back(a, out) : undefined, said);
  }
  if (a.$ === "Goto") {
    crew_sync();
  }
  draw(a.$ === "Send");
}
function click(ev) {
  const qs = ev.target.closest("[data-qs], [data-qs-open]");
  if (qs !== null) {
    P.qhide = qs.dataset.qs !== undefined ? !P.qhide : false;
    paint();
  }
  const el = ev.target.closest("[data-act], [data-copy], [data-go], [data-usd]");
  const sel = getSelection();
  if (el === null || sel !== null && !sel.isCollapsed && el.contains(sel.focusNode)) {
    return;
  }
  const { act: a, copy: text, go: path, usd } = el.dataset;
  const menu = el.closest("#menu") !== null;
  if (menu) {
    $("#menu").hidePopover();
  }
  if (path !== undefined || a !== undefined && menu) {
    ev.preventDefault();
    go(path ?? "/");
  }
  if (a !== undefined) {
    act(JSON.parse(a));
  }
  if (usd !== undefined) {
    warned(el, () => topup2(Number(usd)));
  }
  if (text !== undefined) {
    navigator.clipboard.writeText(text).then(() => copied(el), () => toast("Could not copy."));
  }
}
function copied(button) {
  button.innerHTML = CHECK;
  setTimeout(() => button.innerHTML = SHEETS, 1200);
}
async function mic() {
  if (P.rec !== null) {
    P.rec.stop();
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  if (stream === null) {
    toast("Legion can't use the microphone.");
    return;
  }
  const mimeType = ["audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  const rec = new MediaRecorder(stream, { mimeType });
  const parts = [];
  rec.ondataavailable = (ev) => parts.push(ev.data);
  rec.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    P.rec = null;
    words(new Blob(parts, { type: rec.mimeType }));
  };
  rec.start();
  P.rec = rec;
  draw(false);
  meter(stream, rec);
}
function meter(stream, rec) {
  const audio = new AudioContext;
  const probe = audio.createAnalyser();
  audio.createMediaStreamSource(stream).connect(probe);
  const buf = new Uint8Array(probe.fftSize);
  const canvas = $(".voice canvas");
  const pen = canvas.getContext("2d");
  const levels = [];
  const start = performance.now();
  const frame = (now) => {
    if (P.rec !== rec) {
      audio.close();
      return;
    }
    probe.getByteTimeDomainData(buf);
    const power = buf.reduce((sum, b) => sum + ((b - 128) / 128) ** 2, 0) / buf.length;
    const level = Math.min(1, Math.sqrt(power) * 5);
    const slot = Math.floor((now - start) / 50);
    levels[slot] = Math.max(levels[slot] ?? 0, level);
    const secs = Math.floor((now - start) / 1000);
    $(".voice span").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    const dpr = devicePixelRatio;
    const w = canvas.width = canvas.clientWidth * dpr;
    const h = canvas.height = canvas.clientHeight * dpr;
    pen.fillStyle = getComputedStyle(canvas).color;
    const step = 5 * dpr;
    for (let i = 0;i * step < w && slot - i >= 0; i++) {
      const bar = Math.max(2 * dpr, (levels[slot - i] ?? 0) * h);
      pen.fillRect(w - (i + 1) * step, (h - bar) / 2, 3 * dpr, bar);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function words(audio) {
  const act = { $: "voice", type: audio.type, body: () => audio };
  link_send(v, act, heard);
  draw(false);
}
function heard(out) {
  draw(false);
  const text = out.text?.trim() ?? "";
  if (text === "") {
    toast(out.error ?? "No words heard.");
    return;
  }
  const gap = /\S$/.test(BOX.value.slice(0, BOX.selectionStart)) ? " " : "";
  BOX.setRangeText(gap + text, BOX.selectionStart, BOX.selectionEnd, "end");
  BOX.dispatchEvent(new Event("input"));
  BOX.focus();
}
function connect() {
  link_open(v, {
    open: (query) => new WebSocket(location.origin.replace(/^http/, "ws") + "/ws" + query),
    post: (path, body) => fetch(path, { method: "POST", body }),
    hear,
    lost
  });
}
async function lost(up) {
  draw(true);
  const me = up ? null : await fetch("/api/me").catch(() => null);
  if (me !== null && me.status === 401) {
    location.href = "/";
    return false;
  }
  return true;
}
function hear(msg) {
  const was = view_pick(v);
  const agents = v.agents.join();
  for (const out of view_hear(v, msg)) {
    link_send(v, out);
  }
  if (msg.$ === "agent") {
    crew_sync();
  }
  if (DEMO !== null && msg.$ === "state") {
    v.crew = DEMO;
    demo_pulses(DEMO).forEach((p) => view_hear(v, p));
  }
  const now = view_pick(v).filter((k) => was.length > 0 && !was.some((w) => w.text === k.text));
  if (now.length > 0) {
    toast("Now " + now.map((k) => k.hint).join("; ") + ".");
  }
  P.rows ||= msg.$ === "state" ? v.agents.join() !== agents : msg.$ !== "delta" && msg.$ !== "live";
  if (msg.$ === "state") {
    view_alerts(v, Date.now()).forEach(notify);
  }
  import_welcome();
  draw(true);
}
function notify(alert) {
  if (!document.hidden) {
    return;
  }
  chime();
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  const note = new Notification(alert.title, { body: alert.body, tag: alert.key });
  note.onclick = () => {
    window.focus();
    act({ $: "Goto", name: alert.name });
    note.close();
  };
}
var AUDIO = null;
function chime() {
  try {
    AUDIO ??= new AudioContext;
    AUDIO.resume();
    const at = AUDIO.currentTime;
    for (const [k, hz] of [660, 990].entries()) {
      const osc = AUDIO.createOscillator();
      const gain = AUDIO.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at + k * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.15, at + k * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + k * 0.14 + 0.3);
      osc.connect(gain).connect(AUDIO.destination);
      osc.start(at + k * 0.14);
      osc.stop(at + k * 0.14 + 0.32);
    }
  } catch {}
}
function importer() {
  const form = $("#import form");
  const dir = $("#import [name=dir]");
  $(".imp").onclick = () => import_open(false);
  const zip = $("#import [name=zip]");
  $(".pickdir").onclick = () => dir.click();
  for (const src of import_srcs()) {
    src.querySelector(".pickzip").onclick = () => zip.click();
    src.querySelector(".pickzip").title = "From the website: " + EXPORTS[src.dataset.app] + ", which emails you a zip.";
  }
  $(".into").onclick = () => {
    P.step = "";
    import_draw("");
  };
  $("#import").onclick = (ev) => ev.target.closest(".skip") && $("#import").hidePopover();
  $("#import .prog .sub").textContent = MIDWAY;
  $("#import .flow").onclick = import_flow;
  $("#import").ontoggle = (ev) => {
    if (ev.newState === "closed") {
      P.step = P.step === "pay" || P.step === "start" || P.step === "done" ? "" : P.step;
    }
    import_draw("");
  };
  form.oninput = (ev) => {
    const box = ev.target;
    if (box.name === "session") {
      box.checked ? P.off.delete(box.value) : P.off.add(box.value);
    }
    import_draw("");
  };
  dir.onchange = async () => {
    const all = [...dir.files ?? []];
    const files = all.filter((f) => import_file(f.webkitRelativePath));
    const found = [];
    let moved = 0;
    const reading = (k) => "Reading " + k + " of " + files.length + " files…";
    import_draw(reading(1));
    for (const [k, f] of files.entries()) {
      $("#import .guess").textContent = reading(k + 1);
      const s = await import_copy(f).then((b) => import_session(b, "log"), () => {
        return;
      });
      moved += s === undefined ? 1 : 0;
      found.push(...s ? [s] : []);
    }
    dir.value = "";
    import_took(all[0]?.webkitRelativePath.split("/")[0] ?? "", { sessions: found, moved }, found.length > 0 ? "" : NONE);
  };
  zip.onchange = async () => {
    for (const f of zip.files ?? []) {
      import_draw("Reading " + f.name + "…");
      try {
        const found = await import_export(await import_copy(f));
        import_took(f.name, { sessions: found, moved: 0 }, found.length > 0 ? "" : "No chats in " + f.name + ".");
      } catch (e) {
        import_took(f.name, { sessions: [], moved: 0 }, f.name + ": " + e.message);
      }
    }
    zip.value = "";
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    warned(form, import_go);
  };
}
function import_go() {
  const add = import_add(import_plan2());
  if (add === 0) {
    return import_send();
  }
  import_buy(add);
}
function import_flow() {
  const run = v.importing;
  if (run?.why === BROKE) {
    return warned($("#import .flow"), () => import_buy(progress_need(run, v.credits)));
  }
  link_send(v, { $: "go", on: Boolean(run?.why) }, (out) => out.error && toast(out.error));
}
async function import_buy(usd) {
  P.step = "pay";
  import_draw(PAYING);
  if (await topup2(usd)) {
    return import_pay();
  }
  P.step = "";
  import_draw("");
}
function warned(from, then) {
  if (localStorage.getItem(kept("risked")) !== null) {
    return then();
  }
  const box = $("#risk");
  (from.closest("[popover]") ?? document.body).append(box);
  box.querySelector(".no").onclick = () => box.hidePopover();
  box.querySelector(".ok").onclick = () => {
    localStorage.setItem(kept("risked"), "1");
    box.hidePopover();
    then();
  };
  box.showPopover();
}
async function import_open(first) {
  $("#menu").hidePopover();
  P.done = await fetch("/api/imported").then((res) => res.json()).catch(() => ({}));
  $("#import form .skip").textContent = first ? "Start fresh" : "Close";
  P.step = first ? "start" : P.step === "done" ? "" : P.step;
  import_draw("");
  $("#import").showPopover();
}
function import_took(name, read, status) {
  P.found.set(name, read);
  BACK.min = "0";
  BACK.value = "0";
  import_draw(status);
}
async function import_welcome() {
  await INTRO;
  const key = kept("welcomed");
  if (localStorage.getItem(key) === null && v.pick !== null && v.parts.length === OPENING && v.importing === null && DESK.matches) {
    localStorage.setItem(key, "1");
    import_open(true);
  }
}
async function import_pay() {
  while (P.step === "pay") {
    await new Promise((ok) => {
      setTimeout(ok, 3000);
      PAID.onmessage = ok;
    });
    const me = await fetch("/api/me").then((res) => res.json()).catch(() => null);
    v.credits = me?.credits ?? v.credits;
    if (P.step === "pay" && v.importing === null && v.credits !== null && v.credits >= import_plan2().guess) {
      import_send();
    }
  }
}
function import_send() {
  const picked = import_plan2().picked;
  P.step = "send";
  import_draw("");
  const body = async () => new Blob(await Array.fromAsync(import_body(picked), (part) => new Blob([part])));
  link_send(v, { $: "import", body }, import_sent);
}
function import_sent(out) {
  P.step = out.error !== undefined ? "" : out.going ? "run" : "done";
  if (out.error === undefined) {
    P.found.clear();
  }
  import_draw(out.error === undefined ? "" : "Not imported: " + out.error);
  $("#import").showPopover();
}
function import_add(plan) {
  return plan.msgs > 0 && v.credits !== null ? topup(plan.guess, v.credits) : 0;
}
function import_plan2() {
  const form = new FormData($("#import form"));
  const want = { off: [...P.off], since: import_since(), tools: form.has("tools") };
  const found = [...P.found.values()].flatMap((read) => read.sessions);
  return import_plan(found, want, P.done, view_count(v));
}
function import_since() {
  return BACK.valueAsNumber > Number(BACK.min) ? new Date(BACK.valueAsNumber * 86400000).toISOString().slice(0, 10) : "";
}
function import_bar() {
  const run = v.importing;
  const broke = run?.why === BROKE;
  const paying = broke && P.step === "pay";
  P.step = run !== null && !paying ? "seen" : P.step === "seen" ? "done" : P.step;
  const done = P.step === "done";
  const going = paying || ["send", "run", "seen", "done"].includes(P.step);
  const part = run === null ? Number(done) : run.done / Math.max(1, run.total);
  const why = Boolean(run?.why);
  const said = run !== null ? progress_show(v, run) : done ? DONE : P.step === "send" ? "Sending…" : "Starting…";
  $("#import .start").hidden = P.step !== "start";
  $("#import form").hidden = going || P.step === "start";
  $("#import .prog").hidden = !going;
  $("#import .prog .title").textContent = done ? "Memory tree built" : "Building your memory tree";
  $("#import progress").value = part;
  $(".imping progress").value = part;
  $(".imping").hidden = run === null;
  $(".imping").classList.toggle("why", why);
  $(".imping span").textContent = !why ? "Building memory" : run.why === BROKE ? "Needs credit" : "Import paused";
  $(".imping").title = $("#import .pct").textContent = said;
  $("#import .prog .sub").hidden = why || done;
  $("#import .flow").textContent = broke ? "Add $" + progress_need(run, v.credits) : why ? "Resume" : "Pause";
  $("#import .flow").hidden = run === null;
  $("#import .flow").disabled = paying;
  markup($("#import .prog .topup"), broke ? [fine_html(APP !== null)] : []);
  return going;
}
function import_draw(status) {
  if (import_bar()) {
    return;
  }
  const reads = [...P.found.values()];
  const sessions = reads.flatMap((read) => read.sessions);
  const plan = import_plan2();
  const msgs = plan.msgs;
  const add = import_add(plan);
  const left = reads.reduce((n, read) => n + read.moved, 0);
  const moved = left === 0 ? "" : " (" + left + (left === 1 ? " file" : " files") + " changed while read: choose the folder again to add them)";
  const has = add > 0 ? " · you have " + usd_show(v.credits) : "";
  const found = sessions.length === 0 ? "" : plan.first === "" ? OLD : import_count(msgs, "new ") + (msgs > 0 ? " · about " + guess_usd(plan.guess) + has : "");
  const day = (at) => new Date(at).getUTCDate() + " " + new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  BACK.min = String(Math.floor(Date.parse(plan.first || new Date().toISOString()) / 86400000));
  BACK.max = String(Math.floor(Date.now() / 86400000));
  $("#import .since .from").textContent = day(import_since() || plan.first || Date.now());
  $("#import .since .to").textContent = day(Date.now());
  BACK.style.setProperty("--at", 100 * (BACK.valueAsNumber - Number(BACK.min)) / Math.max(1, Number(BACK.max) - Number(BACK.min)) + "%");
  $("#import .want").hidden = plan.first === "";
  $("#import .tools").hidden = !sessions.some((s) => s.heads.some((m) => m.kind === "tool" || m.kind === "echo"));
  $("#import .found").textContent = found + moved;
  for (const src of import_srcs()) {
    const list = src.querySelector(".sessions");
    const shown = plan.sessions.filter((s) => s.app === src.dataset.app);
    markup(list, shown.map((s) => `<label title="${esc(s.where + ", " + import_count(s.heads.length, ""))}"><input type="checkbox" name="session" value="${esc(import_id(s))}">${import_cells(s).map((c) => `<span>${esc(c)}</span>`).join("")}</label>`));
    list.querySelectorAll("input").forEach((box) => box.checked = !P.off.has(box.value));
    const on = shown.filter((s) => !P.off.has(import_id(s))).length;
    src.querySelector(".pick").hidden = shown.length === 0;
    src.querySelector(".pick summary").textContent = (on < shown.length ? on + " of " : shown.length > 1 ? "All " : "") + shown.length + (shown.length === 1 ? " session" : " sessions") + " picked · choose";
  }
  $("#import .guess").textContent = status;
  markup($("#import form .topup"), add > 0 ? [fine_html(APP !== null)] : []);
  const [go, dir] = [$("#import .go"), $(".pickdir")];
  go.hidden = msgs === 0;
  go.textContent = add > 0 ? "Add $" + add + " and import" : "Import";
  go.disabled = P.step === "pay" || status.startsWith("Reading");
  dir.textContent = msgs > 0 ? "Add a folder" : "Choose folder";
  dir.classList.toggle("alt", msgs > 0);
  dir.disabled = go.disabled;
  import_srcs().forEach((src) => src.querySelector(".pickzip").disabled = dir.disabled);
}
function import_srcs() {
  return [...document.querySelectorAll("#import .src")];
}
async function import_copy(file) {
  const reader = file.stream().getReader();
  const parts = [];
  for (let got = await reader.read();!got.done; got = await reader.read()) {
    parts.push(new Blob([got.value]));
  }
  return new Blob(parts);
}
var MARKUP = new WeakMap;
function markup(el, htmls) {
  const had = new Map;
  for (const child of el.children) {
    const html = MARKUP.get(child);
    const same = had.get(html) ?? [];
    same.push(child);
    had.set(html, same);
  }
  const kids = htmls.map((html) => had.get(html)?.shift() ?? html_parse(html));
  for (const left of had.values()) {
    left.forEach((child) => child.remove());
  }
  let at = el.firstElementChild;
  for (const kid of kids) {
    if (kid === at) {
      at = at.nextElementSibling;
    } else {
      el.insertBefore(kid, at);
    }
  }
}
function html_parse(html) {
  const made = document.createElement("template");
  made.innerHTML = html;
  const child = made.content.firstElementChild;
  MARKUP.set(child, html);
  return child;
}
function draw(stick) {
  P.stick = P.stick && stick;
  if (P.frame === 0) {
    P.frame = requestAnimationFrame(paint);
  }
}
function paint() {
  if (!$("#account").hidden) {
    P.frame = 0;
    bars();
    return;
  }
  const doc = document.documentElement;
  const follow = P.stick && P.end;
  const at = P.rows && !follow ? anchor() : null;
  const shown = (v.page === null ? "" : v.page.name) + (v.fold === null ? "" : "/fold");
  P.frame = 0;
  P.stick = true;
  bars();
  if (P.rows) {
    markup($("#log .rows"), view_body(v).map(row_html));
    P.rows = false;
  }
  markup($("#log .tail"), view_tail(v).map(row_html));
  if (shown !== P.shown) {
    P.shown = shown;
    scrollTo(0, v.fold === null ? doc.scrollHeight : 0);
    return;
  }
  if (follow) {
    scrollTo(0, doc.scrollHeight);
    return;
  }
  if (at === null) {
    return;
  }
  const rows = [...document.querySelectorAll("#log [data-a]")];
  const el = rows.filter((r) => Number(r.dataset.a) <= at.a).pop();
  if (el !== undefined) {
    scrollBy(0, el.getBoundingClientRect().top - at.top);
  }
}
function bars() {
  for (const note of v.notes.splice(0)) {
    toast(note);
  }
  const credits = view_credits(v);
  const on = view_typing(v);
  const stop = on && v.busy && BOX.value.trim() === "" && P.imgs.length === 0;
  const tabs = view_tabs(v);
  const send = $(".send");
  $(".net").hidden = v.up;
  $(".credits").hidden = credits === null;
  $(".credits").textContent = credits;
  document.body.classList.toggle("bills", v.bills);
  send.classList.toggle("stop", stop);
  send.disabled = !on;
  BOX.disabled = !on;
  $(".attach").disabled = !on;
  $(".mic").disabled = !on || v.out.some((p) => p.msg.$ === "voice");
  $(".mic").classList.toggle("rec", P.rec !== null);
  $(".composer").classList.toggle("off", !on);
  $(".composer").classList.toggle("rec", P.rec !== null);
  markup($("#pick"), pick_html(view_fold(v), v.fold === null, view_pick(v)));
  const crew = v.crew.length > 0;
  $("#tabs").hidden = crew || tabs.length < 2;
  markup($("#tabs"), crew ? [] : tabs_html(tabs));
  $("#status").textContent = P.guest ? "" : view_status(v);
  crew_bars();
  import_bar();
}
function crew_route() {
  const r = view_route(location.hash);
  const at = v.page?.name ?? null;
  if (r.mode === "chat" ? at !== null && P.crew : r.name !== at) {
    act({ $: "Goto", name: r.name });
  }
  P.crew = r.mode === "crew";
  draw(true);
}
function crew_bars() {
  const mode = view_route(location.hash).mode;
  const crew = mode === "crew";
  document.body.classList.toggle("crewmode", crew && !P.guest);
  const asked = view_questions(v).length + view_waiting(v);
  markup($("#mode"), mode_html(mode, view_pill(v), asked, P.guest ? undefined : v.mode));
  const pane = !crew && asked > 0 && !P.qhide && !P.guest;
  document.body.classList.toggle("qmode", pane);
  $("#questions").hidden = !pane;
  markup($("#questions"), pane ? [...waiting_html(v), ...questions_html(v)] : []);
  $("#crew").hidden = !crew;
  if (!crew) {
    document.body.classList.remove("gridmode");
    $("#grid").hidden = true;
    watch();
    return;
  }
  markup($("#crew .needs"), needs_html(v));
  markup($("#crew .card"), [focus_html(v), lane_html(v, Date.now())].filter((h) => h !== ""));
  markup($("#crew .tree"), tree_html(v, Date.now()));
  const grid = v.page === null;
  document.body.classList.toggle("gridmode", grid);
  $("#grid").hidden = !grid;
  if (grid) {
    markup($("#grid"), grid_html(v, Date.now()));
  }
  watch();
}
function crew_sync() {
  const r = view_route(location.hash);
  const at = v.page?.name ?? null;
  if (r.mode === "crew" && r.name !== at) {
    history.replaceState(null, "", location.pathname + location.search + view_hash("crew", at));
  }
}
function watch() {
  const tiles = $("#grid").hidden ? [] : [...$("#grid").querySelectorAll("form.tell")].filter(seen).map((f) => f.dataset.tell);
  const names = view_watch(v, tiles);
  const key = names.join(`
`);
  if (key !== P.watching || v.ws !== P.watched) {
    P.watching = key;
    P.watched = v.ws;
    link_send(v, { $: "watch", names });
  }
}
function seen(el) {
  const box = el.getBoundingClientRect();
  return box.bottom > 0 && box.top < innerHeight;
}
function seek(ev) {
  const k = ev.target.closest("[data-seek]")?.dataset.seek;
  const row = k === undefined ? undefined : $("#log .rows").children[Number(k) + 1];
  row?.scrollIntoView({ block: "center" });
  row?.classList.add("flash");
  setTimeout(() => row?.classList.remove("flash"), 1200);
}
function tell(ev) {
  const form = ev.target.closest("form.tell");
  if (form === null) {
    return;
  }
  ev.preventDefault();
  const input = form.querySelector("input");
  act({ $: "Tell", name: form.dataset.tell, text: input.value });
  input.value = "";
}
function answer(ev) {
  const form = ev.target.closest("form.qa");
  if (form === null) {
    return;
  }
  ev.preventDefault();
  const input = form.querySelector("input");
  act(form.dataset.verdict !== undefined ? { $: "Verdict", yes: false, text: input.value } : { $: "Answer", q: Number(form.dataset.q), text: input.value });
  input.value = "";
}
function crew_keys(ev) {
  const typing = ev.target instanceof HTMLElement && ev.target.closest("textarea, input, [contenteditable]") !== null;
  if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) {
    return;
  }
  const to = Date.now() - P.g < 1000 ? { c: "#crew", m: "#chat" }[ev.key] : undefined;
  P.g = ev.key === "g" ? Date.now() : 0;
  if (to !== undefined) {
    location.hash = to;
  }
}
function anchor() {
  for (const r of document.querySelectorAll("#log [data-a]")) {
    const box = r.getBoundingClientRect();
    if (box.bottom > 60 && r.querySelector("[data-a]") === null) {
      return box.top < innerHeight ? { a: Number(r.dataset.a), top: box.top } : null;
    }
  }
  return null;
}
function go(path) {
  if (location.pathname !== path) {
    history.pushState(null, "", path);
  }
  route();
}
function route() {
  const page = location.pathname === "/account";
  $("#log").hidden = page;
  document.body.classList.toggle("account", page);
  $("#account").hidden = !page;
  P.shown = location.pathname;
  if (page) {
    account();
  }
  draw(false);
}
async function account() {
  const el = $("#account");
  const res = await fetch("/api/account").catch(() => null);
  const a = res !== null && res.ok ? await res.json() : null;
  if (a === null) {
    el.innerHTML = `<p class="sub">Could not read your account. Try again in a moment.</p>`;
    return;
  }
  el.innerHTML = account_html(a, APP !== null);
  const kill = $("#account .kill");
  const del = $("#account .del");
  const name = kill.querySelector("input");
  const sure = (open2) => {
    kill.hidden = !open2;
    del.hidden = open2;
  };
  del.onclick = () => {
    sure(true);
    name.focus();
  };
  $("#account .keep").onclick = () => sure(false);
  name.oninput = () => kill.querySelector(".red").disabled = name.value.trim().toLowerCase() !== a.name.toLowerCase();
  $("#account .out").onclick = signout;
  kill.onsubmit = (ev) => {
    ev.preventDefault();
    account_delete(kill);
  };
}
async function signout() {
  await post("/api/logout", {});
  location.href = "/";
}
async function account_delete(kill) {
  const name = kill.querySelector("input").value;
  const out = await post("/api/delete", { confirm: name });
  if (out.error === undefined) {
    location.href = "/?deleted";
    return;
  }
  kill.querySelector(".why").textContent = out.error;
}
async function topup2(usd) {
  if (APP !== null) {
    $("#wallet").hidePopover();
    APP.postMessage({ buy: usd });
    return true;
  }
  const tab = $("#import").matches(":popover-open") ? open("", "_blank") : null;
  const out = await post("/api/topup", { usd, tab: tab !== null, back: location.pathname });
  if (out.url) {
    (tab ?? window).location.href = out.url;
    return true;
  }
  tab?.close();
  toast(out.error ?? "Could not start the payment.");
  return false;
}
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(P.toast);
  P.toast = setTimeout(() => el.hidden = true, 7000);
}
function intro_play() {
  const skip = new URLSearchParams(location.search).has("skip");
  if (localStorage.getItem("unii.intro") !== null || skip) {
    return Promise.resolve();
  }
  localStorage.setItem("unii.intro", "1");
  const el = document.createElement("div");
  return new Promise((gone) => {
    function end() {
      removeEventListener("keydown", end);
      el.classList.add("out");
      el.ontransitionend = () => {
        el.remove();
        gone();
      };
      if (DESK.matches) {
        BOX.focus();
      }
    }
    el.id = "intro";
    el.innerHTML = SCENES;
    el.onclick = end;
    el.onanimationend = (ev) => {
      if (ev.target === el) {
        end();
      }
    };
    addEventListener("keydown", end);
    document.documentElement.append(el);
  });
}
var INTRO = intro_play();
boot();
