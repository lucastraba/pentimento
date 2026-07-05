# Vellum directive reference

Directives are fenced with `:::` on their own lines. A leading bare word is the variant; the rest is `key="value"` attrs. Content inside is markdown unless noted.

## Callout

```markdown
::: callout decision id=d-source-of-truth
**Markdown is the source of truth.** HTML is a build product.
:::
```

Variants: `decision` (accent wash), `info`, `warn`, `risk` (red label). `id` is optional but give decisions stable ids — they're comment/link anchors.

## Verdict banner

Headline answers, 2–4 cells. One `question :: answer` list item per cell.

```markdown
::: verdict
- Works correctly? :: Partially
- Efficient? :: Convention yes, tooling no
- Portable? :: Yes — easily
:::
```

## Findings (audit archetype)

Severity is one of `CRIT`, `HIGH`, `MED`, `LOW`. Everything after `@collapse <label>` folds into a details element.

```markdown
::: findings
- CRIT :: `snapshot` silently overwrites history.
- HIGH :: 3 of 6 real docs are inconsistent.
@collapse Medium and low findings (2)
- MED :: Hardcoded UTC+2 timezone.
- LOW :: History invisible inside Obsidian.
:::
```

## Timeline (phases)

Numbered items; bold title, optional `[next]`/`[later]`/`[done]` pill, `—` then description.

```markdown
::: timeline
1. **CLI + renderer + skill** [done] — Shipped; loop closes end to end.
2. **Local viewer** [next] — Hono daemon, Tailscale-bound, SSE reload.
3. **Anchored comments** [later] — The Antigravity loop.
:::
```

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

## Figure (diagrams)

Inline SVG only, composed from `theme.css` classes: `nodebox` (plain node), `accentbox` (highlighted node), `flow` (arrow path; add `marker-end="url(#arr)"` and define the `arr` marker in `<defs>`), `lbl` (small caption text). Colors come from CSS variables — never hardcode fills beyond those classes. Always set `aria`.

```markdown
::: figure aria="PLAN.md flows through the vellum CLI to plan.html"
<svg viewBox="0 0 640 120" xmlns="http://www.w3.org/2000/svg">
  <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--soft)"/></marker></defs>
  <rect class="nodebox" x="8" y="40" width="110" height="36" rx="5"/>
  <text x="63" y="62" text-anchor="middle">PLAN.md</text>
  <rect class="accentbox" x="180" y="40" width="120" height="36" rx="5"/>
  <text x="240" y="62" text-anchor="middle">vellum CLI</text>
  <path class="flow" d="M118 58 H176"/>
</svg>
:::
```

## Headings, ids, eyebrows

```markdown
## Why past HTML plans failed <!-- id: why; eyebrow: Diagnosis -->
```

`id` gives the section a short stable anchor (default: slugified title). `eyebrow` is the small-caps label above the heading. `###` subheadings take `<!-- id: ... -->` too.

## Swatches

`{dot:impl}` `{dot:brain}` `{dot:audit}` `{dot:design}` `{dot:verdigris}` `{dot:mist}` `{dot:iris}` render as colored dots — use in table cells to key rows to accent hues.

## Header, TOC, evolution strip, what-changed, footer

Generated — never write them. The header reads `Archetype` and `Current Revision` from frontmatter; the evolution strip reads `meta.yml` (that's why snapshot summaries must be written for the reader); the TOC comes from `##` sections; the collapsible "What changed in rNNN" panel is a word-level diff against the previous snapshot, computed at render time.

## Frontmatter keys

```yaml
Archetype: implementation | brainstorm | audit | design-doc   # badge + accent
Palette: iris | verdigris | mist                              # default palette (reader's own pick wins)
```
`Vellum`, `Current Revision`, and `History Folder` are managed by the CLI — never hand-edit them.
