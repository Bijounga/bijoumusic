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
      rows: 1, placeholder: "A thumbnail idea: what's in it, the one idea, why click?",
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(input.value); input.value = ""; }
      },
    });

    const renderList = () => {
      TL.clear(list);
      if (!project.concepts.length) {
        list.append(h("div.empty", TL.icon("lightbulb", 28), h("strong", "No ideas yet"), h("p.small", "Jot down two or three before you draw.")));
        return;
      }
      for (const c of project.concepts) {
        const variants = project.variants.filter((v) => v.conceptId === c.id);
        list.append(h("div.concept", { class: `st-${c.status}` },
          h("textarea.text.concept-text", {
            value: c.text, rows: 1,
            oninput: (e) => { c.text = e.target.value; TL.saveProject(project); },
          }),
          c.note || c.showNote ? h("input.text.small", {
            placeholder: "Notes: composition, colours, expression…", value: c.note || "",
            oninput: (e) => { c.note = e.target.value; TL.saveProject(project); },
          }) : null,
          h("div.concept-foot",
            h("span.dot", { class: `st-${c.status}` }),
            h("select.select.tiny", {
              title: "Status",
              onchange: (e) => { c.status = e.target.value; TL.saveProject(project); renderList(); },
            }, STATUSES.map(([v, label]) => h("option", { value: v, selected: c.status === v }, label))),
            variants.length ? h("span.muted.small", `In ${variants.map((v) => v.label).join(", ")}`) : null,
            h("span.spacer"),
            c.note || c.showNote ? null : TL.iconBtn("note", "Add a note", () => { c.showNote = true; renderList(); }, { class: "small" }),
            TL.iconBtn("sketch", "Sketch this idea", async () => {
              const v = await TL.newSketchVariant(project, { width: 1280, height: 720, name: c.text.slice(0, 40), conceptId: c.id });
              if (c.status === "idea") c.status = "sketching";
              TL.saveProject(project);
              nav.openSketch(project, v);
            }, { class: "solid", label: "Sketch" }),
            TL.iconBtn("trash", "Delete idea", async () => {
              if (await TL.confirm("Delete this idea?", "Delete", true)) {
                project.concepts = project.concepts.filter((x) => x.id !== c.id);
                TL.saveProject(project); renderList();
              }
            }, { class: "danger small" }))));
      }
    };

    root.append(h("div.concept-add", input,
      TL.iconBtn("plus", "Add idea (Enter)", () => { add(input.value); input.value = ""; input.focus(); }, { kind: "primary" })), list);
    renderList();
    return root;
  };
})(window.TL);
