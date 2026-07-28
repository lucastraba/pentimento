# Pentimento authoring guide

This is the version-matched source of truth for producing a Pentimento document. It is
printed by `pentimento guide`, so it always matches the installed CLI — follow it over any
cached instructions. Deep topics have their own pages: `pentimento guide directives`,
`pentimento guide archetypes`, and `pentimento guide style`.

Pentimento assumes one user and one canonical document. In the agent loop, comments are
that user's revision instructions to the agent, not a conversation among reviewers. When
the agent runs on a VPS, `--tailscale` lets the same user open the viewer from another
trusted device; it does not create a shared workspace.

## The loop

1. Research and think as normal (in plan mode if active). Decide the archetype:
   `implementation` | `brainstorm` | `audit` | `design-doc` (section skeletons:
   `pentimento guide archetypes`). Lead every document with the answer: the first
   section is a `::: verdict` banner (Recommendation / Verdict / Summary) the reader can
   act on without scrolling, then the evidence below it.
2. Write `<Name>.md` with frontmatter:
   ```yaml
   ---
   Archetype: implementation
   Palette: iris        # optional: verdigris | mist | iris | parchment | fjord | contrast
   ---
   ```
   Palette precedence: this frontmatter field wins; if omitted, the `PENTIMENTO_PALETTE`
   env var sets the team default, followed by the user's `pentimento config theme` setting,
   then built-in Verdigris. Readers can still switch palette in the viewer.
   Structure: `# Title`, then a `> standfirst` blockquote, then `##` sections. Add
   `<!-- id: short-id; eyebrow: Section Label -->` at the end of `##` heading lines.
3. Lint, then snapshot — the snapshot note drafts the decision log the reader sees at
   the top:
   ```bash
   pentimento lint <Name>.md        # fix the style warnings it prints, then:
   pentimento snapshot <Name>.md --summary "what changed" --why "why" --author <who>
   ```
4. Serve the plan (default): run `pentimento serve .` as a tracked background process, verify
   that the printed URL responds, and give the URL to the user. Keep the server running for
   the feedback loop. The viewer is interactive and agent-agnostic: document index, revision
   picker, diff pages, select-to-comment with a comments drawer, and in-place live updates
   (edits appear without a reload). If the agent runs on a VPS, add `--tailscale`, send the
   printed write link to the same user, and keep the viewer inside that tailnet. Opening the
   write link once sets a private browser capability and redirects to a clean URL; the plain
   link stays read-only. Prefer this private live loop over publishing a static file when the
   user needs to comment. One `serve` process uses one port for every Pentimento document under
   that directory. The writable viewer's **Stop viewer** button closes that whole process after
   confirmation; read-only links cannot stop it, and separate servers on other ports stay up.
5. Static HTML (optional): `pentimento render <Name>.md -o <name>.html` produces a
   standalone page that opens anywhere. Use it only when you can't keep a server running or
   the user wants a file to email or upload. For claude.ai Artifact publishing, add
   `--artifact` and publish the fragment with the Artifact tool (favicon 📜, same file path
   each round for a stable URL). That path is Claude-specific, so default to `serve`.
6. Feedback round: revise the markdown, then `snapshot`. If you are serving, the viewer
   hot-reloads and shows the collapsible "What changed in rNNN" diff on its own; if you used
   the static path, re-run `render` (and re-publish the artifact). Write snapshot summaries
   for the reader. Never edit history files; `pentimento list` / `pentimento diff` /
   `pentimento revert` manage them.
7. If the user asks what changed between older revisions:
   `pentimento diff <Name>.md rA rB --html -o changes.html` renders a readable word-level
   diff page you can publish alongside the plan.
8. Periodically (or in CI): `pentimento verify .` cross-checks every Pentimento document's
   frontmatter, history files, and meta.yml.

## Prose

Pentimento owns the look; these rules own the register. They bind exactly like the
no-CSS rule — a document that reads like a launch post is as broken as one with inline
styles. The register is a senior engineer's memo. Before/after examples per surface:
`pentimento guide style`.

1. Plain words. Use, reliable, smooth, important — never leverage, robust, seamless,
   crucial, delve, streamline, showcase, foster, empower, comprehensive, utilize.
