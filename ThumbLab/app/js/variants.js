/**
 * Variants: A/B/C versions of the thumbnail side by side. Shrink them, blur them, squint at
 * them, star the winner, and work through the checklist for the selected one.
 */
(function (TL) {
  const { h } = TL;

  TL.ui = TL.ui || { selected: {} };
  let cardWidth = parseInt(localStorage.getItem("thumblab.cardWidth") || "280", 10);

  /** 16:9 thumbnail box. Anything else is letterboxed, like YouTube does. */
  TL.thumbEl = (variant, extra) => {
    const ratio = variant.w && variant.h ? variant.w / variant.h : 16 / 9;
    const off = Math.abs(ratio - 16 / 9) > 0.02;
    return h("div.thumb", { class: extra || "", title: off ? "Not 16:9: YouTube adds black bars" : "" },
      h("img.fx", { src: TL.imgUrl(variant.img, variant.rev), alt: `Variant ${variant.label}`, draggable: false }),
      off ? h("span.thumb-warn", "not 16:9") : null);
  };

  TL.variantsView = (project, nav) => {
    const root = h("div.variants");
    const stage = h("div.variants-main");
    const inspector = h("aside.inspector");
    root.append(stage, inspector);

    const selected = () => project.variants.find((v) => v.id === TL.ui.selected[project.id]) || null;
    const select = (v) => { TL.ui.selected[project.id] = v ? v.id : null; render(); };

    const move = (v, dir) => {
      const i = project.variants.indexOf(v), j = i + dir;
      if (j < 0 || j >= project.variants.length) return;
      project.variants.splice(i, 1);
      project.variants.splice(j, 0, v);
      TL.saveProject(project); render();
    };

    const card = (v) => {
      const prog = TL.checklistProgress(v);
      const done = prog.total > 0 && prog.done === prog.total;
      const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
      return h("div.vcard", { class: `${selected() === v ? "selected" : ""} ${v.pick ? "picked" : ""}`, style: { width: `${cardWidth}px` } },
        h("div.vthumb", { onclick: () => select(v) },
          TL.thumbEl(v),
          h("span.vlabel", v.label),
          h("div.vover", { class: v.pick ? "has-pick" : "" },
            v.kind === "sketch" ? TL.iconBtn("sketch", "Edit sketch", stop(() => nav.openSketch(project, v)), { class: "floating small" }) : null,
            TL.iconBtn("monitor", "See it in the feed", stop(() => { select(v); nav.setTab("test"); }), { class: "floating small" }),
            TL.iconBtn("star", v.pick ? "Your pick (click to clear)" : "Mark as your pick", stop(() => {
              for (const o of project.variants) o.pick = o === v ? !v.pick : false;
              TL.saveProject(project); render();
            }), { class: "floating small", on: v.pick, toggle: true }))),
        h("div.vmeta",
          h("span.vname", { title: v.name }, v.name),
          prog.total ? h("span.vprog", { class: done ? "done" : "", title: "Checklist progress" }, done ? TL.icon("check", 14) : `${prog.done}/${prog.total}`) : null));
    };

    const renderStage = () => {
      TL.clear(stage);
      stage.append(h("div.toolbar",
        TL.fxBar(),
        h("span.spacer"),
        h("div.sizer", { title: "Thumbnail size: shrink them to judge at feed size" },
          TL.icon("image", 13),
          h("input.mini", {
            type: "range", min: "110", max: "560", step: "10", value: String(cardWidth),
            oninput: (e) => {
              cardWidth = parseInt(e.target.value, 10);
              localStorage.setItem("thumblab.cardWidth", cardWidth);
              TL.$$(".vcard", stage).forEach((c) => { c.style.width = `${cardWidth}px`; });
            },
          }),
          TL.icon("image", 20)),
        TL.iconBtn("tray", "Bring in art", () => nav.setTab("canvas"), { class: "solid" }),
        TL.iconBtn("sketch", "New sketch", () => TL.newSketchDialog(project, nav), { class: "solid" })));

      if (!project.variants.length) {
        stage.append(h("div.empty.big", TL.icon("compare", 32),
          h("strong", "No versions yet"),
          h("p", "Add rough sketches, then compare them tiny and blurred before you render one."),
          h("div.row.center",
            TL.iconBtn("tray", "Bring in art", () => nav.setTab("canvas"), { kind: "primary", label: "Bring in art" }),
            TL.iconBtn("sketch", "New sketch", () => TL.newSketchDialog(project, nav), { class: "solid", label: "New sketch" }))));
      } else {
        stage.append(h("div.vgrid", project.variants.map(card)));
      }
    };

    const renderInspector = () => {
      TL.clear(inspector);
      const v = selected();
      if (!v) {
        inspector.append(h("div.empty", TL.icon("checklist", 26), h("strong", "Select a version"), h("p.small", "See it large, add notes, run its checklist.")));
        return;
      }
      const save = TL.debounce(() => TL.saveProject(project), 250);
      const i = project.variants.indexOf(v);
      inspector.append(...[
        h("div.insp-preview", TL.thumbEl(v)),
        h("div.insp-head",
          h("span.label-pill", v.label),
          h("input.text.name", { value: v.name, title: "Name", spellcheck: false, oninput: (e) => { v.name = e.target.value; save(); }, onchange: render }),
          TL.iconBtn("left", "Move earlier", () => move(v, -1), { class: "small", disabled: i === 0 }),
          TL.iconBtn("right", "Move later", () => move(v, 1), { class: "small", disabled: i === project.variants.length - 1 })),
        h("div.insp-fields",
          h("input.text", { value: v.title || "", placeholder: `Video title (${project.title})`, title: "Video title shown with this thumbnail in the feed", oninput: (e) => { v.title = e.target.value; save(); } }),
          h("textarea.text", { rows: 2, value: v.notes || "", placeholder: "Notes", oninput: (e) => { v.notes = e.target.value; save(); } })),
        v.warning ? h("div.warn", v.warning) : null,
        TL.checklistPanel(v, () => { TL.saveProject(project); renderStageCounts(); }),
        h("div.insp-actions",
          v.kind === "sketch" ? TL.iconBtn("sketch", "Edit sketch", () => nav.openSketch(project, v)) : null,
          v.source ? TL.iconBtn("external", "Open in its app", () => window.host.openPath(v.source)) : null,
          TL.iconBtn("imagePlus", "Save to this project's library", async () => {
            const img = await TL.loadBitmap(v.img);
            const c = TL.canvas(img.width, img.height);
            c.getContext("2d").drawImage(img, 0, 0);
            await TL.addCanvasToLibrary({ lib: project.library, project }, c, v.name, "Other");
            TL.toast("Saved to this project's library");
          }),
          h("span.spacer"),
          TL.iconBtn("trash", "Remove this version", async () => {
            if (!(await TL.confirm(`Remove version ${v.label}${v.kind === "sketch" ? " and its sketch file" : " (your original file isn't touched)"}?`, "Remove", true))) return;
            if (v.kind === "sketch" && v.source) window.host.removePath(v.source);
            TL.ui.selected[project.id] = null;
            TL.removeVariant(project, v);
          }, { class: "danger" })),
      ].filter(Boolean));
    };

    // Ticking a check only changes the counters; avoid rebuilding the inspector mid-click.
    const renderStageCounts = () => {
      TL.$$(".vcard", stage).forEach((el, idx) => {
        const v = project.variants[idx];
        const m = TL.$(".vmeta .vprog", el);
        const p = TL.checklistProgress(v);
        if (m) {
          const done = p.total > 0 && p.done === p.total;
          m.classList.toggle("done", done);
          if (done) m.replaceChildren(TL.icon("check", 14)); else m.textContent = `${p.done}/${p.total}`;
        }
      });
    };

    function render() {
      renderStage();
      renderInspector();
    }

    render();
    const offs = ["variants-changed", "variant-updated"].map((n) => TL.on(n, () => {
      if (!root.isConnected) { offs.forEach((o) => o()); return; }
      render();
    }));
    return root;
  };
})(window.TL);
