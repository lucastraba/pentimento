---
Archetype: design-doc
Pentimento: true
Current Revision: r001
History Folder: .history/PLAN
---

# Pentimento — Living Documents

> One canonical markdown file, hidden revision history, deterministic rendering. The author writes content; the system owns the pixels.

## Why <!-- id: why; eyebrow: Diagnosis -->

Agent-generated HTML is slop because the agent is handed a *paint palette*. Plans revised three times are unreviewable because nothing records what moved, or why. Pentimento inverts both: a deterministic renderer, a fixed design system, a small directive vocabulary, and numbered snapshots with an append-only decision log. Any agent — or any human — produces markdown plus directives; the toolchain produces the view and the history.

## Decisions <!-- id: decisions; eyebrow: Locked -->

::: callout decision id=d-source-of-truth
**Markdown is the source of truth.** HTML is a build product. Reviews approve the markdown; the render is how readers read it.
:::

::: callout decision id=d-vocabulary
**Vocabulary, not palette.** Agents never write CSS, inline styles, or scripts. Rich elements come from `:::` directives; if the vocabulary can't say it, the vocabulary grows per release, not per document.
:::

::: callout decision id=d-plain-files
**History is plain files.** `.history/<doc>/rNNN.md` + `meta.yml`, readable by grep, git, agents, and humans — no database, no proprietary blob.
:::

::: callout decision id=d-name
**Renamed from Vellum to Pentimento.** The Vellum namespace is crowded (a funded AI platform, a book-formatting tool, and a since-rebranded artifact host all share it). Legacy `Vellum: true` docs are read transparently and migrated on their next snapshot.
:::

## Shipped <!-- id: shipped; eyebrow: Done -->

::: timeline
1. **CLI core + design system + renderer + skill** [done] — `snapshot`/`list`/`diff`/`revert`/`render`/`verify`, one stylesheet with three palettes, deterministic markdown→HTML with embedded "what changed" word-diffs.
2. **Local viewer** [done] — `pentimento serve`: document index, revision picker, per-revision rendering, diff pages, SSE hot reload. Binds 127.0.0.1 by default; refuses 0.0.0.0.
3. **Anchored comments** [done] — select text in the viewer → comment saved to `meta.yml` with quote + context (survives revisions). `pentimento address` / `resolve` close the loop for agents.
4. **Public release prep** [done] — renamed to Pentimento, `npm i -g` install story, author defaults from git config, legacy-marker migration.
:::

## Release roadmap <!-- id: release; eyebrow: Next -->

::: timeline
1. **Publish** [next] — npm publish, GitHub repo public, CI green on macOS + Linux (+ Windows leg).
2. **Demo surface** [next] — GitHub Pages rendering this plan; a 30-second snapshot→render→what-changed GIF in the README.
3. **Distribution** [later] — Claude Code plugin packaging for the skill; Show HN framed against free-form agent HTML; Obsidian community post for the writer audience.
:::

## Open questions <!-- id: open; eyebrow: Unresolved -->

- Comment transport from *published* pages (the local viewer has an obvious path; a static page doesn't).
- Whether directive nesting is worth the renderer complexity it invites.
- Mermaid: deferred — diagrams are constrained inline SVG via `::: figure`; revisit if hand-composed SVG becomes the bottleneck.
