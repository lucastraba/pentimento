# Vellum

**Living documents for humans and agents.** One canonical markdown file, hidden revision history beside it, and a deterministic HTML render your agent can't make ugly.

Vellum exists because AI agents given free-form HTML produce slop, and plans that get revised three times become unreviewable. The fix for both is the same architecture:

> **The agent gets a vocabulary, not a paint palette.** Agents write markdown plus a small directive set; a deterministic renderer and one fixed stylesheet own every pixel. Flexibility comes from choosing a plan archetype and its components — consistency comes from everything else being non-negotiable.

## What you get

- **One file, versioned in place.** `Plan.md` stays at a stable, searchable name. Meaningful versions snapshot into `.history/Plan/r001.md, r002.md…` with an append-only `meta.yml` recording *what changed and why* — a decision log, not just diffs.
- **A rendered view that stays designed.** `vellum render` turns the markdown into a self-contained, responsive HTML page: header ribbon with archetype badge, collapsible table of contents, the decision log as an evolution strip, and three switchable palettes (Iris, Verdigris, Mist) with light/dark variants. No CDNs, no external requests — one portable file.
- **"What changed" built in.** Every render embeds a collapsible word-level diff of the latest revision, with unchanged sections collapsed — a reader never has to ask the agent what it just modified. `vellum diff <doc> rA rB --html` renders the same view for any revision pair.
- **A consistency checker.** `vellum verify <dir>` cross-checks canonical frontmatter, history files, and meta entries — run it in CI and version drift becomes impossible to miss.
- **Agent-native by contract.** The CLI is the whole API. A skill definition (`skill/`) teaches any coding agent the loop: write markdown against an archetype skeleton → `snapshot` → `render` → publish. Works with Claude Code out of the box; portable to anything that can run a command.

## Quickstart

```bash
git clone <this repo> && cd vellum
npm install && npm run build && npm link

# in any project:
vellum snapshot Plan.md --summary "Initial draft" --author you
vellum render Plan.md            # → plan.html, open it anywhere
# ...revise Plan.md...
vellum snapshot Plan.md --summary "Tightened scope after review" --why "Feedback round 1"
vellum render Plan.md            # same page, now with a "What changed" panel
vellum diff Plan.md              # terminal diff of the latest two revisions
vellum verify .                  # check every Vellum doc in the repo
```

## Writing documents

A Vellum document is plain markdown with frontmatter:

```yaml
---
Archetype: implementation   # implementation | brainstorm | audit | design-doc
Palette: iris               # optional: iris | verdigris | mist
---
```

Rich elements come from directives — see [`skill/references/directives.md`](skill/references/directives.md) for the full vocabulary (callouts, verdict banners, severity-graded findings, phase timelines, side-by-side diffs, constrained SVG figures) and [`skill/references/archetypes.md`](skill/references/archetypes.md) for the section skeletons per document type.

The hard rules that keep output consistent: no custom CSS, no inline styles, no scripts, no hand-written HTML output. If a document needs something the vocabulary can't say, the vocabulary grows — per tool release, not per document.

## Design lineage

Markdown-source/HTML-view synthesis after Thariq Shihipar's *Unreasonable Effectiveness of HTML* and its critics; anchored-comment review loop (planned) after Google Antigravity's artifact comments; `:::` directives are Pandoc/Quarto-style fenced divs on purpose. Vellum's own plan is maintained with Vellum — see [`PLAN.md`](PLAN.md) and its `.history/`.

## Status

Personal tooling hardening toward a public release. Known limits: directives don't nest; the sanitizer strips active content from figures but rendering *hostile* markdown is not a supported use case yet; Windows is untested. Roadmap: local viewer daemon (hot reload, revision picker), then anchored comments (`vellum address`).

MIT © Lucas Traba
