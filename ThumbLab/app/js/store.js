/**
 * App data: settings, projects, global libraries. Loaded once from the main process,
 * then mutated in memory and written back (debounced) per project.
 */
(function (TL) {
  const { h, uid, debounce } = TL;

  const DEFAULT_CHECKLISTS = [
    { id: "readability", name: "Readability", items: [
      "Main subject obvious",
      "Main subject readable at small size",
      "Background separated from subject",
      "Important objects aren't touching edges awkwardly",
    ] },
    { id: "story", name: "Story", items: [
      "Thumbnail communicates one idea",
      "Viewer has a reason to click",
      "Thumbnail and title complement each other",
      "Doesn't require understanding tiny details",
    ] },
    { id: "composition", name: "Composition", items: [
      "Clear focal point",
      "No unnecessary objects",
      "Eye naturally moves toward important element",
    ] },
  ].map((g) => ({ id: g.id, name: g.name, items: g.items.map((text, i) => ({ id: `${g.id}-${i}`, text })) }));

  const NICHES = [
    "Gaming", "Minecraft", "Terraria", "Tech reviews", "Commentary", "Vlog", "Animation",
    "Drawing and art", "Video editing", "Education", "Music", "Cooking", "Fitness", "Horror stories",
  ];

  const state = {
    dataDir: "",
    settings: {},
    hasKey: false,
    projects: [],
    libraries: [],
  };
  TL.state = state;
  TL.NICHES = NICHES;

  // ---- loading -------------------------------------------------------------------

  TL.loadAll = async () => {
    const data = await window.host.load();
    state.dataDir = data.dataDir;
    state.hasKey = data.hasKey;
    state.settings = data.settings || {};
    if (!state.settings.checklists) state.settings.checklists = DEFAULT_CHECKLISTS;
    if (!state.settings.selfTest) state.settings.selfTest = {};
    state.projects = data.projects.map(TL.normalizeProject);
    state.libraries = data.libraries.map((l) => ({ ...l, items: l.items || [] }));
    state.projects.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  };

  TL.normalizeProject = (p) => ({
    title: "Untitled", niche: "Gaming", created: Date.now(), updated: Date.now(),
    concepts: [], variants: [], library: { items: [] }, watchFolder: "", autoAdd: false, watchSince: 0, dismissed: [],
    test: {}, ...p,
    library: { items: [], ...(p.library || {}) },
    test: { layout: "home", dark: true, slot: 2, seed: 1, source: "auto", order: "relevance", showAll: false, duration: true, ...(p.test || {}) },
  });

  // ---- settings ------------------------------------------------------------------

  const flushSettings = debounce(() => window.host.saveSettings(state.settings), 300);
  TL.saveSettings = () => flushSettings();

  // ---- projects --------------------------------------------------------------------

  const saversByProject = new Map();
  TL.saveProject = (project) => {
    project.updated = Date.now();
    let saver = saversByProject.get(project.id);
    if (!saver) {
      saver = debounce(() => window.host.saveProject(JSON.parse(JSON.stringify(project))), 250);
      saversByProject.set(project.id, saver);
    }
    saver();
  };
  TL.saveProjectNow = (project) => {
    project.updated = Date.now();
    return window.host.saveProject(JSON.parse(JSON.stringify(project)));
  };

  TL.getProject = (id) => state.projects.find((p) => p.id === id);

  TL.createProject = async (title, niche) => {
    const p = TL.normalizeProject({ id: uid(), title: title || "Untitled video", niche: niche || "Gaming" });
    p.test.seed = Math.floor(Math.random() * 1e6);
    state.projects.unshift(p);
    await TL.saveProjectNow(p);
    return p;
  };

  TL.deleteProject = async (id) => {
    await window.host.deleteProject(id);
    state.projects = state.projects.filter((p) => p.id !== id);
  };

  // ---- variants ----------------------------------------------------------------------

  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  TL.nextLabel = (project) => {
    const used = new Set(project.variants.map((v) => v.label));
    for (const l of LETTERS) if (!used.has(l)) return l;
    return String(project.variants.length + 1);
  };

  /** Flattens a preview onto white and writes the capped display JPEG next to the project. */
  async function writeDisplay(project, variant, canvas) {
    const display = TL.fitCanvas(canvas, 1280, 1280, true);
    const bytes = await TL.canvasToBytes(display, "image/jpeg", 0.93);
    const rev = (variant.rev || 0) + 1;
    const rel = `projects/${project.id}/img/${variant.id}-${rev}.jpg`;
    const abs = await window.host.writeFile(rel, bytes);
    if (variant.img && variant.img !== abs) window.host.removePath(variant.img);
    variant.img = abs;
    variant.rev = rev;
    variant.w = canvas.width;
    variant.h = canvas.height;
  }

  TL.setVariantImageFromCanvas = writeDisplay;

  /** Re-reads the linked art file and refreshes the stored preview. */
  TL.refreshVariant = async (project, variant) => {
    if (!variant.source) return;
    const prev = await window.host.preview(variant.source);
    const canvas = await TL.previewToCanvas(prev);
    await writeDisplay(project, variant, canvas);
    variant.warning = prev.warning || "";
    variant.sourceMtime = prev.mtimeMs;
    variant.error = "";
    TL.saveProject(project);
    TL.emit("variant-updated", { project, variant });
  };

  /** Adds a linked art file (PSD / CSP / Procreate / image) as a new variant. */
  TL.addVariantFromFile = async (project, file, opts = {}) => {
    const variant = {
      id: uid(), label: TL.nextLabel(project), kind: "file",
      name: TL.baseName(file), source: file, type: TL.extOf(file),
      created: Date.now(), checks: {}, extra: [], notes: "", title: "", pick: false,
    };
    try {
      const prev = await window.host.preview(file);
      const canvas = await TL.previewToCanvas(prev);
      await writeDisplay(project, variant, canvas);
      variant.warning = prev.warning || "";
      variant.sourceMtime = prev.mtimeMs;
    } catch (e) {
      TL.toast(`${TL.fileName(file)}: ${e.message}`, "bad");
      return null;
    }
    if (opts.kind) variant.kind = opts.kind;
    project.variants.push(variant);
    TL.saveProject(project);
    TL.emit("variants-changed", { project });
    TL.syncWatchers(project);
    return variant;
  };

  /** Adds an image that exists only as pixels (clipboard, drag from a browser). */
  TL.addVariantFromCanvas = async (project, canvas, name) => {
    const variant = {
      id: uid(), label: TL.nextLabel(project), kind: "file", name: name || "Pasted image", source: "", type: "png",
      created: Date.now(), checks: {}, extra: [], notes: "", title: "", pick: false,
    };
    await writeDisplay(project, variant, canvas);
    project.variants.push(variant);
    TL.saveProject(project);
    TL.emit("variants-changed", { project });
    return variant;
  };

  TL.removeVariant = (project, variant) => {
    if (variant.img) window.host.removePath(variant.img);
    project.variants = project.variants.filter((v) => v.id !== variant.id);
    TL.saveProject(project);
    TL.emit("variants-changed", { project });
    TL.syncWatchers(project);
  };

  /** Creates an empty in-app sketch variant (its PSD is written by the sketch pad). */
  TL.newSketchVariant = async (project, { width, height, name, conceptId }) => {
    const variant = {
      id: uid(), label: TL.nextLabel(project), kind: "sketch", name: name || "Sketch", source: "", type: "psd",
      created: Date.now(), checks: {}, extra: [], notes: "", title: "", pick: false, conceptId: conceptId || "",
      w: width, h: height, rev: 0,
    };
    variant.source = await window.host.writePsd({
      rel: `projects/${project.id}/sketch/${variant.id}.psd`,
      width, height,
      layers: [{ name: "Sketch", hidden: false, opacity: 1, rgba: new Uint8Array(width * height * 4) }],
      flat: new Uint8Array(width * height * 4).fill(255),
    });
    const blank = TL.canvas(width, height);
    const ctx = blank.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    await writeDisplay(project, variant, blank);
    project.variants.push(variant);
    TL.saveProject(project);
    TL.emit("variants-changed", { project });
    TL.syncWatchers(project);
    return variant;
  };

  // ---- watchers (current project only) -----------------------------------------------

  TL.syncWatchers = (project) => {
    if (!project) {
      window.host.watchFiles([]);
      window.host.watchFolder(null);
      return;
    }
    window.host.watchFiles(project.variants.filter((v) => v.source).map((v) => ({ key: `${project.id}:${v.id}`, path: v.source })));
    window.host.watchFolder(project.watchFolder || null);
  };

  // ---- libraries -----------------------------------------------------------------------

  TL.createLibrary = async (name) => {
    const lib = { id: uid(), name, items: [], created: Date.now() };
    state.libraries.push(lib);
    await window.host.saveLibrary(lib);
    return lib;
  };

  TL.saveLibrary = (lib, project) => {
    if (project) TL.saveProject(project);
    else window.host.saveLibrary(lib);
  };

  TL.deleteLibrary = async (lib) => {
    await window.host.deleteLibrary(lib.id);
    state.libraries = state.libraries.filter((l) => l.id !== lib.id);
  };
})(window.TL);
