/**
 * Canvas tab: get art in. Link PSD / CSP / Procreate / image files (they stay linked and
 * refresh when you save in the other app), paste, drop, watch an inbox folder, or start a
 * sketch right here.
 */
(function (TL) {
  const { h } = TL;
  const ART_EXT = new Set(["psd", "psb", "clip", "procreate", "png", "jpg", "jpeg", "webp", "bmp", "gif"]);

  TL.inbox = { dir: "", files: [] };
  const adding = new Set();

  /** Links each path as a new variant. Returns the variants added. */
  TL.importPaths = async (project, paths) => {
    const added = [];
    for (const p of paths) {
      if (!ART_EXT.has(TL.extOf(p))) { TL.toast(`${TL.fileName(p)} isn't a supported art file.`, "bad"); continue; }
      if (project.variants.some((v) => v.source === p)) { TL.toast(`${TL.fileName(p)} is already in this project.`); continue; }
      if (adding.has(p)) continue;
      adding.add(p);
      try {
        const v = await TL.addVariantFromFile(project, p);
        if (v) added.push(v);
      } finally {
        adding.delete(p);
      }
    }
    return added;
  };

  TL.pasteImageAsVariant = async (project) => {
    const bytes = await window.host.readClipboardImage();
    if (!bytes) { TL.toast("There's no image on the clipboard.", "bad"); return null; }
    const bmp = await createImageBitmap(new Blob([bytes]));
    const c = TL.canvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    return TL.addVariantFromCanvas(project, c, "Pasted image");
  };

  const SIZES = [
    ["1280×720 (YouTube)", 1280, 720],
    ["1920×1080", 1920, 1080],
    ["2560×1440 (large file)", 2560, 1440],
  ];

  TL.newSketchDialog = async (project, nav) => {
    const sel = h("select.select", SIZES.map(([label], i) => h("option", { value: i }, label)));
    const name = h("input.text", { placeholder: "Name (optional)" });
    const ok = await TL.modal({
      title: "New sketch",
      body: h("div.form", h("label", "Canvas size", sel), h("label", "Name", name)),
      buttons: [{ label: "Cancel", value: false }, { label: "Create", kind: "primary", value: true }],
    });
    if (!ok) return;
    const [, width, height] = SIZES[parseInt(sel.value, 10)];
    const v = await TL.newSketchVariant(project, { width, height, name: name.value.trim() || "Sketch" });
    nav.openSketch(project, v);
  };

  /** Adds inbox files automatically when the project asks for it. */
  TL.handleInbox = async (project) => {
    if (!project || !project.autoAdd || !project.watchFolder) return;
    const fresh = TL.inbox.files.filter((f) =>
      f.mtimeMs > project.watchSince &&
      !project.variants.some((v) => v.source === f.path) &&
      !project.dismissed.includes(f.path));
    if (fresh.length) {
      const added = await TL.importPaths(project, fresh.map((f) => f.path));
      if (added.length) TL.toast(`Added ${added.length} new file${added.length === 1 ? "" : "s"} from your inbox folder`);
    }
  };

  // ---- folder gallery ------------------------------------------------------------------------------

  const gallery = { q: "", hideAdded: false };
  const thumbQueue = [];
  let thumbActive = 0;

  const hashKey = (str) => {
    let h1 = 5381, h2 = 52711;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = (h1 * 33) ^ c; h2 = (h2 * 31) ^ c; }
    return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, "0");
  };

  /** Small cached preview for a file in the watched folder (generated once per file version). */
  async function folderThumb(file) {
    const key = hashKey(`${file.path}|${file.mtimeMs}|${file.size}`);
    const rel = `cache/folder/${key}.jpg`;
    const abs = `${TL.state.dataDir.replace(/\\/g, "/")}/${rel}`;
    if (await window.host.stat(abs)) return abs;
    const prev = await window.host.preview(file.path);
    const canvas = await TL.previewToCanvas(prev);
    const small = TL.fitCanvas(canvas, 480, 480, true);
    return window.host.writeFile(rel, await TL.canvasToBytes(small, "image/jpeg", 0.85));
  }

  function pumpThumbs() {
    while (thumbActive < 2 && thumbQueue.length) {
      const job = thumbQueue.shift();
      if (!job.img.isConnected) continue;
      thumbActive++;
      folderThumb(job.file)
        .then((abs) => { job.img.src = TL.imgUrl(abs); job.tile.classList.add("ready"); })
        .catch(() => { job.tile.classList.add("failed"); })
        .finally(() => { thumbActive--; pumpThumbs(); });
    }
  }

  // Only generate previews for tiles that scroll into view.
  const lazy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      lazy.unobserve(e.target);
      thumbQueue.push({ file: e.target._file, img: e.target.querySelector("img"), tile: e.target });
    }
    pumpThumbs();
  }, { rootMargin: "300px" });

  TL.canvasView = (project, nav) => {
    const root = h("div.canvas-tab");

    const doImport = async () => {
      const paths = await window.host.pickFiles({ title: "Link art files", multi: true });
      if (paths.length) await TL.importPaths(project, paths);
    };

    function folderPanel() {
      const panel = h("div.panel");
      const chooseFolder = async () => {
        const dir = await window.host.pickFolder("Choose the folder with your thumbnails");
        if (!dir) return;
        project.watchFolder = dir;
        project.watchSince = Date.now();
        TL.saveProject(project);
        TL.inbox = { dir, files: [] };
        TL.syncWatchers(project);
        render();
      };
      const head = h("div.folder-head",
        TL.icon("folder", 18),
        project.watchFolder ? h("code.path", { title: project.watchFolder }, project.watchFolder) : h("span.muted", "Show every thumbnail from a folder"),
        TL.iconBtn("folderOpen", project.watchFolder ? "Change folder" : "Choose a folder", chooseFolder, project.watchFolder ? { class: "solid" } : { kind: "primary", label: "Choose folder" }));
      panel.append(head);
      if (!project.watchFolder) return panel;

      head.append(
        TL.iconBtn("external", "Open the folder", () => window.host.reveal(project.watchFolder), { class: "small" }),
        TL.iconBtn("x", "Stop watching this folder", () => { project.watchFolder = ""; TL.saveProject(project); TL.syncWatchers(project); TL.inbox.files = []; render(); }, { class: "small" }),
        h("span.spacer"),
        TL.iconBtn("tree", "Include subfolders", () => {
          project.watchRecursive = !project.watchRecursive; TL.saveProject(project); TL.syncWatchers(project); TL.inbox.files = []; render();
        }, { on: !!project.watchRecursive, toggle: true }),
        TL.iconBtn("auto", "Add new files automatically (only files saved from now on)", () => {
          project.autoAdd = !project.autoAdd;
          if (project.autoAdd) project.watchSince = Date.now();
          TL.saveProject(project); render();
        }, { on: !!project.autoAdd, toggle: true }));

      const files = TL.inbox.files;
      const bySource = new Map(project.variants.filter((v) => v.source).map((v) => [v.source, v]));
      const fresh = files.filter((f) => !bySource.has(f.path));
      const grid = h("div.fgrid");

      const draw = () => {
        TL.clear(grid);
        const q = gallery.q.trim().toLowerCase();
        const shown = files.filter((f) => (!q || f.name.toLowerCase().includes(q)) && !(gallery.hideAdded && bySource.has(f.path)));
        if (!files.length) { grid.append(h("div.muted", "No art files here yet (PSD, CSP, Procreate, PNG, JPG)")); return; }
        if (!shown.length) { grid.append(h("div.muted", "Nothing matches")); return; }
        for (const f of shown) {
          const v = bySource.get(f.path);
          const img = h("img.fx", { alt: "", draggable: false });
          const tile = h("div.ftile", {
            class: v ? "added" : "", title: v ? `Already in this project as ${v.label}` : "Add as a version",
            onclick: () => { if (!v) TL.importPaths(project, [f.path]); },
          },
            h("div.thumb", img, h("span.fstate", v ? TL.icon("check", 14) : TL.icon("plus", 14))),
            h("div.fname", { title: f.path }, f.name),
            h("div.fmeta", h("span.badge", TL.extOf(f.path).toUpperCase()), new Date(f.mtimeMs).toLocaleDateString()));
          tile._file = f;
          grid.append(tile);
          lazy.observe(tile);
        }
      };

      panel.append(h("div.row.wrap",
        h("span.muted", `${files.length} file${files.length === 1 ? "" : "s"}${fresh.length ? ` · ${fresh.length} new` : ""}`),
        h("span.spacer"),
        h("label.fld", TL.icon("search", 14),
          h("input.text.small", { placeholder: "Filter", value: gallery.q, oninput: (e) => { gallery.q = e.target.value; draw(); } })),
        TL.iconBtn("eyeOff", "Hide the ones already added", (e) => { gallery.hideAdded = !gallery.hideAdded; e.currentTarget.classList.toggle("on", gallery.hideAdded); draw(); }, { on: gallery.hideAdded, toggle: true }),
        TL.iconBtn("plus", `Add all ${fresh.length} new files as versions`, async () => {
          if (fresh.length > 8 && !(await TL.confirm(`Add all ${fresh.length} files as versions?`, "Add all"))) return;
          const added = await TL.importPaths(project, fresh.map((f) => f.path));
          if (added.length) TL.toast(`Added ${added.length}`);
        }, { class: "solid", label: fresh.length ? `Add ${fresh.length}` : "", disabled: !fresh.length })));
      panel.append(grid);
      draw();
      return panel;
    }

    const render = () => {
      TL.clear(root);

      const drop = h("div.dropzone", { tabIndex: 0 },
        TL.icon("tray", 28),
        h("div.drop-title", "Drop art here"),
        h("div.muted.small", "PSD, CSP, Procreate, PNG, JPG. Linked files update when you save them."),
        h("div.row.center",
          TL.iconBtn("link", "Link art files", doImport, { kind: "primary", label: "Link files" }),
          TL.iconBtn("paste", "Paste an image from the clipboard", () => TL.pasteImageAsVariant(project), { class: "solid", label: "Paste" }),
          TL.iconBtn("sketch", "Start a new sketch", () => TL.newSketchDialog(project, nav), { class: "solid", label: "Sketch" })));
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", async (e) => {
        e.preventDefault(); drop.classList.remove("over");
        const paths = [...e.dataTransfer.files].map((f) => window.host.pathForFile(f)).filter(Boolean);
        if (paths.length) await TL.importPaths(project, paths);
      });

      const inbox = folderPanel();

      const sources = project.variants.filter((v) => v.source || v.kind === "sketch");
      const list = sources.length ? h("div.panel",
        h("div.panel-head", TL.icon("link", 16), h("h3", "Linked art"), h("span.muted", String(sources.length))),
        h("div.source-list", sources.map((v) => sourceRow(v)))) : null;

      root.append(drop, inbox, list);
    };

    const sourceRow = (v) => h("div.source-row",
      h("img.source-thumb", { src: TL.imgUrl(v.img, v.rev), alt: "" }),
      h("div.source-main",
        h("div.source-name", h("span.label-pill", v.label), " ", v.name,
          h("span.badge", v.kind === "sketch" ? "SKETCH" : (v.type || "").toUpperCase())),
        h("code.path", { title: v.source }, v.source || "(pasted image)"),
        v.warning ? h("div.warn", v.warning) : null,
        v.error ? h("div.warn", v.error) : null),
      h("div.source-actions",
        v.kind === "sketch" ? TL.iconBtn("sketch", "Open the sketch pad", () => nav.openSketch(project, v), { kind: "primary" }) : null,
        v.source ? TL.iconBtn("external", "Open in its app", async () => { const err = await window.host.openPath(v.source); if (err) TL.toast(err, "bad"); }) : null,
        v.source ? TL.iconBtn("refresh", "Re-read the file now", () => TL.refreshVariant(project, v).then(() => TL.toast("Refreshed")).catch((e) => TL.toast(e.message, "bad"))) : null,
        v.source ? TL.iconBtn("folder", "Show in its folder", () => window.host.reveal(v.source)) : null));

    render();
    const offs = ["variants-changed", "variant-updated", "inbox-changed"].map((n) => TL.on(n, () => {
      if (!root.isConnected) { offs.forEach((o) => o()); return; }
      render();
    }));
    return root;
  };
})(window.TL);
