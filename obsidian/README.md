# Pentimento for Obsidian

Save drafts of a note without leaving Obsidian, and see what changed between them, what you cut, and any earlier draft you want back.

It writes the same files as the [Pentimento CLI](../README.md): each draft is a copy of the note in a hidden `.history/<note>/` folder beside it, with a short summary in `meta.yml`. You can use the plugin, the CLI, or both on the same notes. It works on phones too; nothing in it needs a terminal.

## Using it

- **Save draft** (ribbon button, or the command palette) keeps a copy of the note as it is now. Pentimento writes the summary from what changed, using your headings: "Rewrote Chorus", "Removed Bridge".
- **Save draft with a note…** lets you write the summary yourself, and why.
- The status bar shows the latest draft, and "· edited" once the note has moved since. Click it to open the panel.
- **The Drafts panel** has three tabs:
  - *Changes*: the note now against any earlier draft, with removed words struck through and new ones marked. Verse and lists compare line by line.
  - *Drafts*: every draft with its summary, date, and word count. "What changed" shows that draft's own changes; "Restore" brings it back as a new draft, after saving the note's current text so nothing is lost.
  - *Cuttings*: passages you removed or rewrote completely in earlier drafts, with a Copy button.

The first draft of a note adds three properties to it (`Pentimento`, `Current Revision`, `History Folder`). They tell the CLI and the plugin where the history lives.

## Settings

- **Your name** is recorded on each draft.
- **Save a draft every day** (off by default): once a day, notes that already have drafts and changed since their last one get a new draft. A note you've edited in the last 15 minutes waits until you stop.

## Installing

Not in the community plugin list yet. To install from this repository:

```bash
cd obsidian
npm ci
npm run build
npm run install-vault -- "/path/to/your vault"
```

Then in Obsidian, open Settings → Community plugins, reload the list, and turn on Pentimento.

## Development

`npm run dev` rebuilds on change. The plugin bundles `../src/drafts.ts`, `../src/model.ts`, and `../src/semdiff.ts` from the CLI, so the draft format is shared code rather than a copy. The build fails if anything in the bundle needs Node, which mobile Obsidian doesn't have.

`node test/harness.mjs` loads the built `main.js` against a small fake of Obsidian's API and walks a note through saving, editing, restoring, and daily drafts. The panel itself was checked by hand in Obsidian 1.13.7.
