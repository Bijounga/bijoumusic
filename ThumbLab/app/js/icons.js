/**
 * Drawn line icons (one stroke weight, 24px grid) and quick tooltips.
 *   TL.icon("plus")                      -> <svg> element
 *   TL.iconBtn("trash", "Delete", fn)    -> icon-only button with a tooltip
 * Tooltips read data-tip (or the native title, which is moved to data-tip on first hover) so
 * they appear fast and look like the rest of the app.
 */
(function (TL) {
  const PATHS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    folderOpen: '<path d="M3 8V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v2"/><path d="M3 10h18l-2 9H5z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    imagePlus: '<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/><path d="M16 5h6M19 2v6"/><circle cx="9" cy="9" r="1.5"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    library: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/><path d="m3 17 4-4 4 4 2-2 4 4"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    checklist: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    sketch: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    pen: '<path d="m12 19 7-7 3 3-7 7z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18z"/><path d="m2 2 7.6 7.6"/><circle cx="11" cy="11" r="2"/>',
    brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
    eraser: '<path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21"/><path d="M22 21H7M5 11l9 9"/>',
    eraserSoft: '<path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21"/><path d="M22 21H7"/><path d="M8.5 12.5h.01M11.5 15.5h.01M14.5 9.5h.01M12 11h.01" stroke-width="2.4"/>',
    pipette: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/>',
    move: '<path d="m5 9-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
    fit: '<path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"/>',
    zoom100: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M10 9l-2 1.5V15M14 9h1.5a1 1 0 0 1 1 1v5h-2.5"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    tray: '<path d="M12 3v11M7.5 9.5 12 14l4.5-4.5"/><path d="M3 14v4a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-4"/>',
    send: '<path d="M12 15V3M7 8l5-5 5 5M4 21h16"/>',
    external: '<path d="M14 3h7v7M21 3l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    lightbulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
    compare: '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>',
    monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4M10 8.5l4 2.5-4 2.5z"/>',
    star: '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M2 12s3.6-7 10-7c2 0 3.7.7 5.2 1.6M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.2-1.6"/><path d="M3 3l18 18"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    mirror: '<path d="M12 3v18M8 7 3 17h5zM16 7l5 10h-5z"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
    blur: '<path d="M12 2.7 5.6 9.4a8 8 0 1 0 12.8 0z"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
    squint: '<path d="M2 12c3-2.8 6-4 10-4s7 1.2 10 4c-3 2.8-6 4-10 4s-7-1.2-10-4z"/><circle cx="12" cy="12" r="1.6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01" stroke-width="2.4"/>',
    sort: '<path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    phoneOff: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2M3 3l18 18"/>',
    home: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    results: '<rect x="3" y="4" width="7" height="5" rx="1"/><path d="M13 5h8M13 8h5"/><rect x="3" y="15" width="7" height="5" rx="1"/><path d="M13 16h8M13 19h5"/>',
    watch: '<rect x="3" y="4" width="12" height="9" rx="1.5"/><path d="M18 5h3M18 9h3M18 13h3M3 17h12M3 20h8"/>',
    gridView: '<path d="M4 6h4M4 12h4M4 18h4M12 6h8M12 12h8M12 18h8"/>',
    note: '<path d="M5 3h14a1 1 0 0 1 1 1v12l-5 5H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 8h8M8 12h8M8 16h4"/>',
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    auto: '<path d="m13 2-9 12h7l-1 8 9-12h-7z"/>',
    tree: '<path d="M4 4h6v5H4zM14 4h6v5h-6zM9 15h6v5H9z"/><path d="M7 9v3h10V9M12 12v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14 9l2 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01" stroke-width="2.2"/>',
    save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
    drag: '<path d="M5 9h14M5 15h14"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    play: '<path d="M7 4v16l13-8z"/>',
  };

  /** An <svg> for the named icon. size in px (default 18). */
  TL.icon = (name, size) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size || 18);
    svg.setAttribute("height", size || 18);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "ico");
    svg.innerHTML = PATHS[name] || "";
    return svg;
  };
  TL.hasIcon = (name) => !!PATHS[name];

  /**
   * Icon-only button.  opts: { kind: "primary"|"ghost"|"danger", on: bool, label: "text beside icon", size, class }
   * The tip doubles as the accessible name.
   */
  TL.iconBtn = (name, tip, onclick, opts = {}) => TL.h("button.ib", {
    type: "button", "data-tip": tip, "aria-label": tip,
    class: `${opts.kind || ""} ${opts.on ? "on" : ""} ${opts.label ? "has-label" : ""} ${opts.class || ""}`,
    disabled: opts.disabled, "aria-pressed": opts.toggle ? String(!!opts.on) : undefined, onclick,
  }, TL.icon(name, opts.size), opts.label ? TL.h("span", opts.label) : null);

  // ---- tooltips ----------------------------------------------------------------------------
  let tipEl = null, tipTimer = null, tipTarget = null;

  function hideTip() {
    clearTimeout(tipTimer);
    tipTarget = null;
    if (tipEl) tipEl.classList.remove("show");
  }

  function showTip(el) {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    if (!tipEl) { tipEl = TL.h("div.tooltip", { role: "tooltip" }); document.body.append(tipEl); }
    tipEl.textContent = text;
    const r = el.getBoundingClientRect();
    tipEl.style.left = "0px"; tipEl.style.top = "0px";
    tipEl.classList.add("show");
    const t = tipEl.getBoundingClientRect();
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(6, Math.min(window.innerWidth - t.width - 6, left));
    let top = r.bottom + 8;
    if (top + t.height > window.innerHeight - 6) top = r.top - t.height - 8;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  }

  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest && e.target.closest("[data-tip],[title]");
    if (!el || el === tipTarget) return;
    if (el.hasAttribute("title")) {
      // Take over the native tooltip so only one appears, and keep an accessible name.
      el.setAttribute("data-tip", el.getAttribute("title"));
      if (!el.hasAttribute("aria-label") && !el.textContent.trim()) el.setAttribute("aria-label", el.getAttribute("title"));
      el.removeAttribute("title");
    }
    hideTip();
    tipTarget = el;
    tipTimer = setTimeout(() => showTip(el), 350);
  });
  document.addEventListener("mouseout", (e) => {
    if (tipTarget && !(e.relatedTarget && tipTarget.contains(e.relatedTarget))) hideTip();
  });
  window.addEventListener("pointerdown", hideTip, true);
  window.addEventListener("scroll", hideTip, true);
})(window.TL);
