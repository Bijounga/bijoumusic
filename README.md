# BijouMusic

A local, offline music/SFX library browser built for video editing — tag, filter, preview, and drag tracks straight into your timeline without ever leaving your desktop.

Built as an Electron + React + TypeScript desktop app for Windows, with a companion Adobe Premiere Pro extension for non-destructive import and in-timeline audio tools.

## Why

Most editors end up with a huge folder of downloaded music and SFX with no good way to search it — file names are a mess, there's no tagging, and dragging things into Premiere either destructively trims them or shoves your whole timeline forward. BijouMusic is a from-scratch answer to that: a fast local library with real tagging, waveform previews, and a Premiere integration that actually behaves.

## Features

- **Library browsing** — recursive folder scanning, move/rename-safe (tracks stay tagged even if you reorganize files on disk), virtualized track list for large libraries (20k+ tracks).
- **Tagging** — freeform tags with sections/groups, drag-to-reorganize, color-coded pills, AND-filtering, search with a per-search word/folder blacklist.
- **Favorites & Energy ratings**, aliases, bookmarks, and per-track loudness normalization.
- **Waveform playback** — two-layer canvas (static waveform + live playhead), click-to-seek, non-destructive in/out preview range marking, tag-color gradients.
- **Live audio visualizers** — a reactive ring, spectrum analyzer, and scrolling spectrogram, all colored by a track's own tags.
- **Projects** — group tracks for a specific video, track usage across projects.
- **Download to library** — paste a URL, pick a destination folder, and yt-dlp pulls the audio straight in (optional thumbnail-as-cover-art embedding), with instant tagging/rating right after.
- **Adobe Premiere Pro integration** (UXP + CEP extensions) — non-destructive drag/button import (trims are in/out marks on the original file, not a baked-down copy), batch gain/pitch/nudge tools on your current timeline selection, silence-cut via Premiere's native ripple-delete, and LUFS-based loudness normalize.

## Stack

Electron, React, TypeScript, Vite (via `electron-vite`), Zustand, better-sqlite3, `music-metadata`, `yt-dlp-wrap-plus`.

## Development

```bash
npm install
npm run dev        # electron-vite dev server
npm run build:win  # production Windows build (electron-builder)
npm run typecheck
```

## Project layout

```
src/
  main/       Electron main process — SQLite, scanning, IPC, downloader, Premiere bridge
  preload/    contextBridge-exposed, typed IPC surface
  renderer/   React UI (library, player, tags, projects, download modal, visualizers)
  shared/     Types and IPC channel names shared across processes
premiere-extension/       UXP panel — import, selection tools (gain/pitch/nudge/LUFS)
premiere-cep-extension/   CEP panel — native ripple-delete silence cutting
```

This is a personal tool, shared here as-is — issues/PRs aren't actively monitored, but feel free to fork it.
