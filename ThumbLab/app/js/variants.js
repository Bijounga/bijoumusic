/**
 * Variants: A/B/C versions of the thumbnail side by side. Shrink them, blur them, squint
 * at them, star the winner, and work through the checklist for the selected one.
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
      const sel = selected() === v;
      return h("div.vcard", { class: `${sel ? "selected" : ""} ${v.pick ? "picked" : ""}`, style: { width: `${cardWidth}px` } },
        h("div.vthumb", { onclick: () => select(v) }, TL.thumbEl(v),
          h("span.label-pill.big", v.label),
          v.kind === "sketch" ? h("span.badge.corner", "SKETCH") : null),
        h("div.vmeta",
          h("button.star", {
            class: v.pick ? "on" : "", title: v.pick ? "This is your pick" : "Mark as my pick",
            onclick: () => { for (const o of project.variants) o.pick = o === v ? !v.pick : false; TL.saveProject(project); render(); },
          }, v.pick ? "★" : "☆"),
          h("span.vname", { title: v.name }, v.name),
          h("span.muted", { title: "Checklist progress" }, prog.total ? `${prog.done}/${prog.total}` : "")),
        h("div.vtools",
          h("button.icon-btn.tiny", { title: "Move earlier", onclick: () => move(v, -1) }, "◀"),
          h("button.icon-btn.tiny", { title: "Move later", onclick: () => move(v, 1) }, "▶"),
          v.kind === "sketch" ? h("button.btn.small", { onclick: () => nav.openSketch(project, v) }, "✎ Edit") : null,
          h("span.spacer"),
          h("button.btn.small", { onclick: () => { select(v); nav.setTab("test"); } }, "Test")));
    };

    const renderStage = () => {
      TL.clear(stage);
      stage.append(h("div.toolbar",
        TL.fxBar(),
        h("label.fxamount", { title: "Make the thumbnails bigger or smaller to judge them at feed size" },
          "Size",
          h("input", {
            type: "range", min: "110", max: "560", step: "10", value: String(cardWidth),
            oninput: (e) => { cardWidth = parseInt(e.target.value, 10); localStorage.setItem("thumblab.cardWidth", cardWidth); TL.$$(".vcard", stage).forEach((c) => { c.style.width = `${cardWidth}px`; }); },
          })),
        h("div.chips",
          h("button.chip", { onclick: () => { cardWidth = 168; localStorage.setItem("thumblab.cardWidth", 168); render(); }, title: "Sidebar size on YouTube" }, "Sidebar"),
          h("button.chip", { onclick: () => { cardWidth = 210; localStorage.setItem("thumblab.cardWidth", 210); render(); }, title: "Roughly home-feed size" }, "Feed"),
          h("button.chip", { onclick: () => { cardWidth = 360; localStorage.setItem("thumblab.cardWidth", 360); render(); } }, "Large"))));

      if (!project.variants.length) {
        stage.append(h("div.empty.big",
          h("strong", "No versions yet"),
          h("p", "Add your rough sketches here and compare them tiny and blurred before you commit to rendering one."),
          h("div.row.center",
            h("button.btn.primary", { onclick: () => nav.setTab("canvas") }, "Bring art in"),
            h("button.btn", { onclick: () => TL.newSketchDialog(project, nav) }, "✎ New sketch"))));
      } else {
        stage.append(h("div.vgrid", project.variants.map(card)));
        stage.append(h("div.muted.hint", "Click a version to open its checklist. Star the one you're going with."));
      }
    };

    const renderInspector = () => {
      TL.clear(inspector);
      const v = selected();
      if (!v) {
        inspector.append(h("div.empty", h("strong", "Pick a version"), h("p", "Select one to see it large, add notes and work through its checklist.")));
        return;
      }
      const save = TL.debounce(() => TL.saveProject(project), 250);
      inspector.append(...[
        h("div.insp-preview", TL.thumbEl(v)),
        h("div.insp-head",
          h("span.label-pill.big", v.label),
          h("input.text.name", { value: v.name, title: "Name", oninput: (e) => { v.name = e.target.value; save(); }, onchange: render })),
        h("label.field", "Video title for this thumbnail",
          h("input.text", {
            value: v.title || "", placeholder: project.title,
            oninput: (e) => { v.title = e.target.value; save(); },
          })),
        h("label.field", "Notes",
          h("textarea.text", { rows: 2, value: v.notes || "", placeholder: "What works, what doesn't…", oninput: (e) => { v.notes = e.target.value; save(); } })),
        v.warning ? h("div.warn", v.warning) : null,
        TL.checklistPanel(v, () => { TL.saveProject(project); renderStageCounts(); }),
        h("div.insp-actions",
          v.kind === "sketch" ? h("button.btn.small.primary", { onclick: () => nav.openSketch(project, v) }, "✎ Edit sketch") : null,
          v.source ? h("button.btn.small", { onclick: () => window.host.openPath(v.source) }, "Open in app") : null,
          h("button.btn.small", {
            title: "Save this image into this project's library",
            onclick: async () => {
              const img = await TL.loadBitmap(v.img);
              const c = TL.canvas(img.width, img.height);
              c.getContext("2d").drawImage(img, 0, 0);
              await TL.addCanvasToLibrary({ lib: project.library, project }, c, v.name, "Other");
              TL.toast("Saved to this project's library");
            },
          }, "Save to library"),
          h("button.btn.small.danger", {
            onclick: async () => {
              if (!(await TL.confirm(`Remove version ${v.label}${v.kind === "sketch" ? " and its sketch file" : " (your original file isn't touched)"}?`, "Remove", true))) return;
              if (v.kind === "sketch" && v.source) window.host.removePath(v.source);
              TL.ui.selected[project.id] = null;
              TL.removeVariant(project, v);
            },
          }, "Remove")),
      ].filter(Boolean));
    };

    // Ticking a check only changes the "3/11" counters; avoid rebuilding the inspector mid-click.
    const renderStageCounts = () => {
      TL.$$(".vcard", stage).forEach((el, i) => {
        const v = project.variants[i];
        const m = TL.$(".vmeta .muted", el);
        const p = TL.checklistProgress(v);
        if (m) m.textContent = p.total ? `${p.done}/${p.total}` : "";
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
