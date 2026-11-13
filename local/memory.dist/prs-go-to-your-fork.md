---
name: prs-go-to-your-fork
description: "This Legion checkout is a fork whose GitHub parent is VictorTaelin/uniichat; gh defaults to the parent, so always pass --repo"
metadata:
  type: reference
---

Legion is a fork of `VictorTaelin/uniichat`, a stranger's repo. `gh pr create`, `gh pr list` and `gh pr view` default to a fork's parent, so without `--repo` a PR would open there.

**How to apply:** always pass `--repo <owner>/uniichat` (your fork, the `origin` remote) to gh PR commands. Branch off `main` for new work, and delete the branch once its PR is merged. Fill in your fork's name when you install this note.
