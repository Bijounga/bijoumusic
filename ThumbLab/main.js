/**
 * Thumb Lab - Electron main process.
 *
 * Owns everything that touches disk or the OS: the data folder (JSON per project,
 * images beside it), reading previews out of PSD / CSP / Procreate files, watching linked
 * files and the per-project inbox folder, the YouTube Data API, and drag-out to other apps.
 *
 * Data layout under <userData>/data:
 *   settings.json
 *   projects/<id>/project.json, img/, sketch/, library/files/
 *   libraries/<id>/library.json, files/
 *   cache/yt-<hash>.json
 *   temp/            drag-out and handoff scratch files
 */
const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const files = require("./lib/files");

const DATA = path.join(app.getPath("userData"), "data");
const dirs = {
  projects: path.join(DATA, "projects"),
  libraries: path.join(DATA, "libraries"),
  cache: path.join(DATA, "cache"),
  temp: path.join(DATA, "temp"),
};
const SETTINGS_FILE = path.join(DATA, "settings.json");

let win = null;

// ---- small fs helpers --------------------------------------------------------

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(file, obj) {
  ensure(path.dirname(file));
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

/** Resolves a data-relative path and refuses anything that escapes the data folder. */
function inData(rel) {
  const abs = path.resolve(DATA, rel);
  if (abs !== DATA && !abs.startsWith(DATA + path.sep)) throw new Error("Path is outside the data folder.");
  return abs;
}

function safeId(id) {
  if (!/^[\w-]+$/.test(String(id))) throw new Error("Bad id.");
  return id;
}

// ---- window ------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#12121a",
    title: "Thumb Lab",
    icon: path.join(__dirname, "app", "assets", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.on("closed", () => { win = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    ensure(DATA);
    createWindow();
    app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on("window-all-closed", () => {
    stopWatching();
    if (process.platform !== "darwin") app.quit();
  });
}

// ---- store -------------------------------------------------------------------

function loadSettings() {
  const s = readJson(SETTINGS_FILE, {});
  return s;
}

ipcMain.handle("store:load", () => {
  ensure(DATA);
  const settings = loadSettings();
  const projects = [];
  if (fs.existsSync(dirs.projects)) {
    for (const id of fs.readdirSync(dirs.projects)) {
      const p = readJson(path.join(dirs.projects, id, "project.json"), null);
      if (p && p.id) projects.push(p);
    }
  }
  const libraries = [];
  if (fs.existsSync(dirs.libraries)) {
    for (const id of fs.readdirSync(dirs.libraries)) {
      const l = readJson(path.join(dirs.libraries, id, "library.json"), null);
      if (l && l.id) libraries.push(l);
    }
  }
  const { ytKeyEnc, ...publicSettings } = settings;
  return { dataDir: DATA, settings: publicSettings, hasKey: !!ytKeyEnc, projects, libraries };
});

ipcMain.handle("store:saveSettings", (_e, patch) => {
  const cur = loadSettings();
  writeJson(SETTINGS_FILE, { ...cur, ...patch, ytKeyEnc: cur.ytKeyEnc });
  return true;
});

ipcMain.handle("store:saveProject", (_e, project) => {
  safeId(project.id);
  writeJson(path.join(dirs.projects, project.id, "project.json"), project);
  return true;
});

ipcMain.handle("store:deleteProject", (_e, id) => {
  safeId(id);
  fs.rmSync(path.join(dirs.projects, id), { recursive: true, force: true });
  return true;
});

ipcMain.handle("store:saveLibrary", (_e, lib) => {
  safeId(lib.id);
  writeJson(path.join(dirs.libraries, lib.id, "library.json"), lib);
  return true;
});

ipcMain.handle("store:deleteLibrary", (_e, id) => {
  safeId(id);
  fs.rmSync(path.join(dirs.libraries, id), { recursive: true, force: true });
  return true;
});

ipcMain.handle("file:write", (_e, { rel, bytes }) => {
  const abs = inData(rel);
  ensure(path.dirname(abs));
  fs.writeFileSync(abs, Buffer.from(bytes));
  return abs;
});

ipcMain.handle("file:copyIn", (_e, { src, rel }) => {
  const abs = inData(rel);
  ensure(path.dirname(abs));
  fs.copyFileSync(src, abs);
  return abs;
});

ipcMain.handle("file:remove", (_e, abs) => {
  const p = path.resolve(abs);
  if (!p.startsWith(DATA + path.sep)) return false;
  fs.rmSync(p, { recursive: true, force: true });
  return true;
});

ipcMain.handle("file:read", (_e, p) => fs.readFileSync(p));

ipcMain.handle("os:sendToFolder", (_e, { dir, base, png, psd }) => {
  ensure(dir);
  const names = [];
  if (psd) { fs.writeFileSync(path.join(dir, `${base}.psd`), Buffer.from(psd)); names.push(`${base}.psd`); }
  if (png) { fs.writeFileSync(path.join(dir, `${base}.png`), Buffer.from(png)); names.push(`${base}.png`); }
  return names.join(" + ");
});

ipcMain.handle("file:stat", (_e, p) => {
  try {
    const st = fs.statSync(p);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch (e) {
    return null;
  }
});

// ---- dialogs / OS ------------------------------------------------------------

const ART_FILTERS = [
  { name: "Art files", extensions: ["psd", "clip", "procreate", "png", "jpg", "jpeg", "webp", "bmp", "gif"] },
  { name: "All files", extensions: ["*"] },
];
const IMAGE_FILTERS = [{ name: "Images and art", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "psd", "clip", "procreate"] }];

ipcMain.handle("dialog:pickFiles", async (_e, { title, multi, images }) => {
  const r = await dialog.showOpenDialog(win, {
    title: title || "Choose files",
    properties: multi ? ["openFile", "multiSelections"] : ["openFile"],
    filters: images ? IMAGE_FILTERS : ART_FILTERS,
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle("dialog:pickFolder", async (_e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || "Choose a folder", properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("dialog:saveAs", async (_e, { bytes, name, ext }) => {
  const r = await dialog.showSaveDialog(win, {
    title: "Save",
    defaultPath: `${name}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  return r.filePath;
});

ipcMain.handle("os:copyImage", (_e, bytes) => {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (img.isEmpty()) throw new Error("The image could not be copied.");
  clipboard.writeImage(img);
  return true;
});

ipcMain.handle("os:readClipboardImage", () => {
  const img = clipboard.readImage();
  return img.isEmpty() ? null : img.toPNG();
});

ipcMain.handle("os:open", async (_e, p) => {
  const err = await shell.openPath(p);
  return err || null;
});

ipcMain.handle("os:reveal", (_e, p) => {
  shell.showItemInFolder(p);
  return true;
});

ipcMain.handle("os:writeTemp", (_e, { name, bytes }) => {
  ensure(dirs.temp);
  const file = path.join(dirs.temp, name.replace(/[\\/:*?"<>|]/g, "_"));
  fs.writeFileSync(file, Buffer.from(bytes));
  return file;
});

ipcMain.on("os:startDrag", (e, file) => {
  let icon = nativeImage.createFromPath(file);
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
  else icon = icon.resize({ width: 96 });
  e.sender.startDrag({ file, icon });
});

// ---- art file previews + PSD -------------------------------------------------

ipcMain.handle("art:preview", async (_e, file) => {
  const r = await files.readFlat(file);
  const st = fs.statSync(file);
  return { ...r, mtimeMs: st.mtimeMs, type: files.typeOf(file) };
});

ipcMain.handle("art:readPsdLayers", (_e, file) => files.readPsdLayers(file));

ipcMain.handle("art:writePsd", (_e, { rel, abs, width, height, layers, flat }) => {
  const target = abs || inData(rel);
  ensure(path.dirname(target));
  files.writePsdFile(
    target, width, height,
    layers.map((l) => ({ ...l, rgba: Buffer.from(l.rgba) })),
    Buffer.from(flat)
  );
  noteOwnWrite(target);
  return target;
});

// ---- watching ----------------------------------------------------------------

const watched = new Map(); // key -> { path, mtimeMs, size, pending }
let folderWatch = null; // { dir, sig }
let pollTimer = null;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollWatchers, 1200);
}

function stopWatching() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function noteOwnWrite(p) {
  for (const w of watched.values()) {
    if (w.path === p) {
      try {
        const st = fs.statSync(p);
        w.mtimeMs = st.mtimeMs; w.size = st.size; w.pending = null;
      } catch (e) { /* gone */ }
    }
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function pollWatchers() {
  for (const [key, w] of watched) {
    let st;
    try { st = fs.statSync(w.path); } catch (e) { continue; }
    if (st.mtimeMs !== w.mtimeMs || st.size !== w.size) {
      // Wait until the size stops changing so a half-saved PSD is never read.
      if (w.pending && w.pending.mtimeMs === st.mtimeMs && w.pending.size === st.size) {
        w.mtimeMs = st.mtimeMs; w.size = st.size; w.pending = null;
        send("watch:changed", { key, path: w.path, mtimeMs: st.mtimeMs });
      } else {
        w.pending = { mtimeMs: st.mtimeMs, size: st.size };
      }
    }
  }
  if (folderWatch) pollFolder();
}

function listFolder(dir, recursive) {
  const out = [];
  const now = Date.now();
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (out.length >= 2000) return;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (recursive && depth < 3 && !ent.name.startsWith(".") && ent.name !== "node_modules") walk(full, depth + 1);
        continue;
      }
      if (!files.ALL_EXT.has(path.extname(ent.name).toLowerCase())) continue;
      let st;
      try { st = fs.statSync(full); } catch (e) { continue; }
      // Skip files still being written.
      if (!st.isFile() || now - st.mtimeMs < 1500) continue;
      out.push({ path: full, name: ent.name, mtimeMs: st.mtimeMs, size: st.size });
    }
  };
  walk(dir, 0);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

function pollFolder() {
  const list = listFolder(folderWatch.dir, folderWatch.recursive);
  const sig = list.map((f) => `${f.path}|${f.mtimeMs}|${f.size}`).join("\n");
  if (sig !== folderWatch.sig) {
    folderWatch.sig = sig;
    send("folder:files", { dir: folderWatch.dir, files: list });
  }
}

ipcMain.handle("watch:files", (_e, list) => {
  const next = new Map();
  for (const { key, path: p } of list) {
    const old = watched.get(key);
    if (old && old.path === p) { next.set(key, old); continue; }
    let st = null;
    try { st = fs.statSync(p); } catch (e) { /* not there yet */ }
    next.set(key, { path: p, mtimeMs: st ? st.mtimeMs : 0, size: st ? st.size : 0, pending: null });
  }
  watched.clear();
  for (const [k, v] of next) watched.set(k, v);
  startPolling();
  return true;
});

ipcMain.handle("watch:folder", (_e, opts) => {
  folderWatch = opts && opts.dir ? { dir: opts.dir, recursive: !!opts.recursive, sig: null } : null;
  if (folderWatch) { startPolling(); pollFolder(); }
  return true;
});

// ---- YouTube Data API --------------------------------------------------------

function getKey() {
  const enc = loadSettings().ytKeyEnc;
  if (!enc) return null;
  try {
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(enc, "base64"))
      : Buffer.from(enc, "base64").toString("utf8");
  } catch (e) {
    return null;
  }
}

ipcMain.handle("yt:setKey", (_e, key) => {
  const cur = loadSettings();
  if (!key) {
    delete cur.ytKeyEnc;
  } else {
    cur.ytKeyEnc = (safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(key)
      : Buffer.from(key, "utf8")).toString("base64");
  }
  writeJson(SETTINGS_FILE, cur);
  return !!cur.ytKeyEnc;
});

async function ytGet(endpoint, params) {
  const key = getKey();
  if (!key) throw new Error("No YouTube API key saved. Add one in Settings.");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error && json.error.message ? json.error.message : `HTTP ${res.status}`;
    throw new Error(`YouTube says: ${msg.replace(/<[^>]+>/g, "")}`);
  }
  return json;
}

function isoDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return "";
  const [d, h, mi, s] = [m[1], m[2], m[3], m[4]].map((n) => parseInt(n || "0", 10));
  const hours = h + d * 24;
  const pad = (n) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}`;
}

ipcMain.handle("yt:test", async () => {
  await ytGet("videos", { part: "id", chart: "mostPopular", maxResults: "1" });
  return true;
});

ipcMain.handle("yt:niche", async (_e, { query, order, force, pages }) => {
  const q = String(query || "").trim();
  if (!q) throw new Error("Pick a niche or type a search first.");
  const wantPages = Math.min(3, Math.max(1, parseInt(pages, 10) || 1));
  const hash = crypto.createHash("sha1").update(`${q}|${order}`).digest("hex").slice(0, 16);
  const cacheFile = path.join(dirs.cache, `yt-${hash}.json`);
  const cached = readJson(cacheFile, null);
  // A saved copy only counts if it already holds enough result pages.
  if (cached && !force && (cached.pages || 1) >= wantPages && Date.now() - cached.at < 24 * 3600 * 1000) {
    return { videos: cached.videos, cached: true, at: cached.at };
  }

  // Each search page is up to 50 videos (100 quota units each).
  const found = [];
  let pageToken;
  for (let n = 0; n < wantPages; n++) {
    const page = await ytGet("search", {
      part: "snippet", type: "video", maxResults: "50", q, order: order || "relevance", videoEmbeddable: "any",
      ...(pageToken ? { pageToken } : {}),
    });
    found.push(...(page.items || []));
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  const seen = new Set();
  const search = { items: found.filter((i) => i.id && i.id.videoId && !seen.has(i.id.videoId) && seen.add(i.id.videoId)) };
  const ids = search.items.map((i) => i.id.videoId);
  const detailItems = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await ytGet("videos", { part: "statistics,contentDetails", id: ids.slice(i, i + 50).join(",") });
    detailItems.push(...(d.items || []));
  }
  const byId = new Map(detailItems.map((v) => [v.id, v]));
  const videos = (search.items || []).filter((i) => i.id && i.id.videoId).map((i) => {
    const d = byId.get(i.id.videoId);
    return {
      id: i.id.videoId,
      title: i.snippet.title.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
      channel: i.snippet.channelTitle,
      thumb: `https://i.ytimg.com/vi/${i.id.videoId}/mqdefault.jpg`,
      published: i.snippet.publishedAt,
      views: d && d.statistics ? parseInt(d.statistics.viewCount || "0", 10) : 0,
      duration: d && d.contentDetails ? isoDuration(d.contentDetails.duration) : "",
    };
  });
  ensure(dirs.cache);
  writeJson(cacheFile, { at: Date.now(), query: q, order, pages: wantPages, videos });
  return { videos, cached: false, at: Date.now() };
});
