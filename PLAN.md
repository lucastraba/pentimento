---
Vellum: true
Current Revision: r005
History Folder: ".history/PLAN"
Archetype: design-doc
---

# Vellum v1 — Living Plans

> Plans are markdown, versioned in place, rendered to constrained HTML. The agent writes content; the system owns the pixels.

## Why past HTML plans failed <!-- id: why; eyebrow: Diagnosis -->

Every prior failure — slop UI, wasted medium, inconsistency across plan types — is one disease: the agent was handed a *paint palette*. Vellum inverts it. A deterministic renderer, a fixed design system, and a small directive vocabulary. Any agent produces markdown plus directives; the toolchain produces the view.

This is Chunks 4+5 of the existing Vellum PRD (2026-05-14), fused with Claude Code plan mode and informed by the 2026-07-05 audit of Vellum Lite in Pandora.

## Decisions <!-- id: decisions; eyebrow: Locked · 2026-07-05 -->

::: callout decision id=d-source-of-truth
**Markdown is the source of truth.** HTML is a build product. Plan mode approves the markdown; the render is how Lucas reads it. This keeps plan mode's powers — research with writes blocked, explicit approval — fully intact.
:::

::: callout decision id=d-dual-delivery
**Dual delivery.** Every render writes a self-contained HTML file next to the plan (agent-portable). Claude additionally publishes it as a claude.ai Artifact. The Phase-2 local viewer serves the same files — if it works well, it becomes a publishable product.
:::

::: callout decision id=d-comment-ready
**Read-only v1, comment-ready architecture.** Anchored comments (the Antigravity-style review loop) are Phase 3 — but every rendered block gets a stable anchor id from day one, and `meta.yml` reserves the `comments:` schema. Retrofitting anchors would break old revisions. Hover any heading here: the `#` is the substrate.
:::

::: callout decision id=d-versioning
**Versioning is Vellum Lite, in-repo.** `PLAN.md` + `.history/PLAN/rNNN.md` + `meta.yml` decision log. Pure filesystem, same convention as Pandora — one mental model. The CLI is rewritten, not reused: the audit found the convention ports cleanly; the current implementation does not.
:::

## Architecture <!-- id: architecture; eyebrow: System -->

::: figure aria="Flow: PLAN.md through the vellum CLI to plan.html, delivered to the claude.ai Artifact and the local viewer; the CLI also writes revision history and meta.yml"
<svg viewBox="0 0 640 190" xmlns="http://www.w3.org/2000/svg">
  <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--soft)"/></marker></defs>
  <rect class="nodebox" x="8" y="40" width="110" height="36" rx="5"/>
  <text x="63" y="62" text-anchor="middle">PLAN.md</text>
  <rect class="accentbox" x="180" y="40" width="120" height="36" rx="5"/>
  <text x="240" y="62" text-anchor="middle">vellum CLI</text>
  <text class="lbl" x="240" y="94" text-anchor="middle">snapshot · diff · render</text>
  <rect class="nodebox" x="360" y="40" width="110" height="36" rx="5"/>
  <text x="415" y="62" text-anchor="middle">plan.html</text>
  <rect class="nodebox" x="522" y="10" width="110" height="36" rx="5"/>
  <text x="577" y="32" text-anchor="middle">Artifact</text>
  <rect class="nodebox" x="522" y="70" width="110" height="36" rx="5"/>
  <text x="577" y="92" text-anchor="middle">viewer</text>
  <text class="lbl" x="577" y="120" text-anchor="middle">Tailscale-only · Ph 2</text>
  <rect class="nodebox" x="180" y="136" width="220" height="36" rx="5"/>
  <text x="290" y="158" text-anchor="middle">.history/ rNNN.md + meta.yml</text>
  <path class="flow" d="M118 58 H176"/>
  <path class="flow" d="M300 58 H356"/>
  <path class="flow" d="M470 52 C 495 45, 500 35, 518 30"/>
  <path class="flow" d="M470 64 C 495 71, 500 81, 518 86"/>
  <path class="flow" d="M240 76 V132"/>
</svg>
:::

### vellum CLI v2 — TypeScript/Node <!-- id: cli -->

Commands: `snapshot`, `list`, `diff` (terminal patch or `--html` word-level diff page), `verify` (consistency fsck across a whole repo or vault — CI-able), `revert`, `render` — shipped at `repos/vellum`, on PATH via `npm link` (the legacy Obsidian-CDP helper is retired to `vellum-obsidian-legacy`). Fixes every audit finding by construction: snapshots bump `Current Revision` and refuse to overwrite existing revisions; frontmatter and `meta.yml` go through a real YAML parser (no lossy round-trips, no injection); `History Folder` is canonical-relative — the single path contract; timestamps use the actual local timezone; writes are temp-file-then-rename with a per-document lock.

