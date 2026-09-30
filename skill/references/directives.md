# Pentimento directive reference

Directives are fenced with `:::` on their own lines. A leading bare word is the variant; the rest is `key="value"` attrs. Content inside is markdown unless noted.

Use few. A typical plan has zero to three; the guide explains the budget. Everything here renders quietly (rules and labels, not boxes), so a directive helps only when its structure carries information.

## Callout

```markdown
::: callout decision id=d-source-of-truth
**Markdown is the source of truth.** HTML is a build product.
:::
```

Variants: `decision`, `info`, `warn`, `risk`. Each renders as a rule and a small label beside the text. Give decisions stable ids; they are comment and link anchors. Reserve `decision` for choices that close off an alternative; background and caveats stay in prose.

When a decision is reversed, keep it and point at its replacement:

```markdown
::: callout decision id=d-old superseded-by=d-new
**Old call.** The original rationale stays readable.
:::
```

The render dims it, relabels it "Superseded", and links `#d-new`.

## Verdict

Two to four short answers, shown as a two-column list. One `question :: answer` item per row. Optional: when the answer fits in one sentence, the standfirst carries it better.

```markdown
::: verdict
- Works correctly? :: Partially
- Efficient? :: Convention yes, tooling no
- Portable? :: Yes
:::
```

## Ask (a question the user answers in the page)

A question line, then two or more `- option` lines. Mark at most one `[recommended]`. Give it an `id`; the answer is stored against it.

```markdown
::: ask id=q-merge
How should two edits to the same paragraph merge?
- Keep both, marked as a conflict [recommended]
- Last write wins
:::
```

In the live viewer the options are buttons, plus "Something else…" for a free-text reply. The answer lands in `meta.yml` as a comment with an `answer` field, and `pentimento address` prints it. Once the next draft reflects the answer, resolve the comment and replace the block with the decision it settled. Ask only what changes your next draft, and at most two per draft.

## Findings (audit archetype)

Severity is one of `CRIT`, `HIGH`, `MED`, `LOW`. Everything after `@collapse <label>` folds into a details element.

```markdown
::: findings
- CRIT :: `snapshot` silently overwrites history.
- HIGH :: 3 of 6 real docs are inconsistent.
@collapse Medium and low findings
- MED :: Hardcoded UTC+2 timezone.
- LOW :: History invisible inside Obsidian.
:::
```

The render adds a severity count above the list (`1 critical · 1 high`) and appends the collapsed count to the `@collapse` label, so you don't write either by hand.

## Options (brainstorm scorecard)

One row per option, criteria as columns, exactly one row marked `[pick]`. The `criteria` attr names the columns; cells are separated by ` :: `.

```markdown
::: options criteria="Cold start, Memory, Ops burden"
- **SQLite** [pick] :: 120ms :: 3× RSS :: none
- **Postgres** :: 800ms :: 1× RSS :: daemon to run
:::
```

The picked row is marked, so the comparison carries the recommendation.

## Checklist (verification)

`- [x]` / `- [ ]` items; the render adds a progress line (`2 of 3 done`). Use it when the items will be ticked off across drafts; otherwise a plain list reads better.

```markdown
::: checklist
- [x] All tests green
- [ ] npm publish {#c-npm}
:::
```

## Timeline (phases)

Numbered items; bold title, optional `[next]`/`[later]`/`[done]` status, `—` then description. Use it when phases carry status the reader tracks across drafts.

```markdown
::: timeline
1. **CLI + renderer + skill** [done] — Shipped; loop closes end to end.
2. **Local viewer** [next] — Hono daemon, Tailscale-bound, SSE reload.
3. **Anchored comments** [later] — The Antigravity loop.
:::
```

Once any phase is `done` or `next`, the render adds a progress line (`1 of 3 done · 1 next`).

## Diff (proposed file changes)

Write a plain unified diff (` ` context, `-` removed, `+` added) inside a `txt` fence. It renders side-by-side on desktop and stacks unified on phones. Never paste raw HTML diffs.

````markdown
::: diff head="src/core.ts · refuse to overwrite history"
```txt
 const file = historyFile(next)
-fs.writeFileSync(file, content)
+if (fs.existsSync(file)) throw new Error('refusing to overwrite')
+fs.writeFileSync(file, content, { flag: 'wx' })
```
:::
````

## Flow (diagrams)

The way to draw a box-and-arrow diagram. Write edge chains; the renderer computes the layout. Label an arrow by putting the label inside it: `-(label)->`. Mark emphasized nodes with an `accent:` line. Always set `aria`; it becomes the caption.

```markdown
::: flow aria="Edits go through an operation log before they sync"
Editor -(every keystroke)-> Operation log -> Sync
Sync -(remote edits)-> Editor
accent: Operation log
:::
```

Node names and labels are plain text. Keep diagrams to what a reader needs to follow the prose: a handful of nodes, one direction of flow.

`::: figure` (hand-written SVG) is still rendered for older documents. Don't write new ones: hand-placed coordinates are where diagrams come out misaligned. If `flow` can't express a diagram, describe it in prose.

## Obsidian syntax

Documents written in Obsidian render the way Obsidian shows them:

- `[[Note]]` and `[[Note|label]]` show as the link text (the page can't open other notes), and `![[file]]` as a marked mention.
- `==text==` is highlighted.
- `%% text %%` is hidden, as in Obsidian's reading view. (`%% @c: … %%` is still a comment for the agent, moved into `meta.yml` at snapshot.)
- `> [!note] Title` callouts use the callout styles; `warning`, `caution`, and `attention` render as warnings, `danger`, `error`, `bug`, and `failure` as risks, everything else as a note. `[!type]-` starts folded.
- Footnotes: `text[^1]` with `[^1]: the note` anywhere in the file, numbered in order of first use.

Agents writing plans should prefer the directives and plain markdown, but these are safe to use.

## Headings and ids

```markdown
## Why past HTML plans failed <!-- id: why -->
```

`id` gives the section a stable anchor (default: the slugified title). Add it only when you expect to rename the heading. `###` subheadings take it too. The `eyebrow:` key from earlier releases is ignored.

## Item anchors

Findings, timeline phases, and checklist items take an optional trailing `{#id}` (before the `—` description in a timeline title). It becomes a stable anchor the user's comments and your `resolve` calls can target:

```markdown
- HIGH :: `save()` swallows write errors {#f-save}
1. **Local viewer** [next] {#p-viewer} — Hono daemon.
```

## Swatches

`{dot:impl}` `{dot:brain}` `{dot:audit}` `{dot:design}` render as small colored dots for keying table rows. Rarely needed.

## Generated parts

Never write these; the render computes them: the label, revision, and date line; the latest summary; "What changed since rNNN" with tallies and answered comments; the traces view; the contents rail and its change dots; cuttings; history.

## Frontmatter keys

```yaml
Archetype: plan | implementation | brainstorm | audit | design-doc   # the label above the title
Line Breaks: true | false   # optional; defaults to false for plans, true for documents without an Archetype
```
`Pentimento`, `Current Revision`, and `History Folder` are managed by the CLI; never edit them. `Palette` from earlier releases is ignored.
