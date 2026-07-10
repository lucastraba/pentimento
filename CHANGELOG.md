# Changelog

## 0.6.0 - 2026-07-10

Pentimento 0.6 keeps the product intentionally focused: one person and one agent revising one canonical Markdown document, with private remote viewing when needed.

### Added

- Six reader palettes with automatic, light, and dark schemes, plus a persistent personal default.
- A workspace document index and live revision viewer with historical and diff navigation.
- Selection-anchored reader comments, replies, resolution history, and recoverable drafts.
- Private non-loopback write links that exchange a short-lived capability for an HttpOnly browser session.
- A protected Stop viewer control that gracefully closes only its own server process.
- Explicit `Draft after rNNN` state when canonical content differs from its latest snapshot.
- `pentimento --version` and side-effect-free command help.

### Changed

- Improved document hierarchy, wide tables and diagrams, print output, mobile controls, empty-workspace guidance, keyboard focus, and comments-drawer accessibility.
- Made snapshot, revert, comment resolution, and metadata updates recoverable and validated before mutation.
- Updated the bundled agent skill to serve a live viewer by default and documented the single-user VPS/Tailscale workflow.
- Expanded CI across Node 20.13, 22, and 24, including a clean packed-package installation smoke test.

### Security

- Raw Markdown HTML is inert; renderer-owned SVG and directives are constrained and sanitized.
- Revision and workspace paths are validated against traversal, symlink escapes, and metadata mismatches.
- Remote mutations require capability, Origin, JSON content type, size limits, and scoped browser ownership checks.
- Viewer pages use restrictive CSP, framing, referrer, content-type, and cache headers.
- Updated `diff` to 9.0.0, clearing the known runtime dependency advisory.

### Upgrade note

Non-loopback viewers now print separate private write and read-only links. Use the write link once in a trusted browser; Pentimento immediately removes the capability from the visible URL. Existing loopback workflows remain writable without this exchange.
