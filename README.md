<p align="center">
  <img src="assets/logo.svg" alt="Pentimento logo" width="112" height="112">
</p>

<h1 align="center">Pentimento</h1>

Pentimento keeps every draft of a markdown document and shows you what changed between rounds, and why. Use it on your own writing in Obsidian, or let an agent write plans with it and revise them from your comments.

A pentimento is an earlier brushstroke showing through the paint on top of it. That is what the page does: the current draft on top, the previous one showing through when you want to see it.

## What a round looks like

You write or edit a markdown file. You save a draft:

```bash
pentimento snapshot Song.md
```

Pentimento copies the file into a hidden `.history/` folder next to it and writes a one-line summary of what moved, based on your headings: `Rewrote Chorus`, `Removed Bridge`. Pass `--summary` to write your own.

Then you read it:

```bash
pentimento serve .
```

The page shows the current draft, set in a plain serif with no decoration. Above it, one line says which draft this is and what changed. Below it you'll find:

- **What changed.** A diff against the previous draft: word by word for prose, line by line for verse and lists.
- **Traces.** Press T and the previous draft shows through the current one, with cut words struck through in sepia and new ones underlined.
- **Cuttings.** Every passage you removed in an earlier draft, with a copy button. The bridge you cut on Thursday is still there on Friday.
- **History.** Every draft, with its summary, date, and word count.

A scrubber steps through the drafts, and in the live viewer the page tells you when there are drafts you haven't read yet.

## Install

Pentimento needs Node 20.13 or newer.

```bash
npm install -g pentimento
```

Or run any command without installing: `npx -y pentimento@latest serve .`

## Your own writing

Nothing needs an agent. Write in Obsidian (or anything else), and save a draft whenever you've done a morning's work:

```bash
pentimento snapshot Song.md
pentimento list Song.md          # every draft and its summary
pentimento diff Song.md          # the latest two, in the terminal
pentimento cuttings Song.md      # everything you've cut that isn't in the current draft
pentimento revert Song.md r002   # bring back r002, saved as a new draft
pentimento untrack Song.md --yes # delete the drafts and the Pentimento properties; the text stays
```

In Obsidian, the [Pentimento plugin](obsidian/README.md) does the same without a terminal: a Save draft button, the latest draft in the status bar, and a panel with the changes, every draft, and your cuttings. It writes the same files, so the plugin and the CLI work on the same notes.

A document without an `Archetype` in its frontmatter is treated as your own writing: single line breaks stay line breaks, as in Obsidian, so lyrics and poems keep their shape. Obsidian syntax renders the way Obsidian shows it: `[[links]]`, `==highlights==`, `> [!note]` callouts, and footnotes, with `%% comments %%` hidden. The `.history/` folder is hidden from Obsidian.

## Plans with an agent

Pentimento works with Claude Code, opencode, and Codex. Install the skill for your agent:

```bash
pentimento skill install ~/.claude/skills    # Claude Code
pentimento skill install ~/.agents/skills    # opencode, Codex
```

Then ask: *"Write a plan for X as a Pentimento document."* The agent writes the markdown, saves the first draft, starts the viewer, and gives you the link.

The loop from there:

1. **Read and comment.** Select any text and leave a comment. When the agent asked you something with a question block, click an answer.
2. **Tell the agent.** "I left comments." It revises the file and saves the next draft. The page updates in place.
3. **See what it did.** "What changed since r002" opens the diff, and lists each of your comments the new draft answered.
4. **Approve.** When the plan is right, press Approve. The agent sees the approval and gets to work. If the plan changes after that, the page offers everything that changed since you signed off.

The skill keeps plans quiet on purpose: mostly prose, with a small set of structured blocks (decisions, a phase list with status, findings by severity, an options table, a diagram, a question for you) used only where they carry information. `pentimento lint` warns when a document leans on them, and flags the usual generated-prose habits.

If the agent runs on a remote machine, `pentimento serve . --tailscale` binds the viewer to its Tailscale address and prints a private write link and a read-only link. Send the write link only to yourself.

## The page

There is one look. Content is set in a serif, the interface in your system's sans, and code in monospace. Light and dark follow your system; the toggle in the header overrides it for your browser. Nothing on the page is configurable by the document, which is why a plan an agent wrote in March and a song you wrote in May look like they came from the same place.

A static page for sharing or printing:

```bash
pentimento render Plan.md
```

It has everything except commenting and approval. The scrubber works from the last 10 drafts, embedded in the file (`--drafts all` for every one, `--drafts 0` for none), so you can send someone `Song.html` and they can step through how it developed. The page makes no outside requests.

## Writing reference

The CLI prints version-matched references:

```bash
pentimento guide              # the authoring loop
pentimento guide style        # two example documents in the house register
pentimento guide archetypes   # outlines for plans, audits, brainstorms, design docs
pentimento guide directives   # syntax for the structured blocks
```

The same files are in [`skill/references/`](skill/references/).

## Other commands

```bash
pentimento comments Plan.md                          # open comments
pentimento address Plan.md                           # open comments and answers, formatted for an agent
pentimento resolve Plan.md <id> --rev r003           # mark a comment answered by a draft
pentimento reply Plan.md <id> --text "..."           # answer without revising
pentimento approve Plan.md                           # sign off from the terminal
pentimento verify .                                  # check history and frontmatter agree
pentimento lint Plan.md [--strict]                   # prose and structure warnings
```

Everything on disk is plain text: the document, its `.history/<name>/rNNN.md` drafts, and a `meta.yml` with summaries, comments, and approvals. Nothing needs git, and nothing conflicts with it.

MIT © Lucas Traba
