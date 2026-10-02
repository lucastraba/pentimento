# Changelog

## Unreleased

### Added

- Images. A local image renders in the page, as a figure when it is alone in its paragraph (its title becomes the caption), and `![[shot.png]]` embeds are found the way Obsidian finds them. A static page carries each image once, inside the page; the live viewer serves them by content hash.
- Each draft keeps the images it was saved with, in `.history/<name>/assets/`, and its `meta.yml` entry records which copy each path pointed to. Stepping back to a draft shows its pictures. A new screenshot at the same path shows in "What changed" as both versions side by side, traces fold the old image under the new one, and removed images appear under cuttings. `revert` puts a draft's images back, storing any file it overwrites first, and `verify` reports a stored image that has gone missing.
- A new screenshot with no markdown edit counts as an unsaved change, and the viewer updates when an image file changes.
- Comments on images. In the viewer, click an image to comment on all of it, or drag across it to mark a part; on a phone, tap the image, then drag while the comment is open. The mark stays on the image until a draft replaces it, and then the comment links to the draft that had it. `pentimento address` prints the image's file and the marked part in pixels.
- Lint warns about images that are missing, remote, outside the document's folder, in an unsupported format, over 1 MB, or without alt text. Snapshot warns when an image it should save isn't there.
- `pentimento guide` covers mocks and prototypes: build them as HTML, screenshot them headlessly, and embed the screenshots. Skill revision 12.
- History folders by any name, for vaults where `.history` can't be used (Obsidian Sync skips hidden folders): with `History Folder: _history/<note>`, `untrack` and the plugin's "Remove drafts" clean up an empty `_history` folder as they do `.history`, and the viewer's index and `verify` no longer list the saved drafts inside it as documents.

### Fixed

- The viewer no longer crashes when the machine runs out of file watchers. It watches folders instead of every file, skips `node_modules`, `.git`, `dist`, Python environments, and other tool folders, and when a folder can't be watched it says so once and keeps serving without live updates for that folder. Over a folder of 16 repositories this is 6,124 watches instead of 519,544.

### Changed

- `renderDiffHtml` in `pentimento/semdiff` takes an optional third argument with image URLs and labels. Bodies without images render as before.

## 0.12.1 - 2026-10-02

### Fixed

- In "What changed", a heading that was added, removed, or renamed shows as a section label (new ones marked, removed ones struck through) instead of raw `## Heading` text under the previous section.

## 0.12.0 - 2026-10-01

### Added

