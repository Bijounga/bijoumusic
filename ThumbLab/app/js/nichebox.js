/**
 * The niche field. Click it and type: whatever you type is the niche (or the search terms for the
 * Test tab). Presets you saved show as suggestions, filtered as you type. ☆ saves what's typed as a
 * preset (★ removes it); × on a suggestion removes that preset. Nothing is built in: the list is yours.
 */
(function (TL) {
  const { h } = TL;

  const presets = () => (TL.state.settings.niches = TL.state.settings.niches || []);
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const isPreset = (text) => presets().some((p) => same(p, text));

  // Boxes showing the same project's niche (the header's and the Test tab's) follow each other.
  const groups = new Map();

  TL.nicheBox = ({ value = "", group, onCommit, placeholder = "Type a niche or search terms" } = {}) => {
    let current = String(value || "").trim(); // the niche as last committed
    let edited = false;                       // typed since the box was focused (so suggestions filter)
    let active = -1;                          // keyboard-highlighted row
    let pop = null;

    const input = h("input.text", { value: current, placeholder, spellcheck: false, autocomplete: "off", title: "Click and type; Enter to apply" });
    const star = h("button.icon-btn.nstar", { type: "button", onmousedown: (e) => e.preventDefault(), onclick: toggleStar });
    const root = h("div.nichebox", input, star);
    root.getValue = () => input.value.trim();
    root.follow = (v) => { current = v; if (document.activeElement !== input) input.value = v; refreshStar(); };
    if (group) {
      // (a new box isn't on the page yet, so only forget old ones when there get to be a lot)
      let list = groups.get(group) || [];
      if (list.length > 30) list = list.filter((b) => b.isConnected);
      list.push(root);
      groups.set(group, list);
    }

    const text = () => input.value.trim();

    function refreshStar() {
      const t = text();
      star.disabled = !t;
      star.textContent = t && isPreset(t) ? "★" : "☆";
      star.title = !t ? "Type a niche to save it as a preset" : isPreset(t) ? "Remove this preset" : "Save as a preset";
      star.classList.toggle("on", !!t && isPreset(t));
    }

    function toggleStar() {
      const t = text();
      if (!t) return;
      if (isPreset(t)) TL.state.settings.niches = presets().filter((p) => !same(p, t));
      else presets().push(t);
      TL.saveSettings();
      refreshStar();
      if (pop) renderPop();
    }

    function commit(v) {
      v = String(v).trim();
      closePop();
      input.value = v;
      if (v !== current) {
        current = v; refreshStar();
        if (group) {
          const live = (groups.get(group) || []).filter((b) => b.isConnected);
          groups.set(group, live);
          for (const b of live) if (b !== root) b.follow(v);
        }
        if (onCommit) onCommit(v);
      }
      else refreshStar();
    }

    // ---- suggestions
    function rows() {
      const q = edited ? text().toLowerCase() : "";
      const out = [];
      if (edited && text() && !isPreset(text())) out.push({ kind: "typed", value: text() });
      for (const p of presets()) if (!q || p.toLowerCase().includes(q)) out.push({ kind: "preset", value: p });
      return out;
    }

    function renderPop() {
      if (!pop) return;
      TL.clear(pop);
      const list = rows();
      if (active >= list.length) active = list.length - 1;
      list.forEach((r, i) => {
        const row = h("div.nrow", {
          class: i === active ? "on" : "",
          onmousedown: (e) => e.preventDefault(),
          onclick: () => commit(r.value),
          onmouseenter: () => { active = i; [...pop.children].forEach((c, k) => c.classList.toggle("on", k === i)); },
        }, r.kind === "typed"
          ? [h("span", "Use "), h("strong", `“${r.value}”`), h("span.muted.small", "  ↵")]
          : [h("span.ntext", r.value), h("button.icon-btn.nx", {
              type: "button", title: "Remove this preset",
              onmousedown: (e) => e.preventDefault(),
              onclick: (e) => {
                e.stopPropagation();
                TL.state.settings.niches = presets().filter((p) => !same(p, r.value));
                TL.saveSettings(); refreshStar(); renderPop();
              },
            }, "×")]);
        pop.append(row);
      });
      if (!presets().length) pop.append(h("div.nhint", "No presets yet. Type a niche and press ☆ to keep it here."));
      else if (!list.length) pop.append(h("div.nhint", "No preset matches. Press Enter to use what you typed."));
      place();
    }

    function place() {
      if (!pop) return;
      const r = input.getBoundingClientRect();
      pop.style.left = `${r.left}px`;
      pop.style.top = `${r.bottom + 4}px`;
      pop.style.minWidth = `${Math.max(r.width, 240)}px`;
      pop.style.maxHeight = `${Math.max(120, window.innerHeight - r.bottom - 16)}px`;
    }

    function openPop() {
      if (pop) return;
      pop = h("div.nichepop");
      document.body.append(pop);
      active = -1;
      renderPop();
    }

    function closePop() {
      if (pop) { pop.remove(); pop = null; }
      active = -1;
    }

    input.addEventListener("click", openPop);
    input.addEventListener("focus", () => { edited = false; input.select(); openPop(); refreshStar(); });
    input.addEventListener("input", () => { edited = true; active = -1; openPop(); renderPop(); refreshStar(); });
    input.addEventListener("blur", () => { commit(input.value); edited = false; });
    input.addEventListener("keydown", (e) => {
      const list = rows();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openPop();
        if (!list.length) return;
        active = e.key === "ArrowDown" ? (active + 1) % list.length : (active - 1 + list.length) % list.length;
        renderPop();
      } else if (e.key === "Enter") {
        e.preventDefault();
        commit(active >= 0 && list[active] ? list[active].value : input.value);
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        input.value = current; edited = false;
        closePop(); refreshStar();
        input.blur();
      }
    });
    window.addEventListener("resize", place);
    refreshStar();
    return root;
  };
})(window.TL);
