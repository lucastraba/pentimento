<p align="center">
  <img src="assets/logo.svg" alt="Pentimento logo" width="112" height="112">
</p>

<h1 align="center">Pentimento</h1>

Pentimento keeps a document as plain markdown, saves a hidden history of the versions you choose to keep, and renders it to one HTML page whose look you don't control. A pentimento is a trace of earlier brushwork visible under the surface of a painting.

Pentimento is deliberately single-user. In its primary loop, one person reviews a plan written by an agent, leaves revision instructions, and sees exactly what changed in the next saved version. It also works without an agent as a version history for one person's evolving documents. It is not a shared editor or team-approval system.

That one mechanism covers two jobs, and you can use either without the other:

- Plans your agent writes: a coding agent produces a reviewable HTML plan, design doc, or audit, and Pentimento fixes how it looks and tracks what changed between drafts.
- Version history for documents you revise: snapshot, diff, and revert any markdown you edit over time, like Obsidian notes, essays, or lyrics.

## How it works

A Pentimento document is one markdown file that keeps its name and place. A snapshot copies the current state into a numbered revision (`r001`, `r002`, …) under a hidden `.history/` folder beside it, with a note on what changed and why. Rendering turns the file into a self-contained HTML page with a table of contents, revision log, six themes, and light and dark modes. From the second revision on, the page also shows a word-level diff against the previous one.

The author, human or agent, writes markdown plus a small set of `:::` directives. A single fixed stylesheet decides every pixel, so two documents built months apart look like the same tool made them, and every draft can be diffed against the last. Everything on disk is plain text: grep it, sync it, commit it, hand it to an agent. Nothing needs git, and nothing conflicts with git.

## Install and run

Pentimento requires Node 20.13 or newer. Start the viewer without installing anything:

```bash
npx -y pentimento@latest serve .
```

Or install it globally:

```bash
npm install -g pentimento
```

Start the globally installed viewer:

```bash
pentimento serve .
```

List every command and flag:

```bash
pentimento --help
```

Open the URL printed in the terminal. Rendered pages make no outside requests.

## Write plans with an agent

Pentimento works with Claude Code, opencode, and Codex. Install the small authoring skill for the agent you use.

For Claude Code:

```bash
npx -y pentimento@latest skill install ~/.claude/skills
```

For opencode or Codex:

```bash
npx -y pentimento@latest skill install ~/.agents/skills
```

Then ask: *"Write an implementation plan for X as a Pentimento document."*

The skill tells the agent to research the task, write the markdown, lint it, save the first revision, and start the viewer in the background. The agent should give you the local viewer URL. You do not need to run the render command yourself.

Select text in the viewer to leave a comment, then tell the agent: *"I left comments."* It reads the comments, revises the markdown, and saves another revision. The page updates in place and shows what changed.

If the agent runs on a VPS, it can bind the viewer to that machine's Tailscale address:

```bash
pentimento serve . --tailscale
```

Pentimento protects every non-loopback bind and prints a write link plus a read-only link. The write link carries a fresh capability; opening it once stores that capability in an HttpOnly, same-site browser cookie and redirects to a clean URL. Send the write link only to the user who will leave revision instructions. This is remote access to the private user-agent loop, not a shared workspace. Keep the viewer inside the tailnet; Pentimento is not a public hosting service.

Each `serve` command starts one server on one port and serves every Pentimento document under the selected directory. Closing a browser tab does not stop it. A writable viewer includes a **Stop viewer** button; after confirmation it closes that server and every document on its port. Read-only links cannot stop a server, and other Pentimento processes on other ports are unaffected.

The installed skill defers to the version-matched instructions in the CLI. Check whether a copy is current with:

```bash
pentimento skill check ~/.claude/skills
```

## Themes

Every rendered page includes Verdigris, Mist, Iris, Parchment, Fjord, and High Contrast, each with Auto, Light, and Dark modes. The picker stores an explicit browser choice locally; **Use document default** clears that override.

Set a personal default once from the CLI:

```bash
pentimento config theme iris
```

Show the current default and available themes:

```bash
pentimento config theme
```

Return to the built-in default:

```bash
pentimento config theme reset
```

