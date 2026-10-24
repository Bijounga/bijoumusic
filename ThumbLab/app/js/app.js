/** App shell: left rail, routing between the projects page, a project's tabs, libraries, settings. */
(function (TL) {
  const { h } = TL;

  const TABS = [
    ["concepts", "Concepts", "lightbulb"], ["canvas", "Canvas", "tray"], ["variants", "Variants", "compare"],
    ["test", "Test", "monitor"], ["library", "Library", "library"],
  ];

  const route = { view: "home", projectId: null, tab: "variants", sketchVariant: null };
  let pad = null; // live sketch pad handle
  const appEl = () => TL.$("#app");

  const nav = {
    openProject(id, tab) {
      route.view = "project"; route.projectId = id; route.tab = tab || route.tab || "variants";
      const p = TL.getProject(id);
      TL.syncWatchers(p);
      TL.inbox = { dir: "", files: [] };
      render();
    },
    setTab(tab) { route.tab = tab; render(); },
    async openSketch(project, variant) {
      route.view = "sketch"; route.projectId = project.id; route.sketchVariant = variant.id;
      render();
    },
    closeSketch(reopen) {
      pad = null;
      const project = TL.getProject(route.projectId);
      if (reopen) { nav.openSketch(project, reopen); return; }
      route.view = "project"; route.sketchVariant = null;
      if (route.tab === "canvas" || route.tab === "concepts") route.tab = "variants";
      render();
    },
  };

  function go(view) {
    if (pad) { pad.close().then(() => go(view)); pad = null; return; }
    route.view = view;
    if (view === "home") { route.projectId = null; TL.syncWatchers(null); }
    render();
  }

  // ---- rail -----------------------------------------------------------------------------------

  function rail() {
    const item = (view, label, icon) => h("button.rail-item", {
      class: route.view === view ? "on" : "", onclick: () => go(view), "aria-label": label,
    }, TL.icon(icon, 22), h("span", label));
    return h("nav.rail",
      h("div.rail-brand", h("img.brand-mark", { src: "assets/icon.png", alt: "Thumb Lab" })),
      item("home", "Projects", "home"),
      item("libraries", "Library", "library"),
      item("selftest", "Tester", "checklist"),
      h("span.spacer"),
      item("settings", "Settings", "sliders"));
  }

  // ---- pages ----------------------------------------------------------------------------------

  async function newProjectDialog() {
    const title = h("input.text", { placeholder: "Video title" });
    const niche = TL.nicheBox({ value: "" });
    const ok = await TL.modal({
      title: "New project",
      body: h("div.form", h("label", "What's the video called?", title), h("label", "Niche (used to pick similar videos for the Test tab)", niche)),
      buttons: [{ label: "Cancel", value: false }, { label: "Create", kind: "primary", value: true }],
    });
    if (!ok) return;
    const p = await TL.createProject(title.value.trim() || "Untitled video", niche.getValue());
    nav.openProject(p.id, "concepts");
  }

  function homePage() {
    const projects = TL.state.projects;
    const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const cards = projects.map((p) => {
      const cover = p.variants.find((v) => v.pick && v.img) || p.variants.find((v) => v.img);
      return h("div.pcard", { onclick: () => nav.openProject(p.id, "variants") },
        h("div.pcover", cover ? TL.thumbEl(cover) : h("div.pcover-empty", TL.icon("image", 28))),
        h("div.pbody",
          h("div.ptitle", p.title),
          h("div.muted.small", [p.niche, count(p.variants.length, "version")].filter(Boolean).join(" · "))),
        TL.iconBtn("trash", "Delete project", async (e) => {
          e.stopPropagation();
          if (!(await TL.confirm(`Delete "${p.title}" and everything in it (ideas, sketches, project library)? Your original PSD/CSP files aren't touched.`, "Delete project", true))) return;
          await TL.deleteProject(p.id); render();
        }, { class: "pdel floating danger" }));
    });
    const create = TL.iconBtn("plus", "New project", newProjectDialog, { kind: "primary", label: "New" });
    return h("div.page",
      h("div.page-head", h("h1", "Projects"), create),
      projects.length
        ? h("div.pgrid", cards)
        : h("div.empty.big", TL.icon("home", 32), h("strong", "No projects yet"),
          h("p", "One project per video: ideas, sketches, versions and tests."),
          h("div.row.center", TL.iconBtn("plus", "New project", newProjectDialog, { kind: "primary", label: "New project" }))));
  }

  function projectPage() {
    const project = TL.getProject(route.projectId);
    if (!project) { route.view = "home"; return homePage(); }

    const bar = h("div.proj-bar",
      TL.iconBtn("back", "All projects", () => go("home")),
      h("input.title-input", {
        value: project.title, title: "Video title", spellcheck: false,
        oninput: (e) => { project.title = e.target.value; TL.saveProject(project); },
        onchange: () => render(),
      }),
      h("div.tabs", TABS.map(([key, label, icon]) => h("button.tab", {
        class: route.tab === key ? "on" : "", onclick: () => nav.setTab(key),
      }, TL.icon(icon, 16), label))),
      h("div.niche", { title: "Niche: what the Test tab searches for" }, TL.icon("tag", 16),
        TL.nicheBox({ value: project.niche, group: project.id, onCommit: (v) => { project.niche = v; TL.saveProject(project); render(); } })));

    let body;
    if (route.tab === "concepts") body = TL.conceptsView(project, nav);
    else if (route.tab === "canvas") body = TL.canvasView(project, nav);
    else if (route.tab === "variants") body = TL.variantsView(project, nav);
    else if (route.tab === "test") body = TL.testView(project, nav);
    else {
      const sources = TL.librarySources(project);
      body = TL.libraryBrowser(sources, { copyTo: sources[0], startKey: "project" });
    }
    return h("div.page.project", bar, h("div.tab-body", body));
  }

  function librariesPage() {
    const holder = h("div.page");
    const draw = () => {
      TL.clear(holder);
      holder.append(h("div.page-head", h("h1", "Library")));
      const sources = TL.state.libraries.map((l) => ({ key: `g:${l.id}`, label: l.name, lib: l }));
      if (!sources.length) {
        holder.append(h("div.empty.big", TL.icon("library", 32), h("strong", "No libraries yet"),
          h("p", "Shared assets for every project. Make one per game or topic, like Terraria."),
          h("div.row.center", TL.iconBtn("plus", "New library", async () => {
            const name = await TL.prompt("Name the library", "", "e.g. Terraria");
            if (!name) return;
            await TL.createLibrary(name); draw();
          }, { kind: "primary", label: "New library" }))));
        return;
      }
      holder.append(TL.libraryBrowser(sources, { canCreate: true, onSourcesChanged: () => { if (!TL.state.libraries.length) draw(); } }));
    };
    draw();
    return holder;
  }

  // ---- render -----------------------------------------------------------------------------------

  async function render() {
    const root = appEl();
    TL.clear(root);
    const shell = h("div.shell", { class: route.view === "sketch" ? "full" : "" });
    let main = h("main.content");

    if (route.view === "sketch") {
      const project = TL.getProject(route.projectId);
      const variant = project && project.variants.find((v) => v.id === route.sketchVariant);
      if (!variant) { route.view = "project"; render(); return; }
      root.append(shell);
      shell.append(main);
      main.append(h("div.loading", "Opening sketch…"));
      const handle = await TL.sketchPad(project, variant, nav);
      if (route.view !== "sketch") { handle.destroy(); return; }
      pad = handle;
      TL.clear(main);
      main.append(handle.el);
      return;
    }

    if (route.view === "home") main.append(homePage());
    else if (route.view === "project") main.append(projectPage());
    else if (route.view === "libraries") main.append(librariesPage());
    else if (route.view === "selftest") main.append(TL.selfTestView());
    else if (route.view === "settings") main.append(TL.settingsView());
    shell.append(rail(), main);
    root.append(shell);
  }

  // ---- background events ----------------------------------------------------------------------------

  window.host.onFileChanged(async ({ key }) => {
    const [pid, vid] = key.split(":");
    const project = TL.getProject(pid);
    const variant = project && project.variants.find((v) => v.id === vid);
    if (!variant) return;
    if (route.view === "sketch" && route.sketchVariant === vid) return; // the pad asks what to do
    try {
      await TL.refreshVariant(project, variant);
      TL.toast(`Updated ${variant.label} from ${TL.fileName(variant.source)}`);
    } catch (e) {
      variant.error = e.message;
      TL.toast(`${TL.fileName(variant.source)}: ${e.message}`, "bad");
    }
  });

  window.host.onFolderFiles(({ dir, files }) => {
    TL.inbox = { dir, files };
    TL.emit("inbox-changed");
    const p = TL.getProject(route.projectId);
    TL.handleInbox(p);
  });

  // Ctrl+V on the Canvas / Variants tabs pastes a screenshot or copied image as a new version.
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "v") return;
    if (route.view !== "project" || !["canvas", "variants"].includes(route.tab)) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    e.preventDefault();
    TL.pasteImageAsVariant(TL.getProject(route.projectId));
  });

  // ---- boot --------------------------------------------------------------------------------------------

  (async () => {
    try {
      await TL.loadAll();
    } catch (e) {
      appEl().append(h("div.empty.big", h("strong", "Could not load your data"), h("p", e.message)));
      return;
    }
    render();
  })();

  window.addEventListener("error", (e) => /ResizeObserver loop/.test(e.message) || TL.toast(`Something went wrong: ${e.message}`, "bad"));
  window.addEventListener("unhandledrejection", (e) => TL.toast(`Something went wrong: ${e.reason && e.reason.message ? e.reason.message : e.reason}`, "bad"));
})(window.TL);
