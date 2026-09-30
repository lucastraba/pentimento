# Pentimento authoring guide

This is the version-matched source of truth for writing a Pentimento document. It is
printed by `pentimento guide`, so it always matches the installed CLI. Deeper pages:
`pentimento guide style` (example documents), `pentimento guide archetypes` (outlines),
and `pentimento guide directives` (syntax).

Pentimento assumes one user and one document. The user reads each draft in the browser,
selects text to leave comments, answers any questions you asked, and approves a draft when
it is right. You revise the markdown and save the next draft.

## What a good Pentimento document looks like

It reads like a memo from a careful colleague: a title, one sentence that says what the
document concludes, then sections of plain prose. A few structured elements appear where
they carry information prose would bury, such as a phase list with status or a table
comparing options. Nothing is there to fill a slot.

The reader sees the page, not your markdown, and the page is quiet on purpose. Every
directive you add is one more thing competing for attention. Before you add one, ask
whether a sentence or a plain list would do. Usually it would.

## Directive budget

- A typical plan uses zero to three directives. Five is a lot. More than one of the
  same kind per section is almost always wrong.
- `::: verdict` is optional. Use it when the reader needs two to four short answers side
  by side. When the answer is one sentence, put it in the standfirst instead.
- `::: callout decision` is for choices that close off an alternative. Two or three per
  document at most. Background, caveats, and notes stay in prose.
- `::: timeline` and `::: checklist` earn their place when items carry status the reader
  will track across drafts. A static list of steps is a markdown list.
- `::: ask` is for a question only the user can answer and that changes what you write
  next. Ask at most two per draft.
- `pentimento lint` warns when a document leans on directives. Take the warning seriously.

## The loop

1. Research as usual. Decide whether this needs a document at all: a short answer
   belongs in chat. Pick an outline from `pentimento guide archetypes` as a starting
   point, then drop every section the content doesn't need.
2. Write `<Name>.md`:
   ```markdown
   ---
   Archetype: plan
   ---
   # Offline sync for the notes app

   > Notes edited offline merge when the device reconnects, using an operation log.

   ## Why the current sync loses edits
   …
   ```
   `Archetype` is `plan`, `implementation`, `brainstorm`, `audit`, or `design-doc`. It
   sets the label above the title. `## ` headings become the contents rail; add
   `<!-- id: short-id -->` at the end of a heading line only when you need a stable
   anchor that survives renaming the heading.
3. Lint, then save the first draft:
   ```bash
   pentimento lint <Name>.md
   pentimento snapshot <Name>.md --summary "First draft" --author <who>
   ```
   Fix what lint reports before you snapshot. The summary is the first thing the reader
   sees under the title; write it for them, in a few words.
4. Serve: run `pentimento serve .` as a tracked background process (reuse one that is
   already running for this directory), confirm the printed URL responds, and give it to
   the user. The page updates on its own after each snapshot. On a remote machine, add
   `--tailscale` and send the user the printed write link; the plain link is read-only.
   **Stop viewer** in the page closes that server for every document it serves.
5. Wait for the user. When they say they left comments, run `pentimento address
   <Name>.md` and work through it (next section).
6. A static file is a fallback for when a server can't stay up or the user asks for a
   file: `pentimento render <Name>.md -o <name>.html`. For claude.ai Artifacts, add
   `--artifact` and publish the fragment with the same file path each round.

## Addressing comments, answers, and approval

`pentimento address <Name>.md` prints every open comment with the quoted text and its
surrounding context, every answer to an `::: ask` question, and whether the user approved
a draft.

1. Revise the markdown. The quote and context locate the passage even if it moved.
2. Save one draft for the round, with a summary that names what changed:
   `pentimento snapshot <Name>.md --summary "Merge conflicts keep both versions" --why "Answered the merge question"`
3. For each comment the new draft addresses:
   `pentimento resolve <Name>.md <comment-id> --rev <new revision>`. The reader's page
   lists these under "Your notes this draft answered", next to the diff.
4. When a comment needs an answer rather than an edit, reply instead:
   `pentimento reply <Name>.md <comment-id> --text "..."`. Leave comments you can't
   resolve open and say why in chat.
5. Answers to `::: ask` questions are comments too. Once the draft reflects the answer,
   resolve it like any other comment, and replace the `::: ask` block with the decision
   it settled.

When `address` or `pentimento list` reports an approval of the latest draft, the plan is
settled: stop revising and do the work. If you change the document after an approval,
the reader sees "Approved r003" beside the newer draft and a link to everything that
changed since they signed off.

## What the reader gets without your help

Don't write any of this by hand; the render computes it.

- The label, revision, and date line above the title, and the latest summary under it.
- "What changed since rNNN": a word-level diff (line-level for lists and verse) with
  computed tallies such as `+1 done · −2 high`, and the comments that draft answered.
- Traces: the current draft with the previous one showing through, deleted words struck
  in sepia. The reader toggles it with the Traces button or the T key.
- A contents rail with a dot beside every section that changed.
- Cuttings: passages removed in earlier drafts, kept at the bottom of the page.
- History: every draft with its summary, reason, date, and word count.
- In the live viewer, a scrubber to step through drafts, and "since you last read" links.

## Prose

The register is plain and specific. `pentimento guide style` shows it in two complete
documents; imitate those rather than a list of rules. The few rules that matter most:

- Say the conclusion first, then the reasons.
- Name the file, the function, the number. "Faster" is weaker than "120 ms instead of 800".
- Use ordinary words: use, need, help, important. The lint lists the words agents reach
  for by default (leverage, robust, seamless, and similar).
- Prefer periods, commas, and parentheses to em-dashes.
- Write bullets as full sentences, or write a paragraph. No bold labels at the start of
  bullets.
- Don't open with a hook or close with a summary of what you just said.
- Don't swap in a clipped, quotable voice instead. No slogans ("X is the product"), no
  metaphors for bugs, no "This document walks…", no "Three things…" setups, no
  "…, not a Y." endings. Write the way you'd explain it to a colleague at their desk.
  `pentimento guide style` has before/after lines from a real document.

`pentimento lint <Name>.md` checks these mechanically. Snapshot prints the warning count.
