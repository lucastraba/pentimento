---
name: pentimento-plan
description: "Write a plan, design doc, brainstorm, or audit as a Pentimento document: one markdown file with saved drafts, served as a page the user reads, comments on, and approves. Use when the user asks for a plan or design doc they will review over several rounds, or invokes /pentimento-plan. Also for revising an existing Pentimento document after comments."
metadata:
  pentimento_skill_revision: "10"
---

# Pentimento plans

A Pentimento document is one markdown file. Each saved draft goes into a hidden history, and the page the user reads shows what changed since the last draft and which of their comments it answered. You write markdown and a few `:::` directives; the tool decides how the page looks.

This file is deliberately short. The version-matched instructions live in the CLI: run `pentimento guide` before writing and follow it.

## Running the CLI

- If `pentimento` is on PATH, use it.
- Otherwise use `npx -y pentimento@latest` in its place.

Check with `command -v pentimento`. Node 20.13 or newer either way.

## Rules

- Write markdown and directives only. No CSS, no `style=""`, no scripts, no HTML. `pentimento render` and `pentimento serve` produce the page.
- Most of the document is prose. Use a directive only where it says something prose can't, and use few of them. `pentimento guide` gives the budget.
- The markdown is what the user approves. Revise the markdown, then save a draft with `pentimento snapshot`.
- One user, one document. Comments are that user's instructions to you.
- After the first snapshot, start `pentimento serve .` in the background (reuse a running one), check that the URL responds, and give the user the URL.
- Use `--tailscale` only when you run on a remote machine and the same user opens the page from another trusted device. Send them the printed write link.

## Writing

`pentimento guide` covers the loop. Deeper pages:

- `pentimento guide style`: two complete example documents in the register to write in. Read at least one before your first draft.
- `pentimento guide archetypes`: suggested section outlines.
- `pentimento guide directives`: directive syntax.

If this file and the CLI disagree, the CLI wins. `pentimento skill check` reports a stale copy and `pentimento skill install` refreshes it.
