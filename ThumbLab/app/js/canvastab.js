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
    ["1280×720 (YouTube standard)", 1280, 720],
    ["1920×1080", 1920, 1080],
    ["2560×1440 (big, heavier files)", 2560, 1440],
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

  TL.canvasView = (project, nav) => {
    const root = h("div.canvas-tab");

    const doImport = async () => {
      const paths = await window.host.pickFiles({ title: "Link art files", multi: true });
      if (paths.length) await TL.importPaths(project, paths);
    };

    const render = () => {
      TL.clear(root);

      const drop = h("div.dropzone", { tabIndex: 0 },
        h("div.drop-title", "Drop PSD, CSP, Procreate or image files here"),
        h("div.muted", "They stay linked: save in the other app and the preview here updates by itself."),
        h("div.row.center",
          h("button.btn.primary", { onclick: doImport }, "Link files…"),
          h("button.btn", { onclick: () => TL.pasteImageAsVariant(project) }, "Paste image"),
          h("button.btn", { onclick: () => TL.newSketchDialog(project, nav) }, "✎ New sketch")));
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", async (e) => {
        e.preventDefault(); drop.classList.remove("over");
        const paths = [...e.dataTransfer.files].map((f) => window.host.pathForFile(f)).filter(Boolean);
        if (paths.length) await TL.importPaths(project, paths);
      });

      // --- Inbox folder
      const linked = new Set(project.variants.map((v) => v.source));
      const incoming = project.watchFolder
        ? TL.inbox.files.filter((f) => !linked.has(f.path) && !project.dismissed.includes(f.path)).slice(0, 12)
        : [];
      const inbox = h("div.panel",
        h("div.panel-head", h("h3", "Inbox folder"),
          h("span.muted", "Point this at the folder you export or save into. New art shows up here.")),
        h("div.row",
          h("code.path", project.watchFolder || "No folder chosen"),
          h("button.btn.small", {
            onclick: async () => {
              const dir = await window.host.pickFolder("Choose the folder to watch");
              if (!dir) return;
              project.watchFolder = dir;
              project.watchSince = Date.now();
              TL.saveProject(project);
              TL.syncWatchers(project);
              render();
            },
          }, project.watchFolder ? "Change…" : "Choose folder…"),
          project.watchFolder ? h("button.btn.small.ghost", {
            onclick: () => { project.watchFolder = ""; TL.saveProject(project); TL.syncWatchers(project); TL.inbox.files = []; render(); },
          }, "Stop watching") : null),
        project.watchFolder ? h("label.check.inline",
          h("input", {
            type: "checkbox", checked: !!project.autoAdd,
            onchange: (e) => {
              project.autoAdd = e.target.checked;
              if (project.autoAdd) project.watchSince = Date.now();
              TL.saveProject(project);
              render();
            },
          }),
          h("span", "Add new files automatically (only files saved from now on)")) : null,
        project.watchFolder
          ? (incoming.length
            ? h("div.inbox-list", incoming.map((f) => h("div.inbox-row",
              h("span.badge", TL.extOf(f.path).toUpperCase()),
              h("span.grow", f.name),
              h("span.muted", new Date(f.mtimeMs).toLocaleString()),
              h("button.btn.small.primary", { onclick: () => TL.importPaths(project, [f.path]) }, "Add"),
              h("button.icon-btn.tiny", { title: "Hide", onclick: () => { project.dismissed.push(f.path); TL.saveProject(project); render(); } }, "✕"))))
            : h("div.muted", "Nothing new in the folder."))
          : null);

      // --- Linked sources
      const sources = project.variants.filter((v) => v.source || v.kind === "sketch");
      const list = h("div.panel",
        h("div.panel-head", h("h3", "Linked art"), h("span.muted", `${sources.length} file${sources.length === 1 ? "" : "s"}`)),
        sources.length ? h("div.source-list", sources.map((v) => sourceRow(v))) : h("div.muted", "Nothing linked yet."));

      root.append(drop, inbox, list);
    };

    const sourceRow = (v) => h("div.source-row",
      h("img.source-thumb", { src: TL.imgUrl(v.img, v.rev), alt: "" }),
      h("div.source-main",
        h("div.source-name", h("span.label-pill", v.label), " ", v.name,
          h("span.badge", v.kind === "sketch" ? "SKETCH" : (v.type || "").toUpperCase())),
        h("code.path", v.source || "(pasted image)"),
        v.warning ? h("div.warn", v.warning) : null,
        v.error ? h("div.warn", v.error) : null),
      h("div.source-actions",
        v.kind === "sketch" ? h("button.btn.small.primary", { onclick: () => nav.openSketch(project, v) }, "Open sketch pad") : null,
        v.source ? h("button.btn.small", { onclick: async () => { const err = await window.host.openPath(v.source); if (err) TL.toast(err, "bad"); } }, "Open in app") : null,
        v.source ? h("button.btn.small", { onclick: () => TL.refreshVariant(project, v).then(() => TL.toast("Refreshed")).catch((e) => TL.toast(e.message, "bad")) }, "Refresh") : null,
        v.source ? h("button.btn.small.ghost", { onclick: () => window.host.reveal(v.source) }, "Show") : null));

    render();
    const offs = ["variants-changed", "variant-updated", "inbox-changed"].map((n) => TL.on(n, () => {
      if (!root.isConnected) { offs.forEach((o) => o()); return; }
      render();
    }));
    return root;
  };
})(window.TL);
