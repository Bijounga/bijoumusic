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

  /** Three icon toggles (blur, grayscale, squint) and a strength slider that shows only while one needs it. */
  TL.fxBar = () => {
    const bar = h("div.fxbar");
    const keys = ["blur", "gray", "squint"];
    const spec = {
      blur: ["blur", "Blur: do the big shapes still read? (Alt+B)"],
      gray: ["contrast", "Grayscale: is there still value separation? (Alt+G)"],
      squint: ["squint", "Squint: less detail and contrast, does the focal point survive? (Alt+S)"],
    };
    const btns = keys.map((k) => TL.iconBtn(spec[k][0], spec[k][1], () => fx.toggle(k), { toggle: true, on: fx[k] }));
    const slider = h("input.mini", {
      type: "range", min: "0.8", max: "6", step: "0.1", value: String(fx.amount), title: "Blur strength",
      oninput: (e) => { fx.amount = parseFloat(e.target.value); fx.apply(); },
    });
    bar.append(...btns, slider);
    const sync = () => {
      btns.forEach((b, i) => { b.classList.toggle("on", fx[keys[i]]); b.setAttribute("aria-pressed", String(fx[keys[i]])); });
      slider.hidden = !(fx.blur || fx.squint);
      if (document.activeElement !== slider) slider.value = String(fx.amount);
    };
    sync();
    const off = TL.on("fx-changed", () => { if (!bar.isConnected) { off(); return; } sync(); });
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
