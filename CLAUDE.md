# Pentimento: notes for agents

This repo holds the CLI, the browser viewer, and the draft code the Obsidian plugin imports (`pentimento/drafts`, `pentimento/model`, `pentimento/semdiff`). The plugin is `lucastraba/pentimento-obsidian` (`~/repos/pentimento-obsidian`). README.md is for users and has the build and release steps; PLAN.md is the design picture.

## Work

- Open work is GitHub issues in both repos. Start with `gh issue list -R lucastraba/pentimento` and `gh issue list -R lucastraba/pentimento-obsidian`, and file new bugs and ideas as issues. PLAN.md links to issues rather than repeating them.
- PLAN.md is itself a Pentimento document: edit it, then `pentimento snapshot PLAN.md`.

## Releases

People use the plugin, and it imports the draft code from this package. A regression in `drafts`, `model`, or `semdiff` breaks the plugin for them, and a bad `meta.yml` change can damage their draft history. Before a release of either repo:

- Review what changed for correctness and compatibility: `meta.yml` files written by older versions, older CLI and plugin versions reading histories the new one writes, and the plugin's harness (`pnpm test` in pentimento-obsidian) against the new build.
- Fix what turns up when it is in reach instead of filing it for later.
- Never push a release tag without Lucas.

## On nyx

- The global `pentimento` is `npm link`ed to this repo's `dist/`, so it runs whatever was built last, and `pentimento-viewer.service` runs it too. After working on a branch, check out `main` and run `pnpm run build` again.
- `pkill -f "pentimento serve"` matches the shell running it, and the always-on viewer as well. Stop a viewer you started by its PID, or match `"pentimento [s]erve"` and check what it hits first.