2. "Is" and "has", not "serves as", "features", "boasts". Cut filler: "in order to"
   → "to", "due to the fact that" → "because".
3. Em-dashes are the loudest AI tell. At most one per paragraph, never two in one
   sentence. Default to a period, colon, comma, or parentheses; reread every "—" you
   type and replace it unless it is doing irreplaceable work. (The timeline directive's
   `—` separator is syntax and doesn't count.)
4. No false contrast. Never "it isn't just X — it's Y", nor the split form ("The point
   isn't speed. It's trust."). State the claim directly.
5. No engagement hooks: no "Here's the thing", "The catch?", no rhetorical-question
   openers, no "So what does this mean?"
6. Bullets are full claims with verbs and specifics. Bold-lead fragments
   ("**Speed:** improved") are banned. When prose can carry it, prefer prose.
7. Specific over vague: name the file, cite the line, give the number. No "from X to Y"
   false ranges, no "-ing" tack-ons ("…showcasing the design").
8. One hedge per claim. "Probably" and "might" in the same sentence means you haven't
   decided what you think. Decide.
9. Vary sentence length. Uniform 20-word sentences read as generated; a short one lands.
10. No throat-clearing or self-labeling: cut "It's worth noting", "Interestingly",
    "Moreover", "In today's landscape".
11. No closers. End when the content ends; "the future looks bright" and its cousins
    never appear.

These apply everywhere the reader sees text: body prose, callouts, findings, timeline
descriptions, and snapshot `--summary`/`--why` notes. They are checked mechanically:
run `pentimento lint <Name>.md` before every snapshot and fix what it flags; snapshot
itself prints the warning count so a slip never ships silently.

## Addressing review comments

The user leaves revision instructions by selecting text in the viewer (`pentimento serve`);
the UI calls them comments, and they land in `meta.yml` with the quoted text and context.
When the user says "I left comments" (or
before any feedback round):

1. `pentimento address <Name>.md` — lists each open comment with its anchor, quoted text,
   and ask.
2. Revise the markdown to address them — the quote + context tells you the exact spot even
   if the section moved.
3. One snapshot for the round:
   `pentimento snapshot <Name>.md --summary "Address review comments" --why "<what the comments asked>"`
4. `pentimento resolve <Name>.md <comment-id> --rev <new revision>` for each comment you
   addressed. When the answer is an explanation rather than a revision, reply instead:
   `pentimento reply <Name>.md <comment-id> --text "..."` (or close with a note via
   `resolve --note "..."`). Replies show on the reader's comment card in the viewer.
   Leave genuinely unresolved ones open and say why.
5. The running viewer updates on its own. Re-render only if you chose the static HTML path.

You can also leave inline notes in the markdown as `%% @c: a note %%` — snapshot extracts
them into meta.yml anchored to the nearest heading (useful for flagging open questions to
the reader).

## Directive vocabulary

Full syntax and examples: `pentimento guide directives`. Summary:

| Directive | Use for |
|---|---|
| `::: callout decision\|info\|warn\|risk` | decisions (link ids like `d-1`; `superseded-by=` marks reversals), notes, risks |
| `::: verdict` | 2–4 headline question :: answer cells |
| `::: findings` + `@collapse` | severity-graded findings (CRIT/HIGH/MED/LOW) |
| `::: timeline` | numbered phases with `[next]`/`[later]`/`[done]` pills |
| `::: checklist` | verification / done-when items; the render computes coverage |
| `::: options criteria="..."` | option scorecard, one row marked `[pick]` |
| `::: diff head="file · what"` | proposed file changes, written as a unified diff |
| `::: flow aria="..."` | box-and-arrow diagrams from `A -> B` chains, layout computed |
| `::: figure aria="..."` | hand-composed inline SVG when `flow` can't say it |
| `{dot:impl}` etc. | color swatches in tables |
| plain markdown tables | file-touch lists and other enumerations (auto-wrapped, scrollable) |

Findings, phases, and checklist items take a trailing `{#id}` anchor for comments to target.

Pick components the archetype calls for; leave the rest out. Flexibility = archetype +
component choice. Everything visual is fixed.
