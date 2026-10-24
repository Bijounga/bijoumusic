/**
 * Small shared helpers: DOM building, modals, toasts, image conversion.
 * Everything hangs off the global TL namespace (plain scripts, no bundler).
 */
window.TL = window.TL || {};

(function (TL) {
  // ---- tiny event bus ----------------------------------------------------------
  const listeners = {};
  TL.on = (name, fn) => {
    (listeners[name] = listeners[name] || new Set()).add(fn);
    return () => listeners[name].delete(fn);
  };
  TL.emit = (name, payload) => {
    for (const fn of [...(listeners[name] || [])]) {
      try { fn(payload); } catch (e) { console.error(`listener for ${name} failed`, e); }
    }
  };

  // ---- DOM ---------------------------------------------------------------------
  /** h("div.card#id", { onclick, style: {..}, dataset: {..} }, ...children) */
  TL.h = function h(tag, props, ...kids) {
    const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(tag);
    const el = document.createElement(m ? m[1] : tag);
    if (m && m[2]) {
      for (const part of m[2].match(/[.#][\w-]+/g)) {
        if (part[0] === ".") el.classList.add(part.slice(1));
        else el.id = part.slice(1);
      }
    }
    if (props && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
      kids.unshift(props);
      props = null;
    }
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.classList.add(...String(v).split(/\s+/).filter(Boolean));
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k in el && k !== "list" && k !== "type" && k !== "form") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    const add = (kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      if (Array.isArray(kid)) kid.forEach(add);
      else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    };
    kids.forEach(add);
    return el;
  };
  TL.$ = (sel, root) => (root || document).querySelector(sel);
  TL.$$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  TL.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  TL.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  TL.debounce = (fn, ms) => {
    let t;
    const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
    return wrapped;
  };

  TL.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Seeded PRNG so a "pinned" feed stays the same between visits.
  TL.rng = (seed) => {
    let s = (seed >>> 0) || 1;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  TL.fmtViews = (n) => {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(n);
  };

  TL.timeAgo = (iso) => {
    const secs = (Date.now() - new Date(iso).getTime()) / 1000;
    const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [name, s] of units) {
      if (secs >= s) { const n = Math.floor(secs / s); return `${n} ${name}${n === 1 ? "" : "s"} ago`; }
    }
    return "just now";
  };

  // ---- toasts + modals -----------------------------------------------------------
  TL.toast = (msg, kind) => {
    const el = TL.h("div.toast", { class: kind || "" }, msg);
    TL.$("#toasts").append(el);
    setTimeout(() => el.classList.add("out"), kind === "bad" ? 6000 : 2800);
    setTimeout(() => el.remove(), kind === "bad" ? 6400 : 3200);
  };

  /** Opens a modal; resolves with the value passed to close(value). */
  TL.modal = ({ title, body, buttons, wide, onClose }) => new Promise((resolve) => {
    const root = TL.$("#modal-root");
    const close = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      if (onClose) onClose();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(undefined); }
    };
    const foot = TL.h("div.modal-foot", (buttons || []).map((b) =>
      TL.h("button.btn", { class: b.kind || "", onclick: () => { if (b.onclick) b.onclick(close); else close(b.value); } }, b.label)));
    const box = TL.h("div.modal", { class: wide ? "wide" : "", role: "dialog" },
      TL.h("div.modal-head", TL.h("h2", title), TL.h("button.icon-btn", { title: "Close", onclick: () => close(undefined) }, "✕")),
      TL.h("div.modal-body", body),
      buttons && buttons.length ? foot : null);
    const overlay = TL.h("div.overlay", { onmousedown: (e) => { if (e.target === overlay) close(undefined); } }, box);
    root.append(overlay);
    document.addEventListener("keydown", onKey, true);
    const first = TL.$("input, textarea, button.primary", box);
    if (first) first.focus();
  });

  TL.confirm = (text, okLabel, danger) => TL.modal({
    title: "Are you sure?",
    body: TL.h("p", text),
    buttons: [
      { label: "Cancel", value: false },
      { label: okLabel || "OK", value: true, kind: danger ? "danger" : "primary" },
    ],
  }).then((v) => !!v);

  TL.prompt = (title, value, placeholder) => {
    const input = TL.h("input.text", { value: value || "", placeholder: placeholder || "" });
    return new Promise((resolve) => {
      TL.modal({
        title,
        body: input,
        buttons: [
          { label: "Cancel", value: null },
          { label: "OK", kind: "primary", onclick: (close) => close(input.value.trim() || null) },
        ],
      }).then(resolve);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") TL.$(".modal-foot .primary").click();
      });
    });
  };

  // ---- images ----------------------------------------------------------------------
  TL.imgUrl = (path, rev) => (path ? window.host.fileUrl(path) + (rev ? `?r=${rev}` : "") : "");

  TL.loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The image could not be loaded."));
    img.src = url;
  });

  /** Reads an image file through the main process, so drawing it never taints a canvas. */
  TL.loadBitmap = async (path) => createImageBitmap(new Blob([await window.host.readFile(path)]));

  TL.canvas = (w, h) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };

  TL.canvasToBytes = (canvas, type, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Could not encode the image."));
      blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)));
    }, type || "image/png", quality);
  });

  /** host.preview() result -> canvas (full size). */
  TL.previewToCanvas = async (prev) => {
    if (prev.kind === "rgba") {
      const c = TL.canvas(prev.width, prev.height);
      const data = new Uint8ClampedArray(prev.rgba.buffer, prev.rgba.byteOffset, prev.width * prev.height * 4);
      c.getContext("2d").putImageData(new ImageData(data, prev.width, prev.height), 0, 0);
      return c;
    }
    const bmp = await createImageBitmap(new Blob([prev.png]));
    const c = TL.canvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close();
    return c;
  };

  /** Scales a canvas down so neither side exceeds max (never up). */
  TL.fitCanvas = (src, maxW, maxH, flatten) => {
    const s = Math.min(1, maxW / src.width, maxH / src.height);
    const c = TL.canvas(src.width * s, src.height * s);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (flatten) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  };

  TL.fileName = (p) => String(p).split(/[\\/]/).pop();
  TL.baseName = (p) => TL.fileName(p).replace(/\.[^.]+$/, "");
  TL.extOf = (p) => (TL.fileName(p).match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();

  TL.copyText = (s) => navigator.clipboard.writeText(s);
})(window.TL);