- The [Obsidian plugin](https://github.com/lucastraba/pentimento-obsidian), in its own repository: save drafts from Obsidian (ribbon button, commands, optional daily drafts), the latest draft in the status bar, and a panel with changes, every draft (with restore), and cuttings. The panel shows and hides with a command, the status bar, or its own button. It works on mobile.
- `pentimento/drafts`, `pentimento/model`, and `pentimento/semdiff` are importable, with type declarations. The Obsidian plugin uses them, so the draft format has one implementation.
- Taking a note out of Pentimento: `pentimento untrack <doc> --yes`, and "Remove drafts from this note…" in the plugin. Both delete the history and remove the Pentimento properties, leaving the text as it is.

### Changed

- Snapshots edit only the frontmatter lines Pentimento owns. Before, the whole frontmatter was rewritten, which could reformat the note's other properties (`tags: [song]` became `tags: [ song ]`).
- The draft format (frontmatter stamping, `meta.yml`, revision numbering) moved into `src/model.ts`, which has no file access. `src/drafts.ts` saves drafts through an async storage interface for hosts without Node; tests check it writes exactly what the CLI writes.

## 0.11.0 - 2026-09-30

Pentimento 0.11 reframes the tool around rounds of drafts and makes the page much quieter. (0.8.0 through 0.10.0 were published while moving releases to CI and contain the 0.7 code.)

### Added

- Traces: press T (or the Traces button) to see the previous draft showing through the current one, with cut words struck in sepia and new ones underlined. Verse and lists are traced line by line; changed directives show the new version with the old one behind a fold.
- Cuttings: every passage cut or rewritten beyond recognition in an earlier draft, listed at the bottom of the page with a copy button, and printed by `pentimento cuttings`.
- `pentimento snapshot` no longer needs `--summary`. Without one it writes a summary from the diff, named by headings: `Rewrote Chorus`, `Removed Bridge`.
- Receipts: "What changed" lists the comments the new draft answered.
- `::: ask`: a question with options the reader answers in the page. Answers are stored as comments with an `answer` field, and `pentimento address` prints them.
- Approval: an Approve button in the viewer and `pentimento approve`. The page shows the approval, and when the document changes afterwards, a link to everything changed since sign-off. `pentimento list` and `address` report it.
- The viewer has a revision scrubber, and it tells you when you have unread drafts, with a link to everything changed since the last one you read (`?since=rNNN`).
- History at the bottom of every page: each draft's summary, reason, date, word count, and a small words-per-draft chart.
- Static renders embed the last 10 drafts and a scrubber in the header; `render --drafts N|all` changes the number, and `--drafts 0` leaves them out.
- `::: flow` arrows take labels: `A -(writes)-> B`.
- Obsidian syntax: `[[links]]` and `![[embeds]]` render as their text, `==highlights==` as highlights, `> [!type]` callouts (including folded ones) with the callout styles, and footnotes. `%% comments %%` are hidden.
- Documents without an `Archetype` keep single line breaks, as Obsidian does. `Line Breaks: true|false` overrides it.
- Lint flags a second layer of generated-prose tells: self-narration ("This document walks…"), stock phrases (load-bearing, "X is the product"), and ", not a Y." slogan endings. Quoted phrases and code spans no longer count.
- Lint warns about directive-heavy documents, repeated verdicts, more than two asks, more than four decision callouts, and leftover `eyebrow:` and `Palette` settings.

### Changed

- A new design: one palette with light and dark schemes, a serif reading face, the system sans for the interface, and monospace only for code. Callouts are a rule and a label, the verdict is a two-column list, statuses are small dots, and inline code has no background.
- The header is a single line (label, revision, date, approval) above the title, followed by the latest summary. The contents move to a quiet side rail on wide screens and a fold on narrow ones, and appear only for documents with three or more sections.
- The viewer bar is a compact floating toolbar: documents, scrubber, traces, comments, approve, stop.
- Block diffs are line-level for verse and lists, and headings always diff as their own block.
- The authoring skill was rewritten: a directive budget, a `plan` archetype as the default, outlines presented as suggestions, and two complete example documents in place of the list of bans.

### Removed

- `::: figure` from the authoring guide. It still renders; lint suggests `::: flow` instead.
- The six palettes, the theme picker, `pentimento config theme`, and `PENTIMENTO_PALETTE`. `Palette` frontmatter is ignored.
- Eyebrow labels. `eyebrow:` in heading comments is accepted and ignored.

## 0.7.0 - 2026-07-28

### Added

- `::: flow` renders box-and-arrow diagrams from `A -> B` edge chains; the renderer computes the layout, so diagrams need no hand-placed coordinates.
- `::: checklist` renders `- [x]` verification items with a computed coverage strip.
- `::: options criteria="..."` renders a brainstorm scorecard; the `[pick]` row carries the recommendation.
- `superseded-by=` on decision callouts keeps reversed decisions visible, dimmed, and linked to their replacement.
- Findings, timeline phases, and checklist items accept trailing `{#id}` anchors for comments and links.
- From the second revision on, sections that changed since the previous revision get an accent dot in the table of contents, and the "What changed" summary carries computed glance deltas such as `+1 done · −2 HIGH`.
- `pentimento lint` flags `:::` directives outside the vocabulary, which would otherwise render as literal text.

### Changed

- The verdict banner grid now adapts to its cell count instead of forcing three columns.

### Removed

- The `::: compare` and `::: files` placeholder directives, which silently rendered as plain markdown.
- The pre-0.6 palette fallback CSS and compact-picker compatibility chrome; palette definitions now come from the theme registry alone.

## 0.6.0 - 2026-07-10

Pentimento 0.6 keeps the product intentionally focused: one person and one agent revising one canonical Markdown document, with private remote viewing when needed.

### Added

- Six reader palettes with automatic, light, and dark schemes, plus a persistent personal default.
- A workspace document index and live revision viewer with historical and diff navigation.
- Selection-anchored reader comments, replies, resolution history, and recoverable drafts.
- Private non-loopback write links that exchange a short-lived capability for an HttpOnly browser session.
- A protected Stop viewer control that gracefully closes only its own server process.
- Explicit `Draft after rNNN` state when canonical content differs from its latest snapshot.
- `pentimento --version` and side-effect-free command help.

### Changed

- Improved document hierarchy, wide tables and diagrams, print output, mobile controls, empty-workspace guidance, keyboard focus, and comments-drawer accessibility.
- Made snapshot, revert, comment resolution, and metadata updates recoverable and validated before mutation.
- Updated the bundled agent skill to serve a live viewer by default and documented the single-user VPS/Tailscale workflow.
- Expanded CI across Node 20.13, 22, and 24, including a clean packed-package installation smoke test.

### Security

- Raw Markdown HTML is inert; renderer-owned SVG and directives are constrained and sanitized.
- Revision and workspace paths are validated against traversal, symlink escapes, and metadata mismatches.
- Remote mutations require capability, Origin, JSON content type, size limits, and scoped browser ownership checks.
- Viewer pages use restrictive CSP, framing, referrer, content-type, and cache headers.
- Updated `diff` to 9.0.0, clearing the known runtime dependency advisory.

### Upgrade note

Non-loopback viewers now print separate private write and read-only links. Use the write link once in a trusted browser; Pentimento immediately removes the capability from the visible URL. Existing loopback workflows remain writable without this exchange.
