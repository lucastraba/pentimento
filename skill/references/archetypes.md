# Outlines

These are starting points, not forms to fill in. Keep the sections the content needs,
rename them to say what they contain, and delete the rest. A two-section document is fine.

Every outline shares one rule: the standfirst (the `>` line under the title) states the
conclusion in one sentence. A reader who stops there should know what you recommend.

## plan (the default)

Use it when the document doesn't fit one of the others, or when you're unsure.

```markdown
---
Archetype: plan
---
# <What this is about>

> <The conclusion in one sentence.>

## <The situation, named after what's wrong or what's needed>
## <The proposal>
## <What could go wrong> (only if something could)
```

## implementation: approve, then build

```markdown
---
Archetype: implementation
---
# <What gets built>

> <What will exist when this is done, and the first step.>

## Why                  prose: what's wrong today, with file and line references
## Approach             prose; one `::: callout decision` per choice that closes off an alternative
## Steps                `::: timeline` with [done]/[next]/[later] once work starts; a numbered list before that
## Changes              a table of files touched; `::: diff` only for a change the reader must see
## Done when            `::: checklist`, only if the items will be ticked off across drafts
```

## brainstorm: compare directions

```markdown
---
Archetype: brainstorm
---
# <The question>

> <Your pick and the main reason.>

## Options              `::: options criteria="..."` with one [pick] row, or a plain table
## <One section per serious option>   evidence, cost, and what choosing it rules out
## What would change the answer       only questions that could flip the pick
```

## audit: report findings

```markdown
---
Archetype: audit
---
# <What was reviewed>

> <The overall state and the first thing to fix. Scope and date.>

## Findings             `::: findings`, critical and high open, the rest under `@collapse`
## Fixes                prose or a numbered list; `::: timeline` once fixes are underway
## Not covered          what you didn't look at
```

## design-doc: record a design

```markdown
---
Archetype: design-doc
---
# <The system>

> <The design in one sentence.>

## Decisions            `::: callout decision` per settled choice; this is the spine
## How it fits together `::: flow` when a diagram helps; prose per component
## Order of work        a list, or `::: timeline`
## Open questions       `::: ask` for the ones only the user can answer
```

## Personal documents

A file without an `Archetype` is treated as the user's own writing: no label, and single
line breaks are kept, as in Obsidian. Don't add an `Archetype` to a user's song, story, or
notes.
