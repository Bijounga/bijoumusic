// Dev check: node scripts/probe-files.js <file> [more files] -> reports what the preview reader finds.
const fs = require("fs");
const path = require("path");
const files = require("../lib/files");

(async () => {
  for (const file of process.argv.slice(2)) {
    const t = Date.now();
    try {
      const r = await files.readFlat(file);
      const size = r.kind === "png" ? `${r.png.length} bytes png` : `${r.width}x${r.height} rgba`;
      console.log(path.basename(file), "->", size, r.warning ? `(${r.warning})` : "", `${Date.now() - t}ms`);
      if (r.kind === "png" && process.env.PROBE_OUT) {
        fs.writeFileSync(path.join(process.env.PROBE_OUT, path.basename(file) + ".png"), r.png);
      }
    } catch (e) {
      console.log(path.basename(file), "ERROR", e.message);
    }
  }
})();
