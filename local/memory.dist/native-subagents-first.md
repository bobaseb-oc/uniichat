---
name: native-subagents-first
description: "In Legion features, start native Legion subagents; Claude Code workers only as an opt-in option"
metadata:
  type: feedback
---

When a Legion feature starts agents (the cockpit's Review/Fix, routines, automations), start native Legion subagents (Tools.start, tier worker or manager). Offer Claude Code workers only as an explicit option, e.g. an "as Claude Code workers" tick that starts a manager told to spawn as "claude".

**Why:** Legion's own hierarchy (orchestrator, managers, workers) does the work; Claude Code is a fallback tool, not the default path.

**How to apply:** default to tier worker for single-task agents (one PR, one routine run). Never make Claude Code the default path, and keep the orchestrator unable to spawn Claude Code directly (managers only). Related: [[check-a-change]]
