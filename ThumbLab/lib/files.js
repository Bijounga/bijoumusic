/**
 * Pulls a flat preview image out of the art files Ibrahim draws in.
 * Every reader returns { kind: "png"|"rgba", ... } so the renderer can turn it into a bitmap:
 *   png  -> { png: Buffer }
 *   rgba -> { width, height, rgba: Buffer }
 */
const fs = require("fs");
const path = require("path");
const { readEntry } = require("./zip");

const PSD_EXT = new Set([".psd", ".psb"]);
const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);
const ALL_EXT = new Set([...PSD_EXT, ...IMG_EXT, ".clip", ".procreate"]);

function typeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (PSD_EXT.has(ext)) return "psd";
  if (ext === ".clip") return "clip";
  if (ext === ".procreate") return "procreate";
  if (IMG_EXT.has(ext)) return "image";
  return null;
}

// ---- PSD -------------------------------------------------------------------

let agPsd;
function psdLib() {
  if (!agPsd) {
    agPsd = require("ag-psd");
    // Raw pixel buffers only; nothing here ever draws, so a canvas is never needed.
    agPsd.initializeCanvas(
      () => { throw new Error("Canvas is not available in the main process."); },
      (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
    );
  }
  return agPsd;
}

function asBuffer(data) {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function hasPixels(img) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] !== 0) return true;
  return false;
}

/** Normal-blend composite of the visible layers, for PSDs saved without Maximize Compatibility. */
function compositeLayers(psd) {
  const W = psd.width, H = psd.height;
  const out = new Uint8ClampedArray(W * H * 4);
  const walk = (layers) => {
    for (const l of layers || []) {
      if (l.children) {
        if (!l.hidden) walk(l.children);
        continue;
      }
      if (l.hidden || !l.imageData) continue;
      const op = l.opacity === undefined ? 1 : l.opacity;
      const { width: lw, height: lh, data } = l.imageData;
      const ox = l.left || 0, oy = l.top || 0;
      for (let y = 0; y < lh; y++) {
        const dy = y + oy;
        if (dy < 0 || dy >= H) continue;
        for (let x = 0; x < lw; x++) {
          const dx = x + ox;
          if (dx < 0 || dx >= W) continue;
          const s = (y * lw + x) * 4, d = (dy * W + dx) * 4;
          const sa = (data[s + 3] / 255) * op;
          if (sa <= 0) continue;
          const da = out[d + 3] / 255;
          const oa = sa + da * (1 - sa);
          for (let c = 0; c < 3; c++) {
            out[d + c] = (data[s + c] * sa + out[d + c] * da * (1 - sa)) / oa;
          }
          out[d + 3] = oa * 255;
        }
      }
    }
  };
  walk(psd.children);
  return { width: W, height: H, data: out };
}

function readPsdFlat(file) {
  const buf = fs.readFileSync(file);
  const { readPsd } = psdLib();
  try {
    const psd = readPsd(buf, { useImageData: true, skipLayerImageData: true, skipThumbnail: true });
    if (psd.imageData && hasPixels(psd.imageData)) {
      const r = psd.imageData;
      return { kind: "rgba", width: r.width, height: r.height, rgba: asBuffer(r.data) };
    }
  } catch (e) { /* fall through to the layer composite */ }
  const full = readPsd(buf, { useImageData: true, skipThumbnail: true });
  const c = compositeLayers(full);
  return {
    kind: "rgba", width: c.width, height: c.height, rgba: asBuffer(c.data),
    warning: "This PSD has no flattened copy (Maximize Compatibility was off), so the preview was rebuilt from its layers.",
  };
}