The fix for the worst bug found in the audit (C1 — `snapshot` never bumps the revision, so the next run silently overwrites history) is also the diff-view demo:

::: diff head="~/.local/bin/vellum · cmd_snapshot() — the C1 fix, as implemented in core.ts"
```txt
 def cmd_snapshot(args):
     content = cli_read(args.path)
     next_num = current_rev(content) + 1
-    write_hidden_revision(
-        args.path, next_num, content)
-    # canonical untouched — next run
-    # recomputes the same next_num
+    write_hidden_revision(
+        args.path, next_num, content,
+        must_not_exist=True)
+    stamped = set_frontmatter(
+        content, rev=f"r{next_num:03d}")
+    atomic_write(args.path, stamped)
```
:::

### Design system — vellum.css <!-- id: design-system -->

- One stylesheet shipped by the toolchain (`assets/theme.css`). Both themes, token-level. Responsive by construction (desktop / iPad / iPhone).
- Three palettes, switchable in the page chrome: **Iris** (violet, the default), **Verdigris** (serif-forward teal), **Mist** (Apple/Vercel neutrals + blue, sans headings). Per-doc override via `Palette:` frontmatter; the reader's own pick (localStorage) wins over both. Palettes are token sets; agents can't define colors.
- Standard chrome components: collapsible table of contents, evolution strip (from `meta.yml`), block anchors rendered as `#` (hover-revealed).
- Archetypes share every component; each archetype sets an accent hue + badge so the plan's *kind* is legible at a glance.
- Hard rules: agents never write CSS, `style=""`, or JS. Interactivity is a fixed snippet (`assets/chrome.js`).

### Renderer — deterministic markdown → HTML <!-- id: renderer -->

`markdown-it` plus container directives — the agent's entire expressive surface: `::: callout`, `::: verdict`, `::: findings`, `::: timeline`, `::: diff`, `::: figure`, plus plain tables (auto-wrapped, scrollable) and `{dot:...}` swatches. Diffs are written as unified diffs and rendered side-by-side on wide screens, unified on narrow — no client-side diff library, which also satisfies the Artifact CSP. Every heading gets a stable anchor id (the comment substrate). Output is a standalone HTML document by default (doctype, viewport — works served raw on any device); `--artifact` emits the fragment form claude.ai wraps itself. Agent-supplied HTML/SVG is stripped of active content (scripts, event handlers, javascript: URLs) at render time. Every render embeds a collapsible **What changed in rNNN** panel — a block-aware, word-level diff against the previous snapshot with unchanged runs collapsed — so a reader never has to ask the agent what a revision touched. This page is rendered by `vellum render PLAN.md` — the toolchain eating its own dogfood.

### The skill <!-- id: skill -->

`/vellum-plan`, symlinked from `repos/vellum/skill/` into `~/.claude/skills/`. It teaches any agent the loop: research (in plan mode) → pick an archetype and write the markdown against its skeleton (`references/archetypes.md`) → `vellum snapshot` with a reader-facing summary → `vellum render` → publish (Artifact for Claude, viewer for others). On feedback: revise, snapshot, re-render — same URL, history accretes. The CLI contract is what makes it portable to other agents.

## Archetypes <!-- id: archetypes; eyebrow: Vocabulary, not palette -->

Flexibility is choosing the archetype and which sanctioned components to use. Consistency is everything else being fixed.

| Archetype | Job | Signature components |
|---|---|---|
| {dot:impl}Implementation plan | Approve and execute | phase timeline, file-touch table, diff views, risk callouts |
| {dot:brain}Brainstorm / exploration | Compare directions | option cards, decision matrix, open questions |
| {dot:audit}Audit / review | Report findings | verdict banner, severity-grouped findings, evidence links |
| {dot:design}Design doc / PRD | Record a vision | architecture diagrams, decision log, compare tables |

## Build order <!-- id: build; eyebrow: Sequence -->

::: timeline
1. **CLI core + design system + renderer + skill** [done] — Shipped 2026-07-05: `snapshot`/`list`/`diff`/`revert`/`render`, `theme.css` with three palettes, deterministic renderer (13 tests green), `/vellum-plan` skill. This page is its output.
2. **Local viewer** [next] — Hono daemon bound to the Tailscale IP only — never 0.0.0.0 on nyx. Watches `.history/`, SSE hot reload, revision picker, diff pane. If it's good, productize it.
3. **Anchored comments** [later] — Click a block in the viewer → comment lands in `meta.yml`; `vellum address` has the agent read open comments, revise, snapshot, resolve. The Antigravity loop.
:::

