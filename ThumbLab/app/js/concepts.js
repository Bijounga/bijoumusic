/**
 * Concepts: write the idea down before drawing. A concept is a line of text with a status;
 * "Sketch this" turns it into a blank sketch variant that remembers which idea it came from.
 */
(function (TL) {
  const { h } = TL;
  const STATUSES = [
    ["idea", "Idea"], ["sketching", "Sketching"], ["drawn", "Drawn"], ["rejected", "Rejected"],
  ];

  TL.conceptsView = (project, nav) => {
    const root = h("div.concepts");
    const list = h("div.concept-list");

    const add = (text) => {
      if (!text.trim()) return;
      project.concepts.unshift({ id: TL.uid(), text: text.trim(), note: "", status: "idea", created: Date.now() });
      TL.saveProject(project);
      renderList();
    };

    const input = h("textarea.text.concept-input", {
      rows: 2, placeholder: "Write a thumbnail idea. What's in it, what's the one idea, why would someone click? (Enter to add, Shift+Enter for a new line)",
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(input.value); input.value = ""; }
      },
    });

    const renderList = () => {
      TL.clear(list);
      if (!project.concepts.length) {
        list.append(h("div.empty", h("strong", "No ideas yet"), h("p", "Jot down two or three before you start drawing. It's easier to throw away a sentence than a render.")));
        return;
      }
      for (const c of project.concepts) {
        const variants = project.variants.filter((v) => v.conceptId === c.id);
        list.append(h("div.concept", { class: `st-${c.status}` },
          h("textarea.text.concept-text", {
            value: c.text, rows: 2,
            oninput: (e) => { c.text = e.target.value; TL.saveProject(project); },
          }),
          h("input.text.small", {
            placeholder: "Notes: composition, colours, expression, text…", value: c.note || "",
            oninput: (e) => { c.note = e.target.value; TL.saveProject(project); },
          }),
          h("div.concept-foot",
            h("select.select", {
              onchange: (e) => { c.status = e.target.value; TL.saveProject(project); renderList(); },
            }, STATUSES.map(([v, label]) => h("option", { value: v, selected: c.status === v }, label))),
            variants.length ? h("span.muted", `Used in ${variants.map((v) => v.label).join(", ")}`) : null,
            h("span.spacer"),
            h("button.btn.small.primary", {
              title: "Make a blank sketch from this idea and open the sketch pad",
              onclick: async () => {
                const v = await TL.newSketchVariant(project, { width: 1280, height: 720, name: c.text.slice(0, 40), conceptId: c.id });
                if (c.status === "idea") c.status = "sketching";
                TL.saveProject(project);
                nav.openSketch(project, v);
              },
            }, "Sketch this"),
            h("button.icon-btn", {
              title: "Delete idea",
              onclick: async () => {
                if (await TL.confirm("Delete this idea?", "Delete", true)) {
                  project.concepts = project.concepts.filter((x) => x.id !== c.id);
                  TL.saveProject(project); renderList();
                }
              },
            }, "🗑"))));
      }
    };

    root.append(h("div.panel", h("h3", "New idea"), input,
      h("div.row", h("button.btn.primary", { onclick: () => { add(input.value); input.value = ""; input.focus(); } }, "Add idea"))), list);
    renderList();
    return root;
  };
})(window.TL);
