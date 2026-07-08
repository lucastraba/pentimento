# Pentimento

Living documents for humans and AI agents: one canonical markdown file, revision history in a hidden folder beside it, and a deterministic HTML render.

A pentimento is a trace of earlier brushwork visible under the surface of a painting.

## Why

Two problems led here.

Plans that get revised stop being reviewable. By the third revision nobody remembers what changed or why, so the reader either re-reads the whole document or asks the author.

And agents asked to produce HTML directly produce visual noise. Every page comes out different, none of them look owned, and the iterations can't be diffed.

Pentimento treats both as the same problem. The author, human or agent, writes markdown plus a small set of directives. A renderer with one fixed stylesheet decides how everything looks. Meaningful versions are snapshotted into numbered revisions with a note about what changed and why, and each render embeds a word-level diff against the previous revision, so the reader sees exactly what moved.

## Install

```bash
npm install -g pentimento
```

Node 20.13+ (the viewer's recursive file watch needs it). Rendered pages make no external requests.

## Quickstart

```bash
pentimento snapshot Plan.md --summary "Initial draft"
pentimento render Plan.md          # → plan.html, open it anywhere
# ...revise Plan.md...
pentimento snapshot Plan.md --summary "Tightened scope" --why "Feedback round 1"
pentimento render Plan.md          # same page, now with a "What changed in r002" panel
pentimento diff Plan.md            # terminal diff of the latest two revisions
pentimento serve .                 # local viewer: revision picker, diffs, comments
pentimento verify .                # consistency check, exits nonzero for CI
```

`--author` defaults to your git `user.name`.

## How it works

Your file, say `Plan.md`, keeps its name and location. `pentimento snapshot` copies the current state to `.history/Plan/r001.md`, `r002.md` and so on, and appends an entry (summary, why, author, timestamp) to an append-only `.history/Plan/meta.yml`. Everything is a plain text file. You can grep the history, sync it, commit it, or hand it to an agent. Nothing about it requires git, and nothing about it conflicts with git.

`pentimento render` produces a single self-contained HTML page: table of contents, the revision log as an evolution strip, an archetype badge, light and dark themes, three switchable palettes. The "What changed" panel appears from the second revision on, with unchanged sections collapsed. `pentimento diff <doc> rA rB --html` renders the same word-level view for any two revisions.

`pentimento verify <dir>` cross-checks every document's frontmatter against its history files and meta entries, and fails loudly when they drift.

## Comments and the review loop

Run `pentimento serve .` and open a document. Select any text and a comment button appears; the comment is saved to `meta.yml` with the quoted text and surrounding context, so it stays attached even after the section moves. Open comments render as a panel on the page with the quotes highlighted in place.

For the other side of the loop:

```bash
pentimento comments Plan.md               # list comments
pentimento address Plan.md                # print open comments, formatted for an agent to act on
pentimento resolve Plan.md c-2026-07-08-001 --rev r003   # close a comment against the revision that fixed it
```

You can also comment without the viewer (`pentimento comment Plan.md --text "..." --quote "..."`) or leave inline `%% @c: a note %%` markers in the markdown, which snapshot extracts into `meta.yml`.

## Writing documents

A Pentimento document is markdown with two optional frontmatter keys:

```yaml
---
Archetype: implementation   # implementation | brainstorm | audit | design-doc
Palette: iris               # iris | verdigris | mist
---
```

Rich elements come from `:::` directives: callouts, verdict banners, severity-graded findings, phase timelines, side-by-side diffs, constrained SVG figures. The full vocabulary is in [`skill/references/directives.md`](skill/references/directives.md), and [`skill/references/archetypes.md`](skill/references/archetypes.md) has a section skeleton per document type.

The rules that keep output consistent: no custom CSS, no inline styles, no scripts, no hand-written HTML. If a document needs something the vocabulary can't say, the vocabulary grows in a tool release, not in a document.

## For writers

The same mechanics work for anything you revise seriously: song lyrics, essays, long-lived notes. The file stays where your other files are (Obsidian vaults work well, and `.history/` stays hidden there), every draft you cared enough to name is preserved, and `meta.yml` remembers why you changed the chorus.

## For agents

Point your agent at [`skill/SKILL.md`](skill/SKILL.md); for Claude Code, drop it in `.claude/skills/`. The contract: write markdown against an archetype skeleton, snapshot with a reader-facing summary, render, publish. On feedback, revise and snapshot again; the render shows the reviewer what moved. Comments left in the viewer come back through `pentimento address`.

## Design lineage

The markdown-source, HTML-view split is a response to Thariq Shihipar's *Unreasonable Effectiveness of HTML* and its critics. The anchored-comment loop follows Google Antigravity's artifact comments. The `:::` directives are Pandoc/Quarto-style fenced divs on purpose. Pentimento's own plan is maintained with Pentimento; see [`PLAN.md`](PLAN.md) and its `.history/`.

## Status

v0.3. Young project, released tooling. Known limits: directives don't nest, Windows is untested, and while the renderer strips active content from figures, rendering hostile markdown is not a supported use case. Documents created under this tool's earlier name (`Vellum: true` frontmatter) are read as-is and migrated on their next snapshot.

MIT © Lucas Traba
