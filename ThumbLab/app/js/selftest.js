/** In-app version of TEST-CHECKLIST.md: tick things off as you try them; ticks are remembered. */
(function (TL) {
  const { h } = TL;

  TL.selfTestView = () => {
    const root = h("div.selftest");
    const ticks = () => TL.state.settings.selfTest;

    const render = () => {
      TL.clear(root);
      let total = 0, done = 0;
      for (const g of TL.TESTLIST) for (const it of g.items) { total++; if (ticks()[it.id]) done++; }

      root.append(h("div.selftest-head",
        h("div", h("h1", "Test checklist"), h("p.muted", "Try each thing, tick it when it works. Your ticks are saved.")),
        h("div.progress-wrap",
          h("div.progress", h("div.progress-bar", { style: { width: `${total ? (done / total) * 100 : 0}%` } })),
          h("strong", `${done} / ${total}`),
          h("button.btn.small.ghost", {
            onclick: async () => { if (await TL.confirm("Clear every tick?", "Clear", true)) { TL.state.settings.selfTest = {}; TL.saveSettings(); render(); } },
          }, "Reset"))));

      for (const g of TL.TESTLIST) {
        const gd = g.items.filter((it) => ticks()[it.id]).length;
        root.append(h("details.check-group.big", { open: gd < g.items.length },
          h("summary", g.name, h("span.muted", ` ${gd}/${g.items.length}`)),
          g.items.map((it) => h("label.check", { class: ticks()[it.id] ? "done" : "" },
            h("input", {
              type: "checkbox", checked: !!ticks()[it.id],
              onchange: (e) => {
                if (e.target.checked) ticks()[it.id] = true; else delete ticks()[it.id];
                TL.saveSettings(); render();
              },
            }),
            h("span", it.text)))));
      }
    };
    render();
    return root;
  };
})(window.TL);
