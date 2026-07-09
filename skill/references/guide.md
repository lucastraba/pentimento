# Pentimento authoring guide

This is the version-matched source of truth for producing a Pentimento document. It is
printed by `pentimento guide`, so it always matches the installed CLI — follow it over any
cached instructions. Deep topics have their own pages: `pentimento guide directives` and
`pentimento guide archetypes`.

## The loop

1. Research and think as normal (in plan mode if active). Decide the archetype:
   `implementation` | `brainstorm` | `audit` | `design-doc` (section skeletons:
   `pentimento guide archetypes`).
2. Write `<Name>.md` with frontmatter:
   ```yaml
   ---
   Archetype: implementation
   Palette: iris        # optional: verdigris | mist | iris
   ---
   ```
   Palette precedence: this frontmatter field wins; if omitted, the `PENTIMENTO_PALETTE`
   env var sets the default (a team can `export PENTIMENTO_PALETTE=verdigris` once); if
   neither is set, the default is `iris`. Readers can still switch palette in the viewer.
   Structure: `# Title`, then a `> standfirst` blockquote, then `##` sections. Add
   `<!-- id: short-id; eyebrow: Section Label -->` at the end of `##` heading lines.
3. Snapshot — this drafts the decision log the reader sees at the top:
   ```bash
   pentimento snapshot <Name>.md --summary "what changed" --why "why" --author <who>
   ```
4. Render: `pentimento render <Name>.md -o <name>.html` — standalone HTML, works anywhere.
   For claude.ai Artifact publishing add `--artifact` (the platform wraps the fragment
   itself; a full document would nest invalidly).
5. Publish: Claude Code renders with `--artifact` and publishes via the Artifact tool
   (favicon 📜, same file path every round so the URL is stable). Alternatively (or
   additionally), `pentimento serve <dir> [--tailscale]` runs the live viewer: document
   index, revision picker, diff pages, hot reload — no per-round publishing needed.
6. Feedback round: revise the markdown → `snapshot` → `render` → republish. The rendered
   page automatically shows a collapsible "What changed in rNNN" diff, so write snapshot
   summaries for the reader. Never edit history files; `pentimento list` / `pentimento diff`
   / `pentimento revert` manage them.
7. If the user asks what changed between older revisions:
   `pentimento diff <Name>.md rA rB --html -o changes.html` renders a readable word-level
   diff page you can publish alongside the plan.
8. Periodically (or in CI): `pentimento verify .` cross-checks every Pentimento document's
   frontmatter, history files, and meta.yml.

## Addressing review comments

Readers leave comments by selecting text in the viewer (`pentimento serve`); comments land
in `meta.yml` with the quoted text and context. When the user says "I left comments" (or
before any feedback round):

1. `pentimento address <Name>.md` — lists each open comment with its anchor, quoted text,
   and ask.
2. Revise the markdown to address them — the quote + context tells you the exact spot even
   if the section moved.
3. One snapshot for the round:
   `pentimento snapshot <Name>.md --summary "Address review comments" --why "<what the comments asked>"`
4. `pentimento resolve <Name>.md <comment-id> --rev <new revision>` for each comment you
   addressed. Leave genuinely unresolved ones open and say why.
5. Re-render and republish.

You can also leave inline notes in the markdown as `%% @c: a note %%` — snapshot extracts
them into meta.yml anchored to the nearest heading (useful for flagging open questions to
the reader).

## Directive vocabulary

Full syntax and examples: `pentimento guide directives`. Summary:

| Directive | Use for |
|---|---|
| `::: callout decision\|info\|warn\|risk` | decisions (link ids like `d-1`), notes, risks |
| `::: verdict` | 2–4 headline question :: answer cells |
| `::: findings` + `@collapse` | severity-graded findings (CRIT/HIGH/MED/LOW) |
| `::: timeline` | numbered phases with `[next]`/`[later]`/`[done]` pills |
| `::: diff head="file · what"` | proposed file changes, written as a unified diff |
| `::: figure aria="..."` | inline SVG diagrams |
| `{dot:impl}` etc. | color swatches in tables |
| plain markdown tables | comparisons, file-touch lists (auto-wrapped, scrollable) |

Pick components the archetype calls for; leave the rest out. Flexibility = archetype +
component choice. Everything visual is fixed.
