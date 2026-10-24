/** App shell: left rail, routing between the projects page, a project's tabs, libraries, settings. */
(function (TL) {
  const { h } = TL;

  const TABS = [
    ["concepts", "Concepts"], ["canvas", "Canvas"], ["variants", "Variants"], ["test", "Test"], ["library", "Library"],
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
    const item = (view, label, glyph) => h("button.rail-item", { class: route.view === view ? "on" : "", onclick: () => go(view) },
      h("span.glyph", glyph), label);
    return h("nav.rail",
      h("div.brand", h("img.brand-mark", { src: "assets/icon.png", alt: "" }), "Thumb Lab"),
      item("home", "Projects", "🗂"),
      item("libraries", "Libraries", "🖼"),
      item("selftest", "Test checklist", "☑"),
      item("settings", "Settings", "⚙"),
      h("div.rail-sect", "Recent"),
      h("div.rail-recent", TL.state.projects.slice(0, 8).map((p) => h("button.rail-proj", {
        class: route.projectId === p.id && route.view === "project" ? "on" : "",
        onclick: () => { if (pad) { pad.close().then(() => nav.openProject(p.id)); pad = null; } else nav.openProject(p.id); },
        title: p.title,
      }, p.title))));
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
    const cards = projects.map((p) => {
      const cover = p.variants.find((v) => v.pick && v.img) || p.variants.find((v) => v.img);
      return h("div.pcard", { onclick: () => nav.openProject(p.id, "variants") },
        h("div.pcover", cover ? TL.thumbEl(cover) : h("div.pcover-empty", "No art yet")),
        h("div.pbody",
          h("div.ptitle", p.title),
          h("div.muted", `${p.niche ? p.niche + " · " : ""}${p.variants.length} version${p.variants.length === 1 ? "" : "s"} · ${p.concepts.length} idea${p.concepts.length === 1 ? "" : "s"}`),
          h("div.muted.small", `Updated ${TL.timeAgo(new Date(p.updated).toISOString())}`)),
        h("button.icon-btn.pdel", {
          title: "Delete project",
          onclick: async (e) => {
            e.stopPropagation();
            if (!(await TL.confirm(`Delete "${p.title}" and everything in it (ideas, sketches, project library)? Your original PSD/CSP files aren't touched.`, "Delete project", true))) return;
            await TL.deleteProject(p.id); render();
          },
        }, "🗑"));
    });
    return h("div.page",
      h("div.page-head", h("h1", "Projects"), h("button.btn.primary", { onclick: newProjectDialog }, "+ New project")),
      projects.length
        ? h("div.pgrid", cards)
        : h("div.empty.big", h("strong", "No projects yet"),
          h("p", "A project is one video. It holds the ideas, sketches, versions and tests for its thumbnail."),
          h("button.btn.primary", { onclick: newProjectDialog }, "+ New project")));
  }

  function projectPage() {
    const project = TL.getProject(route.projectId);
    if (!project) { route.view = "home"; return homePage(); }

    const head = h("div.proj-head",
      h("button.btn.ghost", { onclick: () => go("home") }, "← Projects"),
      h("input.text.title-input", {
        value: project.title, title: "Video title",
        oninput: (e) => { project.title = e.target.value; TL.saveProject(project); },
        onchange: () => render(),
      }),
      h("label.inline", "Niche",
        TL.nicheBox({ value: project.niche, group: project.id, onCommit: (v) => { project.niche = v; TL.saveProject(project); render(); } })));

    const tabs = h("div.tabs", TABS.map(([key, label]) => h("button.tab", {
      class: route.tab === key ? "on" : "", onclick: () => nav.setTab(key),
    }, label)));

    let body;
    if (route.tab === "concepts") body = TL.conceptsView(project, nav);
    else if (route.tab === "canvas") body = TL.canvasView(project, nav);
    else if (route.tab === "variants") body = TL.variantsView(project, nav);
    else if (route.tab === "test") body = TL.testView(project, nav);
    else {
      const sources = TL.librarySources(project);
      body = TL.libraryBrowser(sources, { copyTo: sources[0], startKey: "project" });
    }
    return h("div.page.project", head, tabs, h("div.tab-body", body));
  }

  function librariesPage() {
    const holder = h("div.page");
    const draw = () => {
      TL.clear(holder);
      holder.append(h("div.page-head", h("h1", "Libraries"),
        h("span.muted", "Reusable faces, characters, logos, arrows, backgrounds and screenshots, shared by every project.")));
      const sources = TL.state.libraries.map((l) => ({ key: `g:${l.id}`, label: l.name, lib: l }));
      if (!sources.length) {
        holder.append(h("div.empty.big", h("strong", "No libraries yet"),
          h("p", "Make one per game or topic, e.g. \"Terraria\". Each project also has its own library for one-off assets."),
          h("button.btn.primary", {
            onclick: async () => {
              const name = await TL.prompt("Name the library", "", "e.g. Terraria");
              if (!name) return;
              await TL.createLibrary(name); draw();
            },
          }, "+ Create a library")));
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
