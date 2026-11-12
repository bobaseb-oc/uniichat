// Notify test
// ===========
// `bun test Notify.test.ts`. A desktop notification from the terminal:
// how (by UNII_NOTIFY, else the terminal), its escape sequence with no
// control characters a server's text could slip in, osascript's text as
// arguments, never as script.

import { expect, test } from "bun:test";
import * as Notify from "./Notify.ts";

test("the way: UNII_NOTIFY, else iTerm's OSC 9, Terminal's osascript, others OSC 777", () => {
  expect(Notify.notify_way({ UNII_NOTIFY: "off", TERM_PROGRAM: "iTerm.app" })).toBe("off");
  expect(Notify.notify_way({ TERM_PROGRAM: "iTerm.app" })).toBe("osc9");
  expect(Notify.notify_way({ TERM_PROGRAM: "Apple_Terminal" })).toBe("osascript");
  expect(Notify.notify_way({})).toBe("osc777");
  expect(Notify.notify_way({ UNII_NOTIFY: "nonsense" })).toBe("osc777");
});

test("the sequences carry no control characters, OSC 777's title no field separator", () => {
  const evil = "Mgr\x07\x1b]52;c;ZXZpbA==\x07;x\n";
  expect(Notify.notify_osc("osc777", evil, "body\x1b[2J")).toBe("\x1b]777;notify;Mgr]52,c,ZXZpbA==,x;body[2J\x1b\\");
  expect(Notify.notify_osc("osc9", "T", "b\x07")).toBe("\x1b]9;T: b\x1b\\");
});

test("osascript gets the text as arguments, its script fixed", () => {
  const args = Notify.notify_args('a" & do shell script "x', "b");
  expect(args.slice(0, 7)).toEqual(["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", 'a" & do shell script "x']);
  expect(args[7]).toBe("b");
});

// what an alert runs on macOS (Notify.notify_cmds): a distinctive sound
// (UNII_NOTIFY_SOUND: a system sound's name, a sound file's path, or off;
// Hero by default, not Claude Code's hooks' Submarine or Glass), and the
// box: terminal-notifier if there, else osascript (an OSC way draws its
// own); text only ever as arguments
test("an alert's sound and box: by default Hero and the box; a name, a path, or off", () => {
  const none = () => false;
  expect(Notify.notify_cmds("osascript", {}, "Plan ready", "Approve it", none)).toEqual([["afplay", "/System/Library/Sounds/Hero.aiff"], ["osascript", ...Notify.notify_args("Plan ready", "Approve it")]]);
  expect(Notify.notify_cmds("osascript", {}, "T", "B", (c) => c === "terminal-notifier")).toEqual([["afplay", "/System/Library/Sounds/Hero.aiff"], ["terminal-notifier", "-title", "T", "-message", "B", "-group", "legion"]]);
  expect(Notify.notify_cmds("osc777", { UNII_NOTIFY_SOUND: "Funk" }, "T", "B", none)).toEqual([["afplay", "/System/Library/Sounds/Funk.aiff"]]);
  expect(Notify.notify_cmds("osc9", { UNII_NOTIFY_SOUND: "/Users/me/ding.wav" }, "T", "B", none)).toEqual([["afplay", "/Users/me/ding.wav"]]);
  expect(Notify.notify_cmds("osc9", { UNII_NOTIFY_SOUND: "off" }, "T", "B", none)).toEqual([]);
  expect(Notify.notify_cmds("osc9", { UNII_NOTIFY_SOUND: "../../etc; rm" }, "T", "B", none)).toEqual([["afplay", "/System/Library/Sounds/Hero.aiff"]]);
  expect(Notify.notify_cmds("off", {}, "T", "B", none)).toEqual([]);
  expect(Notify.notify_cmds("osascript", {}, "a\x1bb", "c\x07d", (c) => c === "terminal-notifier")[1]).toEqual(["terminal-notifier", "-title", "ab", "-message", "cd", "-group", "legion"]);
});
