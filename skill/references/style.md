# Writing a Pentimento document

Two complete documents follow. They show the register to write in: plain sentences,
specific claims, the conclusion first, and very little structure. Read one before your
first draft and match it. Then read the notes after each; they point at the choices that
are easy to miss.

## Example 1: an implementation plan

````markdown
---
Archetype: implementation
---
# Stop losing drafts when the save request fails

> Keep the reader's text in the form until the server confirms the save, and show the
> error in place. About 40 lines in `assets/viewer.js`, no server changes.

## What happens today

When a reader saves a comment, `post()` in `assets/viewer.js:98` removes the form before
the request finishes. If the server answers 400 or 404, nothing checks the status, so the
comment is gone and the page shows no error. If the network drops, the promise rejects,
the form stays, and the Save button stops responding.

Both failures happen in normal use. The 404 case is the common one: an agent renames the
document while the reader is typing.

## Approach

The form stays open with its text until the response comes back with a 2xx status. On
any other outcome the form shows the server's message under the text box and re-enables
Save. The text is also written to `localStorage` on every keystroke, so a reload brings
it back.

::: callout decision id=d-no-retry
**No automatic retry.** A retry would hide the 404 case, where retrying can't succeed.
The reader sees the error and decides.
:::

## Steps

1. Check `response.ok` in `post()` and keep the form open on failure.
2. Add the inline error line and re-enable the buttons.
3. Save and restore the draft through `localStorage`, keyed by document path.
4. Test each failure with the server stopped, and with the document renamed mid-edit.

## Changes

| File | Change |
|---|---|
| `assets/viewer.js` | status check, error line, draft storage |
| `test/comments.test.ts` | 404 and network-failure cases |
````

What to notice:

- The standfirst is the whole plan in two sentences, including its size.
- "What happens today" cites the file and line, and says which failure is common and why.
  It doesn't call the bug critical; the description makes that clear.
- There is one callout, for the one choice that rules something out, and it says what.
- The steps are a plain numbered list. Nothing has started, so there is no status to
  track and no reason for `::: timeline` yet.
- Paragraphs are short and end when the point is made. No section summarizes another.

## Example 2: a brainstorm

````markdown
---
Archetype: brainstorm
---
# Where the notes app should store edit history

> SQLite in the app's data folder. It is one file, needs no server, and handles the
> expected volume (about 50,000 operations per user per year) without tuning.

## Options

::: options criteria="Setup, Queries by note, Sync cost"
- **SQLite** [pick] :: none, ships with the app :: indexed, under 5 ms :: send new rows since the last sync
- **One JSON file per note** :: none :: read and parse the file :: send whole files
- **Postgres** :: a server per user :: indexed :: needs a sync service we don't have
:::

## SQLite

Each operation is one row: note id, device id, clock, and the edit. Reading one note's
history is an indexed query. Syncing sends rows with a clock higher than the last one the
other device acknowledged, which is a single `SELECT`.

The cost is a schema to migrate. We have done that twice before with the settings table,
and it took an afternoon each time.

## One JSON file per note

This is closest to what the app does today, and it needs no new dependency. It breaks
down on sync: two devices that edit the same note produce two different files, and
merging them means re-implementing what SQLite gives us as a query.

## Postgres

Postgres would work, but every user would need a server or we would need to host one.
Neither is on the roadmap.

## What would change the answer

::: ask id=q-web
Will the app need to run in a browser tab within the next year?
- No
- Yes, which would favour IndexedDB over SQLite
:::
````

What to notice:

- The standfirst names the pick and the number that justifies it.
- The table carries the comparison, so the sections below add only what doesn't fit in a
  cell: the mechanism, the real cost, and what breaks.
- Each option gets a fair hearing in two or three sentences. The losing options are
  described accurately, not dismissed.
- The only question asked is one that would flip the recommendation, and only the user
  can answer it.

## Patterns that make a document read as generated

These are the habits that make a page feel machine-made. `pentimento lint` catches many
of them.

- A structured element in every section because the outline mentioned it.
- Labels that dress up a section ("The bottom line", "Why this matters").
- Promotional words: leverage, robust, seamless, streamline, empower, comprehensive.
- "Not X, but Y" framing when the claim is just Y.
- Bullets that start with a bold label and a colon.
- Em-dashes in place of commas, colons, and periods.
- Rhetorical questions and "here's the thing" openers.
- A closing paragraph that restates the document.
- Snapshot summaries like "Various improvements". Name the change: "Merge keeps both
  versions".

## The second layer: prose trying not to sound generated

Avoiding the words above is not enough. A model told to avoid them often switches to a
clipped, quotable voice that readers spot just as fast. Every line on the left below comes
from a real Pentimento document that passed the older lint.

| Reads as generated | Plain |
|---|---|
| The review loop is the product. | An agent writes a plan, the reader comments, and the agent revises. |
| Every save feels like dropping a letter into a mailbox with no slot. | Saving a comment showed nothing. |
| Correct and trustworthy are different properties, and the viewer only delivers the first. | Storage worked, but the reader had no way to tell. |
| Walk it end to end. You select a sentence… | Selecting text showed a button. |
| The numbers in `theme.css` tell the story. | In `theme.css`, the container was 90 characters wide. |
| This is the load-bearing idea: | (Delete it. Put the idea first.) |
| This is a review tool, not a forum. | Replies stay one level deep and plain text. |
| One column for reading, one wider stage for exhibits, nothing in between. | Everything uses the prose width except diffs, wide tables, and figures. |
| Three moments need work, in order of how much they hurt. | (Delete it. Start with the first one.) |

The patterns behind them:

- **Slogans.** Short, quotable sentences that sum up instead of inform ("X is the
  product", "Y, not Z."). If a sentence would work on a poster, rewrite it as a fact.
- **Figures of speech.** Metaphors and similes to make a bug feel vivid. Describe what
  happens instead.
- **Self-narration.** The document announcing what it is about to do ("This document
  walks…", "Let's look at…", "Walk it end to end"). Do it without announcing it.
- **Counted setups.** "Three gaps", "two halves", "three layers", followed by "The first…
  The second…". Use a heading or a list if the items need numbers; otherwise just write
  them.
- **Colon reveals.** "What you see: …", "The fix: …", "The answer is simple: …". Write
  the sentence.
- **Borrowed jargon.** load-bearing, the real win, north star, tier, surface area,
  first-class. Use the ordinary word for the thing.
- **Clipped imperatives as section openers.** "Kill the reload." "Make failure loud."
  Say what changes and why.

A useful check: read a paragraph and ask whether a colleague explaining this at a desk
would say it that way. They would say "saving didn't show anything", not "every save
feels like a letter into a mailbox with no slot".
