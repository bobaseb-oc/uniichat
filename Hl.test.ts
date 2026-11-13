// Hl: a file's lines colored (the files pane), escaped
import { expect, test } from "bun:test";
import { hl_lang, hl_lines } from "./Hl.ts";

test("hl_lang: by a file's extension or a fence's name; none: null", () => {
  expect(hl_lang("src/a.ts")).not.toBeNull();
  expect(hl_lang("x/run.PY")).toBe(hl_lang("py"));
  expect(hl_lang("a.tsx")).toBe(hl_lang("a.ts"));
  expect(hl_lang("notes.txt")).toBeNull();
  expect(hl_lang("constructor")).toBeNull();
});

test("hl_lines: keywords, strings, numbers, comments, each line whole and escaped", () => {
  const ts = hl_lang("a.ts")!;
  expect(hl_lines('const a = "<b>"; // hi & bye\nreturn 42;', ts)).toEqual([
    '<span class="k">const</span> a = <span class="s">&quot;&lt;b&gt;&quot;</span>; <span class="c">// hi &amp; bye</span>',
    '<span class="k">return</span> <span class="n">42</span>;',
  ]);
  // a block comment and a template string over lines: each line's span closed
  expect(hl_lines("/* a\nb */ x", ts)).toEqual(['<span class="c">/* a</span>', '<span class="c">b */</span> x']);
  expect(hl_lines("`a\nb`", ts)).toEqual(['<span class="s">`a</span>', '<span class="s">b`</span>']);
  // an escaped quote stays in its string; a plain string ends at its line
  expect(hl_lines('"a\\"b" c', ts)).toEqual(['<span class="s">&quot;a\\&quot;b&quot;</span> c']);
  expect(hl_lines('"open\nnext', ts)).toEqual(['<span class="s">&quot;open</span>', "next"]);
  // a word holding a keyword, a number inside a name: not colored
  expect(hl_lines("constant x1", ts)).toEqual(["constant x1"]);
  // python's triple strings and # comments; sql's keywords any case
  expect(hl_lines('"""a\nb""" # c', hl_lang("py")!)).toEqual(['<span class="s">&quot;&quot;&quot;a</span>', '<span class="s">b&quot;&quot;&quot;</span> <span class="c"># c</span>']);
  expect(hl_lines("select 1 -- x", hl_lang("q.sql")!)).toEqual(['<span class="k">select</span> <span class="n">1</span> <span class="c">-- x</span>']);
  // shell: # starts a comment only as a word, not inside one ($#, a#b)
  expect(hl_lines("echo $# a#b # c", hl_lang("x.sh")!)).toEqual(['<span class="k">echo</span> $# a#b <span class="c"># c</span>']);
  // a trailing newline: no empty last line kept by the caller's split
  expect(hl_lines("a\n", ts)).toEqual(["a", ""]);
});
