/**
 * Library: reusable assets (faces, characters, logos, arrows, backgrounds, screenshots…).
 * A global library (e.g. "Terraria") is shared by every project; each project also has its
 * own library for one-off assets. Items can be dragged straight into Photoshop / CSP.
 */
(function (TL) {
  const { h } = TL;
  const CATS = ["Face", "Character", "Logo", "Arrow", "Background", "Screenshot", "Other"];
  TL.LIB_CATS = CATS;

  /** Where a library keeps its image files, relative to the data folder. */
  function baseRel(src) {
    return src.project ? `projects/${src.project.id}/library/files` : `libraries/${src.lib.id}/files`;
  }

  async function addCanvas(src, canvas, name, cat) {
    const fitted = TL.fitCanvas(canvas, 1600, 1600, false);
    const bytes = await TL.canvasToBytes(fitted, "image/png");
    const id = TL.uid();
    const file = await window.host.writeFile(`${baseRel(src)}/${id}.png`, bytes);
    src.lib.items.unshift({ id, name, cat: cat || "Other", file, w: fitted.width, h: fitted.height, added: Date.now() });
    TL.saveLibrary(src.lib, src.project);
  }

  async function addPaths(src, paths, cat) {
    let n = 0;
    for (const p of paths) {
      try {
        const prev = await window.host.preview(p);
        const canvas = await TL.previewToCanvas(prev);
        await addCanvas(src, canvas, TL.baseName(p), cat);
        n++;
      } catch (e) {
        TL.toast(`${TL.fileName(p)}: ${e.message}`, "bad");
      }
    }
    return n;
  }

  /**
   * sources: [{ key, label, lib, project? }]. opts.onPick(item, src) switches to "choose one" mode.
   */
  TL.libraryBrowser = (sources, opts = {}) => {
    const root = h("div.library");
    let current = sources.find((s) => s.key === opts.startKey) || sources[0];
    let cat = "All";
    let query = "";

    const grid = h("div.lib-grid");
    const head = h("div.lib-head");

    const renderGrid = () => {
      TL.clear(grid);
      const items = current.lib.items.filter((it) =>
        (cat === "All" || it.cat === cat) && (!query || it.name.toLowerCase().includes(query)));
      if (!items.length) {
        grid.append(h("div.empty", h("strong", current.lib.items.length ? "Nothing matches" : "This library is empty"),
          h("p", current.lib.items.length ? "Try another category or search." : "Add images, paste from the clipboard, or drop files here. PSD, CSP and Procreate files work too.")));
        return;
      }
      for (const it of items) grid.append(tile(it));
    };

    const tile = (it) => {
      const img = h("img", { src: TL.imgUrl(it.file), draggable: false, alt: it.name });
      const el = h("div.lib-tile", {
        title: opts.onPick ? "Click to use" : "Drag into Photoshop / CSP / Procreate. Double-click to rename.",
        draggable: true,
        ondragstart: (e) => { e.preventDefault(); window.host.startDrag(it.file); },
        onclick: () => { if (opts.onPick) opts.onPick(it, current); },
        ondblclick: async () => {
          if (opts.onPick) return;
          const name = await TL.prompt("Rename", it.name);
          if (name) { it.name = name; TL.saveLibrary(current.lib, current.project); renderGrid(); }
        },
      },
        h("div.lib-img", img),
        h("div.lib-name", it.name),
        h("select.select.tiny", {
          title: "Category", onclick: (e) => e.stopPropagation(),
          onchange: (e) => { it.cat = e.target.value; TL.saveLibrary(current.lib, current.project); renderGrid(); },
        }, CATS.map((c) => h("option", { value: c, selected: it.cat === c }, c))),
        opts.onPick ? null : h("div.lib-actions",
          h("button.icon-btn.tiny", {
            title: "Copy image", onclick: async (e) => {
              e.stopPropagation();
              await window.host.copyImage(await window.host.readFile(it.file)); TL.toast("Copied");
            },
          }, "⧉"),
          h("button.icon-btn.tiny", { title: "Show in folder", onclick: (e) => { e.stopPropagation(); window.host.reveal(it.file); } }, "📂"),
          opts.copyTo && current !== opts.copyTo ? h("button.icon-btn.tiny", {
            title: `Copy to ${opts.copyTo.label}`,
            onclick: async (e) => {
              e.stopPropagation();
              const img2 = await TL.loadBitmap(it.file);
              const c = TL.canvas(img2.width, img2.height);
              c.getContext("2d").drawImage(img2, 0, 0);
              await addCanvas(opts.copyTo, c, it.name, it.cat);
              TL.toast(`Copied to ${opts.copyTo.label}`);
            },
          }, "⇥") : null,
          h("button.icon-btn.tiny", {
            title: "Delete", onclick: async (e) => {
              e.stopPropagation();
              if (!(await TL.confirm(`Delete "${it.name}" from this library?`, "Delete", true))) return;
              window.host.removePath(it.file);
              current.lib.items = current.lib.items.filter((x) => x.id !== it.id);
              TL.saveLibrary(current.lib, current.project); renderGrid();
            },
          }, "🗑")));
      return el;
    };

    const renderHead = () => {
      TL.clear(head);
      const isGlobal = !current.project;
      head.append(
        h("div.row",
          sources.length > 1 || isGlobal ? h("select.select", {
            title: "Library",
            onchange: (e) => { current = sources.find((s) => s.key === e.target.value); renderHead(); renderGrid(); },
          }, sources.map((s) => h("option", { value: s.key, selected: s === current }, s.label))) : h("strong", current.label),
          opts.canCreate ? h("button.btn.small", {
            onclick: async () => {
              const name = await TL.prompt("Name the new library", "", "e.g. Terraria");
              if (!name) return;
              const lib = await TL.createLibrary(name);
              sources.push({ key: `g:${lib.id}`, label: lib.name, lib });
              current = sources[sources.length - 1];
              if (opts.onSourcesChanged) opts.onSourcesChanged();
              renderHead(); renderGrid();
            },
          }, "+ New library") : null,
          isGlobal && opts.canCreate ? h("button.btn.small.ghost", {
            onclick: async () => {
              const name = await TL.prompt("Rename library", current.lib.name);
              if (!name) return;
              current.lib.name = name; current.label = name; TL.saveLibrary(current.lib); renderHead();
            },
          }, "Rename") : null,
          isGlobal && opts.canCreate ? h("button.btn.small.ghost.danger-text", {
            onclick: async () => {
              if (!(await TL.confirm(`Delete the library "${current.lib.name}" and all ${current.lib.items.length} images in it?`, "Delete library", true))) return;
              await TL.deleteLibrary(current.lib);
              const i = sources.indexOf(current);
              sources.splice(i, 1);
              current = sources[0];
              if (opts.onSourcesChanged) opts.onSourcesChanged();
              renderHead(); renderGrid();
            },
          }, "Delete") : null),
        h("div.row",
          h("button.btn.primary.small", {
            onclick: async () => {
              const paths = await window.host.pickFiles({ title: "Add to library", multi: true, images: true });
              if (!paths.length) return;
              const n = await addPaths(current, paths, cat === "All" ? "Other" : cat);
              if (n) { TL.toast(`Added ${n}`); renderGrid(); }
            },
          }, "+ Add images"),
          h("button.btn.small", {
            title: "Paste an image from the clipboard (Ctrl+V)",
            onclick: () => pasteClipboard(),
          }, "Paste"),
          h("input.text.small.lib-search", {
            placeholder: "Search…", value: query,
            oninput: (e) => { query = e.target.value.toLowerCase(); renderGrid(); },
          })),
        h("div.chips", ["All", ...CATS].map((c) => h("button.chip", {
          class: cat === c ? "on" : "", onclick: () => { cat = c; renderHead(); renderGrid(); },
        }, c))));
    };

    const pasteClipboard = async () => {
      const bytes = await window.host.readClipboardImage();
      if (!bytes) { TL.toast("There's no image on the clipboard.", "bad"); return; }
      const bmp = await createImageBitmap(new Blob([bytes]));
      const c = TL.canvas(bmp.width, bmp.height);
      c.getContext("2d").drawImage(bmp, 0, 0);
      await addCanvas(current, c, "Pasted image", cat === "All" ? "Other" : cat);
      TL.toast("Pasted into the library"); renderGrid();
    };

    // Drop files from Explorer straight onto the library.
    root.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); root.classList.add("dropping"); } });
    root.addEventListener("dragleave", (e) => { if (e.target === root) root.classList.remove("dropping"); });
    root.addEventListener("drop", async (e) => {
      e.preventDefault(); root.classList.remove("dropping");
      const paths = [...e.dataTransfer.files].map((f) => window.host.pathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      const n = await addPaths(current, paths, cat === "All" ? "Other" : cat);
      if (n) { TL.toast(`Added ${n}`); renderGrid(); }
    });
    root.tabIndex = -1;
    root.addEventListener("paste", (e) => { if (e.target.tagName !== "INPUT") { e.preventDefault(); pasteClipboard(); } });

    root.append(head, grid);
    renderHead();
    renderGrid();
    root.focus({ preventScroll: true });
    return root;
  };

  /** Sources list for a project: its own library first, then every global library. */
  TL.librarySources = (project) => {
    const out = [];
    if (project) out.push({ key: "project", label: "This project", lib: project.library, project });
    for (const lib of TL.state.libraries) out.push({ key: `g:${lib.id}`, label: lib.name, lib });
    return out;
  };

  TL.addCanvasToLibrary = addCanvas;
})(window.TL);
