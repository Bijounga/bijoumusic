/**
 * The three "does it still read?" tests - blur, grayscale, squint. They are one shared
 * setting, applied as a CSS filter to every element with class "fx". Blur sizes are in
 * container-width units (cqw) so the same slider value looks the same on a tiny feed
 * thumbnail and on a big preview.
 */
(function (TL) {
  const { h } = TL;

  const fx = (TL.fx = { blur: false, gray: false, squint: false, amount: 2.4 });
  try {
    Object.assign(fx, JSON.parse(localStorage.getItem("thumblab.fx") || "{}"));
  } catch (e) { /* first run */ }

  function filterString() {
    const parts = [];
    // Squint = less detail and less contrast, but not an extreme blur.
    if (fx.squint) parts.push(`blur(${(fx.amount * 0.55).toFixed(2)}cqw)`, "contrast(0.55)", "brightness(0.92)");
    if (fx.blur) parts.push(`blur(${fx.amount.toFixed(2)}cqw)`);
    if (fx.gray) parts.push("grayscale(1)");
    return parts.length ? parts.join(" ") : "none";
  }

  fx.apply = () => {
    document.documentElement.style.setProperty("--fx-filter", filterString());
    try { localStorage.setItem("thumblab.fx", JSON.stringify(fx)); } catch (e) { /* ignore */ }
    TL.emit("fx-changed");
  };

  fx.toggle = (name) => { fx[name] = !fx[name]; fx.apply(); };

  /** A toolbar with the three toggles and the strength slider. Stays in sync across views. */
  TL.fxBar = () => {
    const bar = h("div.fxbar");
    const render = () => {
      TL.clear(bar);
      const btn = (key, label, tip) => h("button.chip", {
        class: fx[key] ? "on" : "", title: tip, "aria-pressed": fx[key],
        onclick: () => fx.toggle(key),
      }, label);
      bar.append(
        h("span.fxlabel", "Tests"),
        btn("blur", "Blur", "Blur it heavily: do the big shapes still read? (Alt+B)"),
        btn("gray", "Grayscale", "Drop the colour: is there still value separation? (Alt+G)"),
        btn("squint", "Squint", "Less detail and contrast: does the focal point survive? (Alt+S)"),
        h("label.fxamount", { title: "Blur strength" },
          "Strength",
          h("input", {
            type: "range", min: "0.8", max: "6", step: "0.1", value: String(fx.amount),
            oninput: (e) => { fx.amount = parseFloat(e.target.value); fx.apply(); },
          })));
    };
    render();
    const off = TL.on("fx-changed", () => {
      if (!bar.isConnected) { off(); return; }
      // Re-render only the pressed state; don't rebuild while dragging the slider.
      TL.$$(".chip", bar).forEach((c, i) => c.classList.toggle("on", fx[["blur", "gray", "squint"][i]]));
      const slider = TL.$("input", bar);
      if (slider && document.activeElement !== slider) slider.value = String(fx.amount);
    });
    return bar;
  };

  window.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    const map = { b: "blur", g: "gray", s: "squint" };
    if (map[k]) { e.preventDefault(); fx.toggle(map[k]); }
  });

  fx.apply();
})(window.TL);
