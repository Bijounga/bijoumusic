# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Electron desktop app for Windows 11 (plain HTML, CSS and JS in a window; no browser, no server, no account). A Mac build is not planned.

## Users

One person: Ibrahim, a video editor who draws every thumbnail for his own YouTube channel from scratch in Procreate, Clip Studio Paint and Photoshop. He does not reuse assets or templates, so each thumbnail starts as a blank page. He works at a PC with a pen tablet, tests software by hand and reports what he sees in plain terms. Nobody else uses it, and it is not for clients.

## Product Purpose

Thumb Lab is where a video's thumbnail gets planned, compared and stress-tested before and while it is drawn, one project per video. It sits beside the drawing apps and does not replace them.

Success is a session that ends with:
- a confident pick, knowing why that version beats the others;
- fewer wasted renders, because weak sketches were killed before an hour of rendering;
- a thumbnail that was seen among real competitors in its niche and stands out.

## Positioning

The only tool that combines, per video: written ideas, sketches pulled live from the user's own PSD / CSP / Procreate files, small-size and blur / grayscale / squint tests, and a mock YouTube page filled with real videos from the video's niche, all in one local project. Web thumbnail testers each do one upload and one preview; none read the artist's working files or keep versions per video.

## Operating Context

- Art lives in other apps. Thumb Lab links PSD, CSP (.clip), Procreate and image files, reads a preview out of them, and refreshes it when the file is saved elsewhere. It never writes to those original files.
- Files arrive from a watched folder as well as by drop, paste and file picker.
- A sketch pad exists for quick roughs. Sketches are saved as layered PSD so Photoshop and CSP open them and Procreate imports them; the handoff to the drawing apps matters more than the pad's own power.
- Real competition videos come from the YouTube Data API with a key the user creates; without one, clearly labelled placeholder thumbnails are used.
- Everything is stored locally in one data folder. The user's other tools (Doodle Pad, BijouMusic, BijouDocs) are the same family of personal Electron apps.

## Capabilities and Constraints

- Per-video projects with: ideas (concepts), art import (Canvas), versions A/B/C (Variants) with a starred pick, a YouTube-page simulation (Test), and a project library.
- Tests: blur, grayscale, squint, applied to versions, the simulated feed and the sketch pad.
- Simulated page layouts: home feed, search results, watch-page sidebar, phone; light and dark; feed size and the thumbnail's position are adjustable; Shorts can be hidden.
- Global libraries (e.g. one per game) plus a per-project library; items drag out into other apps.
- Shared checklists (Readability, Story, Composition, editable) plus per-thumbnail checks.
- Constraints: Windows, local files only, no accounts or cloud. The YouTube API has a daily quota, so results are cached for a day. YouTube does not expose a person's personalised home feed, so "your own feed" cannot be shown.
- Undecided: analytics or click-through tracking; linking the user's own channel by handle; signing in with Google for subscriptions.

## Brand Commitments

- Name: Thumb Lab. App icon: the user's blue face drawing, cropped to a rounded square.
- It must feel like the user's other Bijou apps (Doodle Pad, BijouMusic, BijouDocs): the user asked for this explicitly. Prefers icons over text.

## Evidence on Hand

- Real PSD and CSP files from the user's own thumbnail work were used to verify previews.
- No click-through or performance data exists in the product; do not invent any.
- No YouTube API key is stored in the repository; real competition data only appears when the user adds one in Settings.

## Product Principles

1. **Judge before you render.** Cheap decisions come first: compare roughs tiny and blurred before committing hours to one.
2. **The artwork is the user's.** Link, preview and hand off; never modify the original files, and never make the app the place the art must live.
3. **Never fake a result.** Placeholder feeds are labelled as placeholders; real data comes only from the real source; empty states say so.
4. **Work with the drawing apps, not instead of them.** Every path in and out (folder watch, drag-out, PSD handoff, clipboard) should take one step.
5. **Quiet and personal.** One user, local data, no ceremony: the first screen shows the work, and options appear when needed.

## Accessibility & Inclusion

No product-specific requirement established. Icon-only controls carry a name that doubles as the accessible label and tooltip.
