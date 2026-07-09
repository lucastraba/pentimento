# Pentimento

Pentimento keeps a document as plain markdown, saves a hidden history of the versions you choose to keep, and renders it to one HTML page whose look you don't control. A pentimento is a trace of earlier brushwork visible under the surface of a painting.

That one mechanism covers two jobs, and you can use either without the other:

- Plans your agent writes: a coding agent produces a reviewable HTML plan, design doc, or audit, and Pentimento fixes how it looks and tracks what changed between drafts.
- Version history for documents you revise: snapshot, diff, and revert any markdown you edit over time, like Obsidian notes, essays, or lyrics.

## What it is

A Pentimento document is one markdown file that keeps its name and place. `pentimento snapshot` copies the current state into a numbered revision (`r001`, `r002`, …) under a hidden `.history/` folder beside it, with a note on what changed and why. `pentimento render` turns the file into a self-contained HTML page (table of contents, revision log, light and dark themes), and from the second revision on it adds a panel showing a word-level diff against the previous one.

The author, human or agent, writes markdown plus a small set of `:::` directives. A single fixed stylesheet decides every pixel, so two documents built months apart look like the same tool made them, and every draft can be diffed against the last. Everything on disk is plain text: grep it, sync it, commit it, hand it to an agent. Nothing needs git, and nothing conflicts with git.

## Requirements

Node 20.13+. The CLI runs with no install through `npx -y pentimento@latest <command>`, or install it once with `npm install -g pentimento`. Rendered pages make no outside requests.

## Write plans with your agent

Your agent writes the plan; Pentimento owns the look and the diff between drafts. Works with Claude Code, opencode, and Codex.

1. Install the skill into your agent's skills folder (one command, nothing else to configure):

   ```bash
   npx -y pentimento@latest skill install ~/.claude/skills   # Claude Code
   npx -y pentimento@latest skill install ~/.agents/skills   # opencode or Codex
   ```

2. Ask for a plan: *"Write an implementation plan for X as a Pentimento document."* The agent picks an archetype, writes the markdown, snapshots it, and renders the HTML.

3. View it: run `pentimento serve .` and open the printed URL. The viewer has the revision picker, diffs, and select-to-comment. For a static file to email or upload instead, `pentimento render Plan.md` writes standalone HTML.

4. Give feedback: select text in the viewer to leave a comment, then tell the agent *"I left comments."* It revises, snapshots again, and the new render shows a "what changed" panel so you see what moved.

Giving it to your team: each person runs the one `skill install` command. The skill keeps pace with the tool on its own: it defers to `pentimento guide`, which prints instructions matched to the installed version, so an old copy never hides new features. `pentimento skill check <dir>` reports when a copy has fallen behind.

## Version your own documents

The same engine works on anything you revise seriously, with no agent and no HTML.

```bash
pentimento snapshot Notes.md --summary "Initial draft"
# ...edit Notes.md over days or months...
pentimento snapshot Notes.md --summary "Rewrote the opening" --why "Buried the point"
pentimento list Notes.md            # every kept revision, with its note
pentimento diff Notes.md            # word-level diff of the last two
pentimento revert Notes.md r001     # restore an earlier version, kept as a new revision
```

Snapshots land in a hidden `.history/` next to the file (Obsidian keeps it out of the way), so your vault stays exactly as it was plus a memory of why the chorus changed. `pentimento render Notes.md` gives the HTML view with the same "what changed" panel; `pentimento serve .` browses revisions and diffs in the viewer. `--author` defaults to your git `user.name`.

## Writing documents

A document takes two optional frontmatter keys:

```yaml
---
Archetype: implementation   # implementation | brainstorm | audit | design-doc
Palette: iris               # iris | verdigris | mist
---
```

Rich elements come from `:::` directives: callouts, verdict banners, severity-graded findings, phase timelines, side-by-side diffs, constrained SVG figures. Run `pentimento guide directives` for the full syntax, `pentimento guide archetypes` for a section skeleton per document type, and `pentimento guide style` for the prose register (also on disk at [`skill/references/`](skill/references/)).

Each archetype leads with a verdict banner so a reader gets the recommendation before the evidence. The renderer computes the glance-level summaries: a severity tally above `::: findings`, a progress meter above `::: timeline`. On wide screens the table of contents becomes a fixed side rail; a print stylesheet, sticky table headers, and a light/dark toggle come with every render.

Four rules keep the output consistent: no custom CSS, no inline styles, no scripts, no hand-written HTML. When a document needs something the vocabulary can't say, the vocabulary grows in a tool release rather than in the document.

## The review loop

Run `pentimento serve .` and open a document. Select any text and a comment button appears; the form opens next to your selection, the quote highlights the moment you save, and a toast confirms the save with an Undo. The comment lands in `meta.yml` with the quoted text and surrounding context, so it stays attached even after the section moves — highlights find their text again even across bold, links, or paragraph breaks. A drawer (💬 in the bottom bar) lists open and resolved comments with jump-to-text, resolve/reopen, one level of replies, and delete for comments you made this session. When the agent revises the file, the page updates in place — no reload, and a half-typed comment survives. Static renders show open comments as a panel in the header instead.

```bash
pentimento comments Plan.md               # list comments
pentimento address Plan.md                # open comments, formatted for an agent to act on
pentimento reply Plan.md c-2026-07-08-001 --text "..."   # answer without revising
pentimento resolve Plan.md c-2026-07-08-001 --rev r003   # close one against the revision that fixed it
```

You can also comment without the viewer (`pentimento comment Plan.md --text "..." --quote "..."`) or leave inline `%% @c: a note %%` markers in the markdown, which snapshot pulls into `meta.yml`.

## Checking consistency

`pentimento verify <file-or-dir>` cross-checks every document's frontmatter against its history files and meta entries and exits nonzero when they drift, so it fits in CI.

`pentimento lint <doc>` flags AI-register writing tells: promotional words, false contrast, engagement hooks, bold-lead bullets, and em-dash density. Snapshot prints the warning count so a slip is visible before it ships; `pentimento lint --strict` exits nonzero for CI. The rules back the prose section of `pentimento guide`.

## Design lineage

The markdown-source, HTML-view split answers Thariq Shihipar's *Unreasonable Effectiveness of HTML* and its critics. The anchored-comment loop follows Google Antigravity's artifact comments. The `:::` directives are Pandoc/Quarto-style fenced divs on purpose. Pentimento's own plan is written with Pentimento; see [`PLAN.md`](PLAN.md) and its `.history/`.

## Status

v0.4. Young project, released and versioned tooling. Known limits: directives don't nest, Windows is untested, and while the renderer strips active content from figures, rendering hostile markdown is not a supported case. Documents created under the tool's earlier name (`Vellum: true` frontmatter) are read as-is and migrated on their next snapshot.

MIT © Lucas Traba
