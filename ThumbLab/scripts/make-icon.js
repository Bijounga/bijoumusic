// Builds the app icon from a source picture:  electron scripts/make-icon.js <source> <centerX> <centerY> <size>
// Crops a square window (centre and size in source pixels), rounds the corners, and writes
// build/icon.png (512), build/icon.ico (16-256) and app/assets/icon.png (256).
const { app, nativeImage, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function roundMask(bitmap, size, radius) {
  // bitmap is BGRA; clear alpha outside a rounded square.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
      let a = 1;
      if (cx < radius && cy < radius) {
        const d = Math.hypot(radius - cx - 0.5, radius - cy - 0.5);
        a = Math.max(0, Math.min(1, radius - d + 0.5));
      }
      const i = (y * size + x) * 4;
      bitmap[i + 3] = Math.round(bitmap[i + 3] * a);
      // premultiply colour for the bitmap -> image path
      for (let c = 0; c < 3; c++) bitmap[i + c] = Math.round(bitmap[i + c] * a);
    }
  }
}

function render(img, size) {
  const scaled = img.resize({ width: size, height: size, quality: "best" });
  const bmp = Buffer.from(scaled.toBitmap());
  roundMask(bmp, size, Math.round(size * 0.2));
  return nativeImage.createFromBitmap(bmp, { width: size, height: size }).toPNG();
}

/** ICO with PNG-compressed entries (supported since Windows Vista). */
function ico(pngs) {
  const head = Buffer.alloc(6 + pngs.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}

/**
 * Decodes the source through Chromium (nativeImage can't read WebP) and returns a PNG of a
 * square window onto it. The window may extend past the picture; that area is white.
 */
async function cropSquare(src, cx, cy, size) {
  const win = new BrowserWindow({ show: false, webPreferences: { webSecurity: false } });
  await win.loadURL("about:blank");
  const url = "file:///" + src.split("\\").join("/");
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = ${size};
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, ${size}, ${size});
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, ${size / 2 - cx}, ${size / 2 - cy});
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("could not decode the image"));
    img.src = ${JSON.stringify(url)};
  })`);
  win.destroy();
  return nativeImage.createFromDataURL(dataUrl);
}

// Closing the hidden decode window must not quit the app before the files are written.
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const [src, cx, cy, size] = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== ".");
  if (cx === undefined) { console.log("usage: electron scripts/make-icon.js <source> <centerX> <centerY> <size>"); app.quit(); return; }
  const crop = await cropSquare(src, +cx, +cy, +size);
  if (process.env.ICON_DUMP) fs.writeFileSync(process.env.ICON_DUMP, crop.toPNG());

  fs.mkdirSync(path.join(root, "build"), { recursive: true });
  fs.mkdirSync(path.join(root, "app", "assets"), { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => ({ size: s, png: render(crop, s) }));
  fs.writeFileSync(path.join(root, "build", "icon.ico"), ico(pngs));
  fs.writeFileSync(path.join(root, "build", "icon.png"), render(crop, 512));
  fs.writeFileSync(path.join(root, "app", "assets", "icon.png"), render(crop, 256));
  console.log("icon written");
  app.quit();
});