/** Layers of a PSD for the sketch pad, bottom first. */
function readPsdLayers(file) {
  const { readPsd } = psdLib();
  const psd = readPsd(fs.readFileSync(file), { useImageData: true, skipThumbnail: true });
  const layers = [];
  const walk = (list) => {
    for (const l of list || []) {
      if (l.children) { walk(l.children); continue; }
      if (!l.imageData) continue;
      layers.push({
        name: l.name || "Layer",
        hidden: !!l.hidden,
        opacity: l.opacity === undefined ? 1 : l.opacity,
        left: l.left || 0, top: l.top || 0,
        width: l.imageData.width, height: l.imageData.height,
        rgba: asBuffer(l.imageData.data),
      });
    }
  };
  walk(psd.children);
  return { width: psd.width, height: psd.height, layers };
}

/** layers: [{ name, hidden, opacity, rgba (canvas-sized RGBA bytes) }], bottom first. */
function writePsdFile(file, width, height, layers, flat) {
  const { writePsd } = psdLib();
  const u8 = (b) => new Uint8ClampedArray(b.buffer, b.byteOffset, b.byteLength);
  const children = layers.map((l) => ({
    name: l.name,
    hidden: !!l.hidden,
    opacity: l.opacity,
    left: 0, top: 0, right: width, bottom: height,
    imageData: { width, height, data: u8(l.rgba) },
  }));
  const psd = { width, height, imageData: { width, height, data: u8(flat) }, children };
  const out = Buffer.from(writePsd(psd, { generateThumbnail: false, trimImageData: false }));
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
}

// ---- Clip Studio Paint -----------------------------------------------------
// A .clip file is a chunk container holding a SQLite database; its CanvasPreview
// table holds a PNG of the whole canvas.

let sqlPromise;
function sqlJs() {
  if (!sqlPromise) {
    const initSqlJs = require("sql.js");
    const wasm = path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm");
    sqlPromise = initSqlJs({ locateFile: () => wasm });
  }
  return sqlPromise;
}

function findSqliteChunk(buf) {
  // Chunks: 8-byte tag, 8-byte big-endian length, data.
  let pos = 24;
  while (pos + 16 <= buf.length) {
    const tag = buf.toString("latin1", pos, pos + 8);
    if (!tag.startsWith("CHNK")) break;
    const size = Number(buf.readBigUInt64BE(pos + 8));
    if (tag === "CHNKSQLi") return buf.subarray(pos + 16, pos + 16 + size);
    pos += 16 + size;
  }
  const at = buf.indexOf("SQLite format 3\0", 0, "latin1");
  return at >= 0 ? buf.subarray(at) : null;
}

async function readClipFlat(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("latin1", 0, 8) !== "CSFCHUNK") throw new Error("Not a Clip Studio file.");
  const sqlite = findSqliteChunk(buf);
  if (!sqlite) throw new Error("This .clip file has no preview inside.");
  const SQL = await sqlJs();
  const db = new SQL.Database(new Uint8Array(sqlite));
  try {
    const res = db.exec("SELECT ImageData FROM CanvasPreview ORDER BY length(ImageData) DESC LIMIT 1");
    const blob = res[0] && res[0].values[0] && res[0].values[0][0];
    if (!blob) throw new Error("This .clip file has no preview image.");
    return { kind: "png", png: Buffer.from(blob) };
  } finally {
    db.close();
  }
}

// ---- Procreate -------------------------------------------------------------

function readProcreateFlat(file) {
  const png = readEntry(fs.readFileSync(file), "QuickLook/Thumbnail.png");
  if (!png) throw new Error("This Procreate file has no preview inside.");
  return { kind: "png", png };
}

// ---- Entry point -----------------------------------------------------------

async function readFlat(file) {
  const type = typeOf(file);
  if (type === "psd") return readPsdFlat(file);
  if (type === "clip") return readClipFlat(file);
  if (type === "procreate") return readProcreateFlat(file);
  if (type === "image") return { kind: "png", png: fs.readFileSync(file) };
  throw new Error("Unsupported file type.");
}

module.exports = { ALL_EXT, typeOf, readFlat, readPsdLayers, writePsdFile };
