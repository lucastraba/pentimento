---
Archetype: design-doc
Pentimento: true
Current Revision: r003
History Folder: .history/Images
---

# Images in Pentimento documents

> Markdown images render, each draft keeps the images it was saved with, and a changed image shows in the diff as before and after. When the user asks for a prototype, the agent builds it as HTML, screenshots it headlessly, and puts the screenshots in the plan. Everything but the Obsidian plugin is built and in review.

## What happens today <!-- id: today -->

`![Settings page](mocks/settings.png)` renders as `<img src="mocks/settings.png">`, but the page's Content-Security-Policy allows only `data:` images (`src/render.ts:118`), so the browser blocks it. The reader sees a broken image in the live viewer and in a static render. An Obsidian embed, `![[settings.png]]`, renders as a marked mention with the file name.

Fixing the rendering alone would leave the history wrong. A snapshot copies the markdown and not the files it points at. If the agent replaces `mocks/settings.png` between r003 and r004, the markdown line is the same in both drafts, so "What changed" reports nothing, and scrubbing back to r003 shows the new picture.

## Decisions <!-- id: decisions -->

::: callout decision id=d-draft-images
**Each draft keeps the images it was saved with.** At snapshot, every local image the document shows is copied into the history under its content hash, and the revision records which copy each path pointed to. The markdown is not rewritten, so `mocks/settings.png` stays an ordinary path that Obsidian and any editor can open.
:::

::: callout decision id=d-screenshots
**Prototypes stay outside the document.** The agent builds a prototype as a standalone HTML file and puts screenshots of it in the plan. The page shows images, never the HTML. A prototype inside the page would need scripts and could only do what the page allows, while a separate file can use anything a browser runs.
:::

::: callout decision id=d-no-browser
**Pentimento doesn't take screenshots.** The agent uses whatever browser it already has: Playwright, a browser tool, or headless Chromium. Bundling one would turn a 315 KB package into one that downloads about 260 MB of Chromium on first use.
:::

## Rendering <!-- id: rendering -->

Image paths resolve relative to the document, and the file has to be inside the document's folder, or inside the vault for an Obsidian note; lint says when one isn't. `![[name.png]]` resolves the way Obsidian does: next to the document, then in the attachment folder set in `.obsidian/app.json`, then by file name anywhere in the vault. PNG, JPEG, GIF, WebP, and SVG are supported. A remote image (`https://…`) is not fetched, because the page makes no outside requests; it renders as a link with its alt text. An image alone in its paragraph renders as a figure at the wider width that diffs and diagrams use, with the image title (`![alt](path "title")`) as its caption.

A static render, including `--artifact`, inlines each image as a `data:` URI, so the policy stays `img-src data:` and the file still works offline. The page carries each image once: the current draft holds its images, and the scrubber's earlier drafts, the diff, traces, and cuttings name theirs by hash for the page's script to fill in from a single store. Without JavaScript, only the current draft's images show. Ten drafts that share a screenshot carry one copy. Ten drafts in which four mocks all changed carry forty, about 8 MB at 200 KB each, which is the case `--drafts` already limits.

The live viewer re-fetches the whole page after every change and morphs it in place, so inlined images would be sent again each time. The viewer serves them from `/asset/<document>/<hash>.<ext>` instead, cached as immutable, and its page policy adds `img-src 'self'`. The route serves only files whose hash matches an image that the document or one of its drafts uses. Every response from it carries `Content-Security-Policy: sandbox`, because an SVG opened directly at that address would otherwise run its scripts on the viewer's origin, where the write cookie goes with every request and a script could approve the plan.

The viewer's watcher also reacts to image files, so a new screenshot updates the page without a markdown edit.

## Saving drafts <!-- id: snapshot -->

Snapshot finds every image reference in the body, hashes each file (SHA-256, first 16 hex characters), copies new ones to `.history/<name>/assets/<hash>.<ext>`, and writes the map on the revision:

```yaml
- id: r004
  created_at: 2026-10-14T10:02:11+02:00
  author: Claude
  summary: Settings mock shows the daily drafts toggle
  images:
    mocks/settings.png: 3f2a9c1e0b7d4a55
```

An image that didn't change between drafts is stored once. A missing file doesn't block the snapshot: the draft is saved with a warning, and nothing is recorded for that path. Approving a draft approves its images too, since they are recorded with it.

`revert` puts the draft's images back at their paths. It copies the current files into `assets/` first, so an image it overwrites can always be found again. `untrack` deletes the assets with the rest of the history and leaves the working images alone. `verify` reports a revision that names an asset that isn't there.

Existing histories need no migration. Drafts saved before this change have no `images` entry and show whatever is on disk, as they do now. `validateMeta` ignores revision keys it doesn't know and `serializeMeta` writes them back, so CLI 0.12 and plugin 0.3.2 keep `images` entries intact when they save. A draft saved by one of them has no entry and falls back to the files on disk.

## Diff, traces, and cuttings <!-- id: diff -->

`src/semdiff.ts` stays free of file access, because the Obsidian plugin shares it. Callers pass draft bodies with each image reference keyed by its hash, so `diffBlocks` sees a new screenshot at the same path as a changed block. A changed image renders as its two versions side by side, labelled with their drafts and stacked on a phone, as `::: diff` does. An added or removed image shows once, marked as new or cut. `renderDiffHtml` escapes every block as text today, so images are a new case there, and it takes a function that turns a hash into an image URL: a data URI in a static page, an `/asset/` address in the viewer, and a vault resource path in the plugin.

