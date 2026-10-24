# Thumb Lab: spec

A desktop app for planning, comparing and stress-testing YouTube thumbnails, one project per video. It sits beside Procreate, Clip Studio Paint and Photoshop. The art is still drawn from scratch in those apps; Thumb Lab is where ideas, rough sketches and finished versions are kept, judged and tested.

Stack: plain Electron (no build step), vanilla JS. Run with `npm start`; build with `npm run dist` → `release/win-unpacked/Thumb Lab.exe`.

## Structure

- **Project** = one video: title, niche, ideas, versions, its own library.
  - **Concepts**: written ideas before drawing (text, notes, status Idea / Sketching / Drawn / Rejected). "Sketch this" makes a blank sketch linked to the idea.
  - **Canvas**: bring art in. Link PSD / CSP (.clip) / Procreate / image files (they stay linked and refresh when saved elsewhere), drop, paste, or watch an inbox folder. Start a new sketch.
  - **Variants**: A / B / C versions side by side. Resize them, blur / grayscale / squint them, star a pick, and work through the checklist for the selected one.
  - **Test**: the YouTube page simulation.
  - **Library**: assets for this project, plus a browser for every global library.
- **Libraries** (left rail): global asset libraries (e.g. "Terraria"). Categories: Face, Character, Logo, Arrow, Background, Screenshot, Other. Items drag out into other apps.
- **Test checklist**: this app's own feature checklist, ticked by hand.
- **Settings**: YouTube API key, channel name, handoff folder, shared checklist, data folder.

## Reading the art files

| Format | How the preview is read |
| --- | --- |
| PSD | The flattened composite saved with the file (Maximize Compatibility). If it's missing, the visible layers are composited. |
| CSP .clip | The chunk container holds a SQLite database; its `CanvasPreview` table has a full-size PNG. |
| Procreate | `QuickLook/Thumbnail.png` inside the zip. |
| PNG / JPG / WebP / BMP / GIF | As is. |

Linked files are polled for changes every 1.2 s; a change is applied once the file size stops changing, so a half-saved PSD is never read.

## Tests

One shared setting, applied as a CSS filter to every thumbnail, the whole Test page and the sketch pad.

- **Blur**: heavy blur; strength slider. Sized relative to the thumbnail so it looks the same at any size.
- **Grayscale**: value separation.
- **Squint**: reduced detail and contrast.
- Alt+B / Alt+G / Alt+S. They can be combined.

## Test page

- Layouts: home feed, search results, watch-page sidebar, phone. Light / dark. Duration badge. Position (number box or click another slot). "Mark mine". Fit or real size.
- Version buttons swap the version in the feed; ← → cycle; "All" puts every version side by side.
- **Competition**: real videos via the YouTube Data API v3 (`search.list` + `videos.list` for view counts and durations) for the project's niche or a custom search; order Relevant / Most viewed / Newest. Results are cached for 24 hours per query, and the API key is stored encrypted with the OS keystore. Without a key, procedurally drawn placeholder thumbnails and titles are used.

## Sketch pad

Layered canvas (up to 24 layers) at 1280×720, 1920×1080 or 2560×1440. Stored as a layered PSD, so Photoshop and CSP open it directly and Procreate imports it.

Tools: **Pen** (pressure → width), **Pressure brush** (pressure → width and paint amount, soft edge), **Eraser** (pressure → width), **Pressure eraser** (pressure → width and amount erased), eyedropper, move layer. Per-tool size / opacity / softness / pressure→size / pressure→opacity / smoothing, plus a global pressure-feel curve. Undo/redo (40 steps), zoom/pan, mirror view, guides (thirds, safe margin, duration-badge zone), blur / grayscale / squint while drawing. Layers: add, duplicate, delete, reorder, hide, opacity, rename; import from a library, a file or the clipboard; scale.

Why not reuse the Doodle Pad engine: that is an opaque palette-pixel grid (no alpha, no soft edges), which can't do pressure that changes opacity. This pad uses real canvases, but keeps Doodle Pad's pen lessons (`touch-action: none`, handle `pointercancel`, never filter strokes by pointerId, coalesced events, Ctrl+Shift+D debug readout).

Drawing handoff:
- Autosaves (about 1 s after the last stroke) to the PSD and updates the version's preview.
- Open in default app (the layered PSD); save in that app and the pad reloads the layers.
- Save PSD / PNG as…, copy flattened image, drag a PNG or PSD chip into another app.
- Send PSD + PNG to a handoff folder (set it to an iCloud / Dropbox folder to open sketches in Procreate on the iPad).

## Checklist

Shared groups (Readability, Story, Composition by default; editable) apply to every thumbnail; each thumbnail also has its own extra items and its own ticks.

## Data

`<userData>/data/`: `settings.json`, `projects/<id>/project.json` with `img/`, `sketch/`, `library/files/`, `libraries/<id>/`, `cache/`, `temp/`. Original PSD / CSP files are never written to. Use `--user-data-dir` to run against a throwaway profile.

## Not in this version

Version history of a thumbnail's revisions, analytics / click-through tracking, AI scoring, native .clip or .procreate export, Premiere integration.
