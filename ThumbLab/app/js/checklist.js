/**
 * Thumbnail checklists. Global groups (Readability / Story / Composition by default) apply
 * to every thumbnail and are edited once in Settings; each thumbnail can also carry its own
 * extra items. A thumbnail's ticks are stored on the variant: checks[itemId] = true.
 */
(function (TL) {
  const { h } = TL;

  TL.checklistGroups = () => TL.state.settings.checklists || [];

  TL.checklistProgress = (variant) => {
    let total = 0, done = 0;
    for (const g of TL.checklistGroups()) {
      for (const it of g.items) { total++; if (variant.checks && variant.checks[it.id]) done++; }
    }
    for (const it of variant.extra || []) { total++; if (it.done) done++; }
    return { done, total };
  };

  /** The checklist for one thumbnail. onChange fires after every edit (caller saves). */
  TL.checklistPanel = (variant, onChange) => {
    const root = h("div.checklist");
    variant.checks = variant.checks || {};
    variant.extra = variant.extra || [];

    const render = () => {
      TL.clear(root);
      const prog = TL.checklistProgress(variant);
      root.append(h("div.check-head",
        h("strong", "Checklist"),
        h("span.muted", `${prog.done} / ${prog.total}`),
        h("button.btn.small.ghost", { title: "Edit the shared checklist items", onclick: () => TL.editChecklists().then(render) }, "Edit shared list")));

      for (const g of TL.checklistGroups()) {
        const doneIn = g.items.filter((it) => variant.checks[it.id]).length;
        root.append(h("details.check-group", { open: true },
          h("summary", g.name, h("span.muted", ` ${doneIn}/${g.items.length}`)),
          g.items.map((it) => h("label.check", { class: variant.checks[it.id] ? "done" : "" },
            h("input", {
              type: "checkbox", checked: !!variant.checks[it.id],
              onchange: (e) => { variant.checks[it.id] = e.target.checked; onChange(); render(); },
            }),
            h("span", it.text)))));
      }

      const extra = h("details.check-group", { open: true },
        h("summary", "Just this thumbnail"),
        variant.extra.map((it) => h("label.check", { class: it.done ? "done" : "" },
          h("input", { type: "checkbox", checked: !!it.done, onchange: (e) => { it.done = e.target.checked; onChange(); render(); } }),
          h("span", it.text),
          h("button.icon-btn.tiny", {
            title: "Remove",
            onclick: (e) => { e.preventDefault(); variant.extra = variant.extra.filter((x) => x !== it); onChange(); render(); },
          }, "✕"))),
        h("input.text.small", {
          placeholder: "Add a check for this thumbnail, press Enter",
          onkeydown: (e) => {
            if (e.key !== "Enter" || !e.target.value.trim()) return;
            variant.extra.push({ id: TL.uid(), text: e.target.value.trim(), done: false });
            onChange(); render();
          },
        }));
      root.append(extra);
    };
    render();
    return root;
  };

  /** Modal for editing the shared checklist groups. */
  TL.editChecklists = () => {
    const groups = JSON.parse(JSON.stringify(TL.checklistGroups()));
    const body = h("div.check-editor");
    const render = () => {
      TL.clear(body);
      groups.forEach((g, gi) => {
        body.append(h("div.check-edit-group",
          h("div.row",
            h("input.text", { value: g.name, onchange: (e) => { g.name = e.target.value; } }),
            h("button.btn.small.danger", { onclick: () => { groups.splice(gi, 1); render(); } }, "Delete group")),
          g.items.map((it, ii) => h("div.row",
            h("input.text.small", { value: it.text, onchange: (e) => { it.text = e.target.value; } }),
            h("button.icon-btn.tiny", { title: "Remove item", onclick: () => { g.items.splice(ii, 1); render(); } }, "✕"))),
          h("button.btn.small.ghost", { onclick: () => { g.items.push({ id: TL.uid(), text: "New check" }); render(); } }, "+ Add item")));
      });
      body.append(h("button.btn", { onclick: () => { groups.push({ id: TL.uid(), name: "New group", items: [] }); render(); } }, "+ Add group"));
    };
    render();
    return TL.modal({
      title: "Shared checklist", wide: true, body,
      buttons: [
        { label: "Cancel", value: false },
        {
          label: "Save", kind: "primary", onclick: (close) => {
            TL.state.settings.checklists = groups;
            TL.saveSettings();
            close(true);
          },
        },
      ],
    });
  };
})(window.TL);
