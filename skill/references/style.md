# Pentimento prose style

The rules live in `pentimento guide` (the Prose section). This page shows the register
by example — one before/after pair per surface an agent writes. In every pair the
"before" is grammatical, plausible, and wrong.

## Standfirst (any archetype)

Before:

> A robust, seamless toolchain that doesn't just version your documents — it empowers
> teams to collaborate effortlessly across the entire planning lifecycle.

After:

> One markdown file, a hidden history of the revisions you chose to keep, and an HTML
> render the author doesn't control.

The before says nothing checkable. The after makes three claims a reader can verify.

## Decision callout (implementation)

Before:

```markdown
::: callout decision
**Flexibility:** We will leverage a modular architecture to ensure the system remains
robust and future-proof as requirements evolve.
:::
```

After:

```markdown
::: callout decision id=d-sqlite
**SQLite over Postgres.** One file on disk, no daemon to run. We lose concurrent
writers — which this tool never has.
:::
```

A decision names what it forecloses. "Future-proof" forecloses nothing.

## Finding (audit)

Before:

```markdown
- HIGH :: The error handling could potentially be improved to be more robust and comprehensive.
```

After:

```markdown
- HIGH :: `save()` swallows write errors — a full disk loses the draft silently (`src/store.ts:88`).
```

A finding is an accusation with an address: symptom, consequence, file and line.

## Options prose (brainstorm)

Before:

> It's not just about performance — it's about developer experience. Both options have
> their pros and cons, and the right choice ultimately depends on your specific needs.

After:

> Option A wins on cold-start latency (120ms vs 800ms) and loses on memory (3× resident
> set). For a CLI that runs once and exits, latency is the only column that matters.

Take a side and show the numbers that put you there. "Depends on your needs" is the
author refusing to do the reader's thinking.

## Timeline entry (implementation)

Before:

```markdown
1. **Phase 1** [next] — Lay the groundwork and establish a comprehensive foundation for future development.
```

After:

```markdown
1. **Schema and migrations** [next] — The two tables everything else reads; nothing ships until they're stable.
```

## Snapshot notes

Before:

```bash
pentimento snapshot Plan.md --summary "Enhanced the document with various improvements"
```

After:

```bash
pentimento snapshot Plan.md --summary "Cut Options from five to three" --why "Two were the same idea worded twice"
```

The evolution strip at the top of the render is built from these notes. Write them for
the reader who wasn't in the room.