Traces show the current image with the previous one in the "As it was in r003" fold that changed directives already use. `collectCuttings` skips blocks of fewer than four words, which would drop every removed image, so images get their own rule there. A cut image shows as a thumbnail, and its copy button copies the markdown line.

## Comments on images <!-- id: comments -->

Comments anchor to selected text, and an image has none. In the live viewer, clicking an image opens the comment form for the whole image, and dragging across it draws a box. On a phone a touch still scrolls the page: a tap opens the comment for the whole image, and while that comment is open, a drag on the image draws the box. The comment stores the path, the hash of the image it was made on, the box as fractions of the image's width and height, and the image's size in pixels. The box stays drawn on the image until a later draft replaces it; after that, the comment links to the first draft that had the image it was made on.

`pentimento address` prints the image's file and the box in pixels:

```txt
[c-2026-10-02-001] on an image at #settings-screen — Lucas, 2026-10-02
  image: mocks/settings.png ("Settings with the daily drafts toggle off")
  file: .history/Plan/assets/9ae1dcd1896b136b.png
  on: box 32–480 × 66–154 of 640 × 220
  comment: The toggle should sit on the left, next to its label.
```

An agent that can read images opens the file and looks at that region.

## Mocks and prototypes <!-- id: prototypes -->

`pentimento guide` gets a section on mocks, and `SKILL.md` gets a line pointing to it. When the user asks for a mock, wireframe, or prototype, the agent does the following:

1. Writes a standalone HTML file next to the document, such as `mocks/settings.html`, with its CSS inline so a stylesheet that fails to load can't produce a blank screenshot.
2. Screenshots it headlessly at the size the design is for (1280 × 800 for a desktop, 390 × 844 for a phone) at a device scale of 1, which keeps a screen under 200 KB.
3. Embeds each state the reader needs to judge (empty, filled, an error) as its own image on its own line, with alt text that names the state.
4. After comments, edits the HTML and overwrites the PNG at the same path. The history keeps the earlier image, so versioned names like `settings-v2.png` aren't needed.

The guide gives a Playwright command and a Chromium fallback:

```bash
npx playwright screenshot --viewport-size=1280,800 --full-page "file://$PWD/mocks/settings.html" mocks/settings.png
chromium --headless --hide-scrollbars --window-size=1280,800 --screenshot="$PWD/mocks/settings.png" "file://$PWD/mocks/settings.html"
```

On this machine the Chromium command wrote an 8 KB PNG of a small settings mock. The guide also covers what went wrong while testing it. Ubuntu's snap-packaged Chromium can't write to `/tmp` and fails with "Failed to write file", so the files have to stay inside the project. Chromium's `--screenshot` captures the window rather than the page, which leaves blank space under a short page and cuts off a long one; Playwright's `--full-page` captures the whole page. And `npx playwright` refuses to run until `npx playwright install chromium` has downloaded the browser build that matches its version.

The HTML itself isn't saved in the history; only its screenshots are. When the user wants to click through a prototype, the agent sends them a link in chat. The viewer doesn't serve the HTML, and the document doesn't link to it, because the link stops working when the agent's server stops. On the same machine the link is the file's path. When the user reads from another device, the agent serves only the mocks folder, on the same Tailscale address as the viewer and a free port:

```bash
npx -y http-server mocks -a "$(tailscale ip -4)" -p 4835 -c-1
```

`-c-1` turns off caching, so an edited mock shows on reload. Serving the project folder instead would put every file in it on the tailnet, `.env` included. A prototype on its own port can't act on the plan: the viewer refuses requests from another origin.

## Lint and the Obsidian plugin <!-- id: lint-plugin -->

`pentimento lint` warns about an image file that doesn't exist, a remote image, an image without alt text, and an image over 1 MB.

`DraftStore` in `src/drafts.ts` reads and writes strings only. Two optional methods, `readBinary` and `writeBinary`, let a store save images. `saveDraft` skips images on a store that doesn't have them, so plugin 0.3.2 keeps working with the new package. The plugin implements them with `vault.adapter.readBinary` and `writeBinary`, resolves `![[...]]` with `metadataCache.getFirstLinkpathDest` (Obsidian's own lookup), and shows changed images in its panel through the same `renderDiffHtml`.

## Order of work <!-- id: order -->

::: timeline
1. **Render images from disk** [done] — Path resolution, data URIs in static pages, the viewer's asset route and watcher, and the lint rules.
2. **Keep images with drafts** [done] — Snapshot, the `images` map, the scrubber, `revert`, `untrack`, and `verify`.
3. **Image changes in the diff, traces, and cuttings** [done] — Both versions side by side, labelled with their drafts.
4. **Mocks and prototypes in the guide** [done] — `pentimento guide`, skill revision 12.
5. **Comments on images** [done] — Whole images and boxes, on desktop and phone.
6. **Plugin support** [later] — Tracked in pentimento-obsidian#4; it needs a package release with steps 1 to 3.
:::

Steps 1 to 5 are on the `images` branch, in review, and ship in one release. While testing, the viewer crashed on this machine because it had run out of file watchers; that is pentimento#5 and is separate from this work.
