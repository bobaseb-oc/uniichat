// Hl
// ==
// A file's lines colored for the files pane (Pages.ts): comments, strings,
// numbers and keywords, by a small scanner per language, not a parser (a
// regex literal or a nested template may color wrong; nothing is lost,
// every character is shown, escaped). Each line comes whole, its spans
// closed at its end, so the caller numbers lines as it would plain text.
// Classes: c (comment), s (string), n (number), k (keyword).

// line: what starts a comment to the line's end (word: only at a word's
// start, as shell's #); block: comments with an end; quotes: longest first;
// long: quotes that run over lines; fold: keywords in any case (SQL)
export type Lang = { line: string[]; word?: boolean; block: [string, string][]; quotes: string[]; long: string[]; words: Set<string>; fold?: boolean };

const words = (s: string) => new Set(s.split(" "));

const C_LIKE = { line: ["//"], block: [["/*", "*/"]] as [string, string][] };
const JS: Lang = {
  ...C_LIKE, quotes: ["`", '"', "'"], long: ["`"],
  words: words("as async await break case catch class const continue default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of private protected public readonly return static super switch this throw true try type typeof undefined var void while yield namespace declare keyof satisfies"),
};
const PY: Lang = {
  line: ["#"], block: [], quotes: ['"""', "'''", '"', "'"], long: ['"""', "'''"],
  words: words("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self"),
};
const SH: Lang = {
  line: ["#"], word: true, block: [], quotes: ['"', "'"], long: ['"', "'"],
  words: words("if then else elif fi for while until do done case esac in function return local export readonly set unset shift exit echo printf cd source trap"),
};
const JSON_: Lang = { line: [], block: [], quotes: ['"'], long: [], words: words("true false null") };
const YAML: Lang = { line: ["#"], word: true, block: [], quotes: ['"', "'"], long: [], words: words("true false null yes no on off") };
const TOML: Lang = { line: ["#"], block: [], quotes: ['"""', "'''", '"', "'"], long: ['"""', "'''"], words: words("true false") };
const SQL: Lang = {
  line: ["--"], block: [["/*", "*/"]], quotes: ["'", '"'], long: ["'"], fold: true,
  words: words("select from where and or not in is null as join left right inner outer full cross on group by order having limit offset union all distinct insert into values update set delete create table view index drop alter add with case when then else end exists between like asc desc true false primary key references default"),
};
const CSS: Lang = { line: [], block: [["/*", "*/"]], quotes: ['"', "'"], long: [], words: words("important inherit initial none auto") };

// by extension or a fence's name
const LANGS: Record<string, Lang> = {
  ts: JS, tsx: JS, js: JS, jsx: JS, mjs: JS, cjs: JS, javascript: JS, typescript: JS,
  py: PY, python: PY, sh: SH, bash: SH, zsh: SH, shell: SH,
  json: JSON_, jsonl: JSON_, yaml: YAML, yml: YAML, toml: TOML, sql: SQL, css: CSS,
};

// a path's or a fence name's language; none: null
export function hl_lang(name: string): Lang | null {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return Object.hasOwn(LANGS, ext) ? LANGS[ext]! : null;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]!);
const WORD = /[A-Za-z_$][\w$]*/y;
const NUM = /\d[\w.]*/y;

// where a string opened at i by quote ends: past its closing quote, else
// at its line's end (a quote not in long) or the text's; a backslash
// escapes the next character, but not in shell's '…'
function quote_end(text: string, i: number, quote: string, lang: Lang): number {
  const escapes = !(lang === SH && quote === "'");
  let j = i + quote.length;
  while (j < text.length && !text.startsWith(quote, j) && (lang.long.includes(quote) || text[j] !== "\n")) {
    j += escapes && text[j] === "\\" ? 2 : 1;
  }
  return Math.min(text.length, text.startsWith(quote, j) ? j + quote.length : j);
}

// the text's lines, colored and escaped
export function hl_lines(text: string, lang: Lang): string[] {
  const out: string[] = [""];
  const put = (cls: string, s: string) => s.split("\n").forEach((part, k) => {
    if (k > 0) {
      out.push("");
    }
    out[out.length - 1] += part === "" || cls === "" ? esc(part) : `<span class="${cls}">${esc(part)}</span>`;
  });
  const starts = (at: number, s: string) => text.startsWith(s, at);
  const inword = (at: number) => at > 0 && /[\w$]/.test(text[at - 1]!);
  let i = 0;
  let plain = 0; // where the plain text not yet put starts
  const take = (cls: string, end: number) => {
    put("", text.slice(plain, i));
    put(cls, text.slice(i, end));
    i = plain = end;
  };
  while (i < text.length) {
    const block = lang.block.find(([open]) => starts(i, open));
    const line = lang.line.find((s) => starts(i, s) && !(lang.word && i > 0 && !/\s/.test(text[i - 1]!)));
    const quote = lang.quotes.find((q) => starts(i, q));
    if (block !== undefined) {
      const end = text.indexOf(block[1], i + block[0].length);
      take("c", end < 0 ? text.length : end + block[1].length);
    } else if (line !== undefined) {
      const end = text.indexOf("\n", i);
      take("c", end < 0 ? text.length : end);
    } else if (quote !== undefined) {
      take("s", quote_end(text, i, quote, lang));
    } else if (!inword(i) && (NUM.lastIndex = i, NUM.test(text))) {
      take("n", NUM.lastIndex);
    } else if (!inword(i) && (WORD.lastIndex = i, WORD.test(text))) {
      const end = WORD.lastIndex;
      const w = text.slice(i, end);
      if (lang.words.has(lang.fold ? w.toLowerCase() : w)) {
        take("k", end);
      } else {
        i = end;
      }
    } else {
      i += 1;
    }
  }
  put("", text.slice(plain));
  return out;
}
