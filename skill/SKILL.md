---
name: pentimento-plan
description: "Produce and serve a plan as a living document: markdown source, versioned history, and a constrained interactive viewer. Use when the user asks for a plan, design doc, brainstorm, audit report, or invokes /pentimento-plan. Also for revising an existing Pentimento plan after feedback."
metadata:
  pentimento_skill_revision: "9"
---

# Pentimento plans

A Pentimento plan is one canonical markdown file with hidden revision history and a deterministic HTML render. You write **markdown + directives only** — the toolchain owns every pixel.

This file is deliberately thin so it can't go stale. The step-by-step loop, directive vocabulary, archetypes, and flags live in the CLI itself and are printed, version-matched, by `pentimento guide`. Read that before authoring.

## Running the CLI

Every `pentimento …` command here needs the CLI resolved once at the start of a task:

- If `pentimento` is already on PATH (globally installed), use it as-is.
- Otherwise run it through npx with no install: replace `pentimento` with `npx -y pentimento@latest`.

Check with `command -v pentimento`. Prefer an existing install — it's faster and pins a known version; npx is the zero-setup fallback. Requires Node ≥20.13 either way.

## Hard rules

- Never write CSS, `<style>`, `style=""` attributes, or JavaScript. No exceptions.
- Never hand-write the HTML output. `pentimento render` is the only way to produce it.
- Rich elements come only from the directive vocabulary in `pentimento guide` — nothing else.
- Diagrams default to `::: flow` (edge chains, layout computed). One inline-SVG figure is allowed per `::: figure` block, composed only of `theme.css` classes (`nodebox`, `accentbox`, `flow`, `lbl`) — use it only when `flow` can't say it.
- The markdown plan is what the user approves; the HTML is how they read it.
- Assume one user and one canonical document. Comments are that user's revision instructions to the agent, not a multi-reviewer thread.
- Use `--tailscale` only when the agent runs on a VPS and the same user needs the private live viewer on another trusted device. Send that user the printed write link; the plain link is read-only. It is remote access, not a shared workspace.
- Serve the plan after the first snapshot and give the user the printed viewer URL. This is the default delivery path. Render a standalone file only when the user asks for one or a server cannot stay running.
- Reuse one `serve` process for every plan under the same workspace root. Tell the user that **Stop viewer** closes every plan on that server, while separate servers on other ports remain independent.
- The Prose rules in `pentimento guide` bind like the rules above: plain words, no false contrast, no engagement hooks, bullets that carry full claims.

## Authoring

Run `pentimento guide` and follow it — it is the source of truth for the installed version and may describe features newer than this file. Deep topics:

- `pentimento guide directives` — full directive syntax and examples.
- `pentimento guide archetypes` — section skeletons per archetype.
- `pentimento guide style` — the prose register, shown by before/after example.

Do not stop after writing or snapshotting the markdown. Start `pentimento serve .` as a tracked background process, verify the printed URL responds, and include that URL in the handoff. Keep the process running for the feedback loop.

If this file drifts from the installed CLI, `pentimento skill check` reports it and `pentimento skill install` refreshes it.