## What the audit found <!-- id: audit; eyebrow: Audit · Vellum Lite in Pandora · 2026-07-05 -->

::: verdict
- Works correctly? :: Partially
- Efficient? :: Convention yes, tooling no
- Portable? :: Yes — easily
:::

The convention is sound. The implementation shelled every file operation through a headless Electron Obsidian (~350 MB resident, permanently) — coupling that is 100% incidental. Three of the six real documents were internally inconsistent, and all three were maintained by hand: the documented manual workflow doesn't self-enforce.

::: findings
- CRIT :: `snapshot` never bumps `Current Revision` — the next run silently overwrites history and duplicates the meta entry.
- CRIT :: `create` always clobbers: `overwrite=args.overwrite or True` is always true. One wrong command destroys current and archived state.
- CRIT :: `History Folder` contract mismatch: docs say note-relative, CLI resolves vault-root-relative — three real docs would split their history across two locations.
- HIGH :: 3 of 6 real docs inconsistent: a phantom r002 with no file, frontmatter ahead of history, and one "snapshot" that is a 198-byte stub — the real initial version was never preserved.
- HIGH :: `meta.yml` is wholesale-replaced if it doesn't start with `revisions:` — a leading comment erases the audit trail.
- HIGH :: Frontmatter round-trip is lossy: multi-line lists flattened to `""`, and quote-stripping left invalid YAML in two live notes.
@collapse Medium and low findings (10)
- MED :: Hardcoded UTC+2 — wrong by an hour all winter; two timestamp formats coexist in meta files.
- MED :: 60s subprocess timeout vs a wrapper that can poll for minutes — unhandled traceback when Obsidian is down.
- MED :: No atomicity or locking: a crash mid-update leaves meta claiming a revision the canonical doesn't reflect.
- MED :: YAML injection via `--author` and id fields — interpolated raw into meta.yml.
- MED :: Revision parsing grabs the first digit run anywhere in the value; hand-edited values yield absurd next revisions.
- LOW :: Obsidian hides `.history` by default (good) — but that means history is unreachable from inside Obsidian; terminal only.
- LOW :: Syncthing syncs `.history` (good), but the vault shows heavy conflict history; conflict copies inside `.history/` would corrupt the rNNN invariant.
- LOW :: `~/jdhkc-p67vw` was a stale May orphan of the vault from a Syncthing folder-ID share — archived and removed 2026-07-05.
- LOW :: Adoption was thin: 6 real docs, while 11+ evolving docs created since the convention landed don't use it. Legacy `v2`/`v3` siblings still sit unmigrated.
- LOW :: The Syncthing `path="~"` entry is the stock `<defaults>` template, shared with no device — a false alarm, and the explanation for where the orphan folder came from.
:::

### Pandora remediation — approved and executed 2026-07-05 <!-- id: remediation -->

- Repaired the 3 inconsistent documents (backup at `backups/pandora-vellum-repair-20260705/`): Large Dataset's phantom r002 reconstructed; Zomboid frontmatter reset to r001; Ritual Route given an honest repair-snapshot r002; Vellum Operating Notes stamped r002; invalid `Type:` YAML fixed in two notes.
- Replaced `~/.local/bin/vellum` with CLI v2 (legacy kept as `vellum-obsidian-legacy`); the headless-Obsidian dependency is no longer needed for file writes.
- Archived and removed the `~/jdhkc-p67vw` orphan (tar.gz in `backups/`).
- Still pending, needs explicit approval: migrating legacy `v2`/`v3` siblings (Amity PRD ×4, Nyx/Anima ×5).

## Open questions <!-- id: open; eyebrow: Unresolved -->

- Final public name: `vellum` on npm is likely blocked by the Vellum AI trademark orbit; the package is scoped `@lucastraba/vellum` for now (PRD candidate `palimpsest` remains available). CLI surface stays `vellum`.
- Comment transport for Phase 3: how anchored comments travel from a published Artifact back to the agent (the local viewer has an obvious path; the Artifact doesn't).
- Whether Pandora's evolving notes should adopt `vellum render` for reading, or stay markdown-only inside Obsidian.
- Mermaid: deferred — v1 diagrams are constrained inline SVG via `::: figure`; revisit if hand-composed SVG becomes the bottleneck.