The personal setting is stored in `~/.config/pentimento/config.json`. Default precedence is: document `Palette` frontmatter, `PENTIMENTO_PALETTE`, personal CLI config, then built-in Verdigris. An explicit choice in the browser sits above those until you use **Use document default**. Reload after changing the config. Restart an older viewer process once if it still shows the compact three-theme picker.

## Version your own documents

The same engine works on anything you revise seriously, with no agent and no HTML.

Save the first revision:

```bash
pentimento snapshot Notes.md --summary "Initial draft"
```

Edit the markdown, then save another revision:

```bash
pentimento snapshot Notes.md --summary "Rewrote the opening" --why "Buried the point"
```

List the revisions:

```bash
pentimento list Notes.md
```

Compare the latest two:

```bash
pentimento diff Notes.md
```

Restore an older revision while keeping the restoration as a new one:

```bash
pentimento revert Notes.md r001
```

Snapshots land in a hidden `.history/` next to the file, which keeps them out of the way in Obsidian. The viewer browses revisions and diffs. The `--author` flag defaults to your git `user.name`.

```bash
pentimento serve .
```

To create a standalone HTML file instead:

```bash
pentimento render Notes.md
```

## Writing documents

A document takes two optional frontmatter keys:

```yaml
---
Archetype: implementation   # implementation | brainstorm | audit | design-doc
Palette: iris               # verdigris | mist | iris | parchment | fjord | contrast
---
```

Rich elements come from `:::` directives: callouts, verdict banners, severity-graded findings, phase timelines, side-by-side diffs, and constrained SVG figures. The CLI has version-matched writing references.

Directive syntax:

```bash
pentimento guide directives
```

Section skeletons by document type:

```bash
pentimento guide archetypes
```

Prose rules and examples:

```bash
pentimento guide style
```

The same references are in [`skill/references/`](skill/references/).

Each archetype leads with a verdict banner so a reader gets the recommendation before the evidence. The renderer computes the glance-level summaries: a severity tally above `::: findings`, a progress meter above `::: timeline`. On wide screens the table of contents becomes a fixed side rail; a print stylesheet, sticky table headers, and a light/dark toggle come with every render.

Four rules keep the output consistent: no custom CSS, no inline styles, no scripts, no hand-written HTML. When a document needs something the vocabulary can't say, the vocabulary grows in a tool release rather than in the document.

## The review loop

Start the viewer and open a document:

```bash
pentimento serve .
```

Select text and a comment button appears. The saved comment includes the quote and surrounding context, so it can find the text again after a section moves. The comment button in the bottom bar opens the drawer. When the agent revises the file, the page updates without a reload and preserves a half-written comment.

List comments:

```bash
pentimento comments Plan.md
```

Format open comments for an agent:

```bash
pentimento address Plan.md
```

Reply without revising the document:

```bash
pentimento reply Plan.md c-2026-07-08-001 --text "..."
```

Resolve a comment against the revision that fixed it:

```bash
pentimento resolve Plan.md c-2026-07-08-001 --rev r003
```

You can also comment without the viewer:

```bash
pentimento comment Plan.md --text "..." --quote "..."
```

Inline `%% @c: a note %%` markers are another option. Snapshot moves them into `meta.yml`.

## Checking consistency

Check every document's frontmatter against its history and metadata:

```bash
pentimento verify <file-or-dir>
```

Lint prose for promotional words, false contrast, engagement hooks, bold-lead bullets, and em-dash density:

```bash
pentimento lint <doc>
```

Use strict mode in CI:

```bash
pentimento lint <doc> --strict
```

## Design lineage

The markdown-source, HTML-view split answers Thariq Shihipar's *Unreasonable Effectiveness of HTML* and its critics. The anchored-comment loop follows Google Antigravity's artifact comments, narrowed to one user's revision conversation with an agent. The `:::` directives are Pandoc/Quarto-style fenced divs on purpose. Pentimento's own plan is written with Pentimento; see [`PLAN.md`](PLAN.md) and its `.history/`.

## Status

The current npm release is v0.5.0. Main contains the unreleased 0.6 hardening work. Known limits in v0.5.0: directives don't nest, Windows is untested, and hostile markdown is not a supported input. Documents created under the tool's earlier name (`Vellum: true` frontmatter) are read as-is and migrated on their next snapshot.

MIT © Lucas Traba
