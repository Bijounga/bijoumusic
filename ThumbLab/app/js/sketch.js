/**
 * Sketch pad: a small layered painter for thumbnail roughs, built for a pen tablet.
 *
 * The existing Doodle Pad engine is an opaque palette-pixel grid (no alpha, no soft
 * edges), so it can't do pressure that changes opacity. This pad uses real canvases
 * instead, but keeps Doodle Pad's pointer lessons: touch-action:none, handle
 * pointercancel, never filter strokes by pointerId, read coalesced events.
 *
 * The sketch lives on disk as a layered PSD (variant.source). That is also the
 * handoff: Photoshop and CSP open it directly, Procreate imports it, and when another
 * app saves over it the pad can reload the layers.
 */
(function (TL) {
  const { h, clamp } = TL;

  const TOOL_DEFS = {
    pen: { label: "Pen", glyph: "pen", key: "p", erase: false, tip: "Crisp line. Pressure changes the width.",
      defaults: { size: 8, opacity: 1, hardness: 1, pSize: 0.7, pOpacity: 0, smooth: 0.35 } },
    brush: { label: "Pressure brush", glyph: "brush", key: "b", erase: false, tip: "Soft paint. Pressure changes both width and how much paint lands.",
      defaults: { size: 60, opacity: 1, hardness: 0.45, pSize: 0.5, pOpacity: 0.9, smooth: 0.2 } },
    eraser: { label: "Eraser", glyph: "eraser", key: "e", erase: true, tip: "Hard eraser. Pressure changes the width.",
      defaults: { size: 30, opacity: 1, hardness: 1, pSize: 0.5, pOpacity: 0, smooth: 0.2 } },
    softEraser: { label: "Pressure eraser", glyph: "eraserSoft", key: "k", erase: true, tip: "Soft eraser. Pressure changes both width and how much it removes.",
      defaults: { size: 70, opacity: 1, hardness: 0.4, pSize: 0.5, pOpacity: 0.9, smooth: 0.2 } },
    fill: { label: "Paint bucket", glyph: "bucket", key: "f", tip: "Fill an area with the colour. Works inside a selection." },
    picker: { label: "Eyedropper", glyph: "pipette", key: "i", tip: "Pick a colour from the picture (or Alt+click with any tool)." },
    move: { label: "Move", glyph: "move", key: "v", tip: "Drag to move the selection, or the whole layer when nothing is selected." },
    select: { label: "Rectangle select", glyph: "select", key: "m", tip: "Drag a box. Painting, erasing and filling stay inside it. Click to deselect." },
    lasso: { label: "Lasso select", glyph: "lasso", key: "l", tip: "Draw around what you want to select." },
    rotate: { label: "Rotate view", glyph: "rotateView", key: "r", tip: "Drag around the canvas to turn it (Shift snaps to 15°). Hold R for this with any tool." },
  };
  const PAINT_TOOLS = ["pen", "brush", "eraser", "softEraser"];
  const SPACING = 0.1; // dab spacing as a fraction of brush width
  const SWATCHES = ["#111111", "#ffffff", "#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#00c7be", "#0a84ff", "#5e5ce6", "#bf5af2", "#ff2d92", "#8e5a3c"];
  const MAX_LAYERS = 24;
  const UNDO_LIMIT = 40;

  function loadToolSettings() {
    const out = {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("thumblab.tools") || "{}"); } catch (e) { /* defaults */ }
    for (const k of PAINT_TOOLS) out[k] = { ...TOOL_DEFS[k].defaults, ...(saved[k] || {}) };
    return out;
  }

  TL.sketchPad = async (project, variant, nav) => {
    // ---- document -------------------------------------------------------------------
    const doc = { w: variant.w || 1280, h: variant.h || 720, layers: [], active: 0 };
    const settings = loadToolSettings();
    let tool = "brush";
    let feel = parseFloat(localStorage.getItem("thumblab.feel") || "50");
    let color = localStorage.getItem("thumblab.color") || "#111111";
    let recent = [];
    let color2 = localStorage.getItem("thumblab.color2") || "#ffffff"; // the background colour (X swaps)
    const view = { cx: 0, cy: 0, s: 1, angle: 0, mirror: false, guides: false, touched: false };
    let stroke = null, pan = null, rotating = null, selecting = null;
    let sel = null; // { polys: [[[x, y], ...]], invert }: the selection, as outlines
    let tf = null;  // floating pixels while moving or transforming
    let spaceDown = false;
    let saving = false, dirty = false, lastSaved = "";
    const undoStack = [], redoStack = [];
    let destroyed = false;

    const newLayerCanvas = () => {
      const c = TL.canvas(doc.w, doc.h);
      return c;
    };
    const makeLayer = (name, canvas) => {
      const c = canvas || newLayerCanvas();
      const el = c;
      el.className = "sk-layer";
      return { id: TL.uid(), name, canvas: c, ctx: c.getContext("2d", { willReadFrequently: false }), el, visible: true, opacity: 1 };
    };

    // ---- load PSD --------------------------------------------------------------------
    try {
      const data = await window.host.readPsdLayers(variant.source);
      doc.w = data.width; doc.h = data.height;
      for (const l of data.layers) {
        const layer = makeLayer(l.name);
        const tmp = TL.canvas(l.width, l.height);
        tmp.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(l.rgba.buffer, l.rgba.byteOffset, l.width * l.height * 4), l.width, l.height), 0, 0);
        layer.ctx.drawImage(tmp, l.left, l.top);
        layer.visible = !l.hidden;
        layer.opacity = l.opacity;
        doc.layers.push(layer);
      }
    } catch (e) {
      TL.toast(`Could not read the sketch file: ${e.message}`, "bad");
    }
    if (!doc.layers.length) doc.layers.push(makeLayer("Sketch"));
    doc.active = doc.layers.length - 1;

    // ---- DOM --------------------------------------------------------------------------
    const root = h("div.sketchpad");
    const viewport = h("div.sk-viewport", { tabIndex: 0 });
    const stage = h("div.sk-stage", { style: { width: `${doc.w}px`, height: `${doc.h}px` } });
    const fxLayer = h("div.sk-fxlayer");
    const mirror = h("div.sk-mirror");
    const paper = h("div.sk-paper");
    const buffer = TL.canvas(doc.w, doc.h);
    buffer.className = "sk-buffer";
    const bctx = buffer.getContext("2d");
    const guides = h("div.sk-guides");
    const overlay = h("div.sk-overlay");
    const ants = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ants.setAttribute("class", "sk-ants");
    ants.setAttribute("viewBox", `0 0 ${doc.w} ${doc.h}`);
    ants.innerHTML = '<path class="a-under"/><path class="a-over"/>';
    ants.style.display = "none";
    const tfBox = h("div.tf-box");
    const tfLine = h("div.tf-line");
    const tfRot = h("div.tf-rot");
    const tfEl = h("div.sk-tf", { style: { display: "none" } }, tfBox, tfLine,
      ...["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((k) => h("div.tf-h", { dataset: { k } })), tfRot);
    overlay.append(ants, tfEl);
    const cursor = h("div.sk-cursor");
    const status = h("div.sk-status");
    const layersPanel = h("div.sk-layers");
    const toolsPanel = h("div.sk-tools");
    const optionsPanel = h("div.sk-options");

    stage.append(fxLayer, guides, overlay);
    fxLayer.append(mirror);
    mirror.append(paper);
    viewport.append(stage, cursor);

    const buildGuides = () => {
      TL.clear(guides);
      const W = doc.w, H = doc.h;
      guides.append(
        h("div.g-thirds", { style: { backgroundImage: "linear-gradient(to right, transparent 33.1%, rgba(255,255,255,.55) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255,255,255,.55) 66.7%, transparent 66.9%), linear-gradient(to bottom, transparent 33.1%, rgba(255,255,255,.55) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255,255,255,.55) 66.7%, transparent 66.9%)" } }),
        h("div.g-safe", { style: { left: `${W * 0.04}px`, top: `${H * 0.06}px`, right: `${W * 0.04}px`, bottom: `${H * 0.06}px` } }),
        h("div.g-badge", { style: { right: `${W * 0.01}px`, bottom: `${H * 0.02}px`, width: `${W * 0.085}px`, height: `${H * 0.06}px` } }, "time"));
    };
    buildGuides();

    function syncStack() {
      // Layers bottom -> top, with the stroke buffer sitting just above the active layer.
      const kids = [paper];
      doc.layers.forEach((l, i) => {
        l.el.style.opacity = l.visible ? String(l.opacity) : "0";
        kids.push(l.el);
        if (i === doc.active) kids.push(buffer);
      });
      guides.style.display = view.guides ? "block" : "none";
      mirror.replaceChildren(...kids);
    }

    function applyView() {
      stage.style.transform = `translate(${view.cx}px, ${view.cy}px) rotate(${view.angle}rad) scale(${view.s}) translate(${-doc.w / 2}px, ${-doc.h / 2}px)`;
      stage.style.setProperty("--inv", String(1 / view.s));
      const flip = view.mirror ? "scaleX(-1)" : "";
      mirror.style.transform = flip;
      guides.style.transform = flip;
      overlay.style.transform = flip;
      if (tf) updateTfHandles();
      renderStatus();
    }

    function fitView() {
      const vw = viewport.clientWidth, vh = viewport.clientHeight;
      if (!vw || !vh) return;
      view.s = Math.min((vw - 48) / doc.w, (vh - 48) / doc.h);
      view.cx = vw / 2;
      view.cy = vh / 2;
      view.angle = 0;
      view.touched = false;
      applyView();
    }

    function setZoomAt(px, py, newS) {
      newS = clamp(newS, 0.1, 8);
      const k = newS / view.s;
      view.cx = px + (view.cx - px) * k;
      view.cy = py + (view.cy - py) * k;
      view.s = newS;
      applyView();
    }

    // ---- compositing -------------------------------------------------------------------
    function flatten(opts = {}) {
      const c = TL.canvas(doc.w, doc.h);
      const ctx = c.getContext("2d");
      if (!opts.transparent) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, doc.w, doc.h); }
      for (const l of doc.layers) {
        if (!l.visible) continue;
        ctx.globalAlpha = l.opacity;
        ctx.drawImage(l.canvas, 0, 0);
      }
      return c;
    }

    function rgba(canvas) {
      const d = canvas.getContext("2d").getImageData(0, 0, doc.w, doc.h).data;
      return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    }

    // ---- saving ------------------------------------------------------------------------
    const setSaved = (text, bad) => { lastSaved = text; renderStatus(bad); };

    async function save() {
      if (tf) commitFloat();
      if (saving) { dirty = true; return; }
      if (!dirty) return;
      saving = true; dirty = false;
      setSaved("Saving…");
      try {
        const flat = flatten();
        await window.host.writePsd({
          abs: variant.source, width: doc.w, height: doc.h,
          layers: doc.layers.map((l) => ({ name: l.name, hidden: !l.visible, opacity: l.opacity, rgba: rgba(l.canvas) })),
          flat: rgba(flat),
        });
        await TL.setVariantImageFromCanvas(project, variant, flat);
        TL.saveProject(project);
        TL.emit("variant-updated", { project, variant, fromPad: true });
        setSaved("Saved");
      } catch (e) {
        setSaved(`Save failed: ${e.message}`, true);
        TL.toast(`Save failed: ${e.message}`, "bad");
      } finally {
        saving = false;
        if (dirty && !destroyed) save();
      }
    }
    const scheduleSave = TL.debounce(save, 1200);
    const touch = () => { dirty = true; setSaved("Unsaved changes…"); scheduleSave(); };

    async function flush() {
      if (tf) commitFloat();
      while (saving) await new Promise((r) => setTimeout(r, 40));
      if (dirty) await save();
    }

    // ---- undo ----------------------------------------------------------------------------
    const copyCanvas = (src) => {
      const c = TL.canvas(src.width, src.height);
      c.getContext("2d").drawImage(src, 0, 0);
      return c;
    };

    function pushPixels(layer, before) {
      undoStack.push({ kind: "pixels", layer, canvas: before });
      while (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack.length = 0;
    }
    function pushOps(undo, redo) {
      undoStack.push({ kind: "ops", undo, redo });
      while (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack.length = 0;
    }

    function swapPixels(entry) {
      const now = copyCanvas(entry.layer.canvas);
      entry.layer.ctx.clearRect(0, 0, doc.w, doc.h);
      entry.layer.ctx.drawImage(entry.canvas, 0, 0);
      entry.canvas = now;
      thumbFor(entry.layer);
    }

    function undo() {
      if (stroke) return;
      if (tf) { cancelFloat(); return; }
      const e = undoStack.pop();
      if (!e) return;
      if (e.kind === "pixels") swapPixels(e); else e.undo();
      redoStack.push(e);
      renderLayers(); touch();
    }
    function redo() {
      if (stroke || tf) return;
      const e = redoStack.pop();
      if (!e) return;
      if (e.kind === "pixels") swapPixels(e); else e.redo();
      undoStack.push(e);
      renderLayers(); touch();
    }

    // ---- brush engine ----------------------------------------------------------------------
    const sprites = new Map();
    function sprite(col, hardness) {
      const key = `${col}|${hardness.toFixed(2)}`;
      let s = sprites.get(key);
      if (s) return s;
      s = TL.canvas(128, 128);
      const ctx = s.getContext("2d");
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      const hd = clamp(hardness, 0, 0.98);
      g.addColorStop(0, col);
      g.addColorStop(hd, col);
      // eased falloff so soft brushes don't show a visible ring
      const rgb = col;
      g.addColorStop(hd + (1 - hd) * 0.5, rgb + "66");
      g.addColorStop(1, rgb + "00");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      if (sprites.size > 40) sprites.delete(sprites.keys().next().value);
      sprites.set(key, s);
      return s;
    }

    const gamma = () => Math.pow(2, (feel - 50) / 50);

    function stamp(ctx, x, y, size, alpha, set, erase) {
      ctx.globalAlpha = alpha;
      if (erase) {
        ctx.globalCompositeOperation = "destination-out";
      }
      if (set.hardness >= 0.96) {
        ctx.fillStyle = erase ? "#000" : color;
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.drawImage(sprite(erase ? "#000000" : color, set.hardness), x - size / 2, y - size / 2, size, size);
      }
      if (erase) ctx.globalCompositeOperation = "source-over";
    }

    function dabParams(p) {
      const set = stroke.set;
      const c = Math.pow(clamp(p, 0, 1), gamma());
      const size = Math.max(set.size * 0.06, 0.6, set.size * (1 - set.pSize + set.pSize * c));
      let A = clamp(1 - set.pOpacity + set.pOpacity * c, 0.02, 1);
      if (stroke.erase) A *= set.opacity; // erasers apply the opacity cap per dab
      const alpha = A >= 0.999 ? 1 : 1 - Math.pow(1 - A, SPACING * 1.6);
      return { size, alpha };
    }

    function dab(x, y, p) {
      const { size, alpha } = dabParams(p);
      const ctx = stroke.erase ? stroke.layer.ctx : bctx;
      stamp(ctx, x, y, size, alpha, stroke.set, stroke.erase);
      ctx.globalAlpha = 1;
      return size;
    }

    function segment(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) return;
      let pos = stroke.carry;
      while (pos <= dist) {
        const t = pos / dist;
        const p = a.p + (b.p - a.p) * t;
        const size = dab(a.x + dx * t, a.y + dy * t, p);
        pos += Math.max(0.5, size * SPACING);
      }
      stroke.carry = pos - dist;
    }

    function pointerDoc(e) {
      const r = viewport.getBoundingClientRect();
      const x = e.clientX - r.left - view.cx, y = e.clientY - r.top - view.cy;
      const ca = Math.cos(view.angle), sa = Math.sin(view.angle);
      // undo the rotation, then the zoom, then measure from the canvas corner
      let dx = (x * ca + y * sa) / view.s + doc.w / 2;
      const dy = (-x * sa + y * ca) / view.s + doc.h / 2;
      if (view.mirror) dx = doc.w - dx;
      return { x: dx, y: dy };
    }

    function pressureOf(e) {
      if (e.pointerType === "mouse") return 0.7;
      // Some pens report 0 on the very first event; treat that as light, not absent.
      return e.pressure > 0 ? e.pressure : 0.05;
    }

    function activeLayer() { return doc.layers[doc.active]; }

    function beginStroke(e, toolKey) {
      if (tf) commitFloat();
      const layer = activeLayer();
      if (!layer.visible) { TL.toast("That layer is hidden. Show it to draw on it."); return false; }
      const def = TOOL_DEFS[toolKey];
      stroke = {
        key: toolKey, set: settings[toolKey], erase: def.erase, layer, carry: 0, last: null,
        before: copyCanvas(layer.canvas), raw: null, sx: 0, sy: 0, sp: 0,
      };
      if (!def.erase) {
        bctx.clearRect(0, 0, doc.w, doc.h);
        buffer.style.opacity = String(stroke.set.opacity * layer.opacity);
      }
      if (sel) { // painting and erasing stay inside the selection
        const ctx = def.erase ? layer.ctx : bctx;
        ctx.save();
        ctx.clip(selPath(), "evenodd");
        stroke.clipCtx = ctx;
      }
      return true;
    }

    function addSample(pt, p, smooth) {
      const s = stroke;
      s.raw = { x: pt.x, y: pt.y, p };
      if (!s.last) {
        s.sx = pt.x; s.sy = pt.y; s.sp = p;
        dab(pt.x, pt.y, p);
        s.last = { x: pt.x, y: pt.y, p };
        return;
      }
      const k = smooth ? 1 - s.set.smooth * 0.85 : 1;
      s.sx += (pt.x - s.sx) * k;
      s.sy += (pt.y - s.sy) * k;
      s.sp += (p - s.sp) * Math.max(k, 0.45);
      const next = { x: s.sx, y: s.sy, p: s.sp };
      segment(s.last, next);
      s.last = next;
    }

    function endStroke() {
      const s = stroke;
      if (!s) return;
      stroke = null;
      if (s.raw && s.last) {
        stroke = s; // finish the lag: catch the smoothed point up to the pen
        for (let i = 0; i < 6; i++) addSample(s.raw, s.raw.p, true);
        stroke = null;
      }
      if (s.clipCtx) { s.clipCtx.restore(); s.clipCtx = null; }
      if (!s.erase) {
        s.layer.ctx.save();
        s.layer.ctx.globalAlpha = s.set.opacity;
        s.layer.ctx.drawImage(buffer, 0, 0);
        s.layer.ctx.restore();
        bctx.clearRect(0, 0, doc.w, doc.h);
      }
      pushPixels(s.layer, s.before);
      thumbFor(s.layer);
      touch();
    }

    // ---- selection -------------------------------------------------------------------------------------
    const rectPoly = (x, y, w, hh) => [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]];
    const clonePolys = (polys) => polys.map((p) => p.map((q) => q.slice()));

    function selPath(s) {
      s = s === undefined ? sel : s;
      const p = new Path2D();
      if (!s) return p;
      if (s.invert) p.rect(0, 0, doc.w, doc.h);
      for (const poly of s.polys) {
        poly.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
        p.closePath();
      }
      return p;
    }

    function selD(s) {
      s = s === undefined ? sel : s;
      if (!s) return "";
      let d = s.invert ? `M0 0H${doc.w}V${doc.h}H0Z` : "";
      for (const poly of s.polys) d += poly.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + "Z";
      return d;
    }

    function selBounds(s) {
      s = s === undefined ? sel : s;
      if (!s) return null;
      if (s.invert) return { x: 0, y: 0, w: doc.w, h: doc.h };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const poly of s.polys) for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      x0 = clamp(Math.floor(x0), 0, doc.w); y0 = clamp(Math.floor(y0), 0, doc.h);
      x1 = clamp(Math.ceil(x1), 0, doc.w); y1 = clamp(Math.ceil(y1), 0, doc.h);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    function setSel(next) {
      sel = next && (next.invert || next.polys.length) ? next : null;
      const d = selD();
      for (const p of ants.querySelectorAll("path")) p.setAttribute("d", d);
      ants.style.display = sel ? "block" : "none";
      renderStatus();
    }

    const selectAll = () => { if (tf) commitFloat(); setSel({ polys: [rectPoly(0, 0, doc.w, doc.h)], invert: false }); };
    const deselect = () => { if (tf) commitFloat(); setSel(null); };
    function invertSelection() {
      if (tf) commitFloat();
      if (!sel) { selectAll(); return; }
      setSel({ polys: sel.polys, invert: !sel.invert });
    }

    function layerForEdit() {
      const L = activeLayer();
      if (!L.visible) { TL.toast("That layer is hidden. Show it to edit it."); return null; }
      return L;
    }

    /** Clears the selected pixels of the active layer, or fills them when a colour is given. */
    function clearSelectionPixels(fillColor) {
      if (tf) commitFloat();
      if (!sel) { TL.toast("Nothing is selected. Ctrl+A selects everything."); return; }
      const L = layerForEdit(); if (!L) return;
      const before = copyCanvas(L.canvas);
      L.ctx.save();
      L.ctx.clip(selPath(), "evenodd");
      if (fillColor) { L.ctx.fillStyle = fillColor; L.ctx.fillRect(0, 0, doc.w, doc.h); } else L.ctx.clearRect(0, 0, doc.w, doc.h);
      L.ctx.restore();
      pushPixels(L, before); thumbFor(L); touch();
    }

    // ---- copy / cut / paste -----------------------------------------------------------------------------
    let internalClip = null; // the last copied selection, so pasting puts it back where it was

    function selectionPixels(L) {
      const b = selBounds() || { x: 0, y: 0, w: doc.w, h: doc.h };
      const c = TL.canvas(b.w, b.h);
      const ctx = c.getContext("2d");
      ctx.translate(-b.x, -b.y);
      if (sel) ctx.clip(selPath(), "evenodd");
      ctx.drawImage(L.canvas, 0, 0);
      return { canvas: c, x: b.x, y: b.y };
    }

    async function copySelection(cut) {
      if (tf) commitFloat();
      if (!sel) {
        await window.host.copyImage(await pngBytes());
        TL.toast("Copied the whole picture");
        return;
      }
      const part = selectionPixels(activeLayer());
      await window.host.copyImage(await TL.canvasToBytes(part.canvas, "image/png"));
      internalClip = { canvas: part.canvas, x: part.x, y: part.y };
      if (cut) clearSelectionPixels(); else TL.toast("Copied");
    }

    function registerAdd(layer) {
      const at = doc.layers.indexOf(layer);
      pushOps(() => { removeLayer(doc.layers.indexOf(layer)); renderLayers(); }, () => { doc.layers.splice(at, 0, layer); doc.active = at; syncStack(); renderLayers(); });
    }

    async function pasteLayer() {
      if (tf) commitFloat();
      const bytes = await window.host.readClipboardImage();
      if (!bytes) { TL.toast("There's no image on the clipboard.", "bad"); return; }
      const bmp = await createImageBitmap(new Blob([bytes]));
      if (internalClip && bmp.width === internalClip.canvas.width && bmp.height === internalClip.canvas.height) {
        // our own copy: back to where it came from, on its own layer, selected
        const c = TL.canvas(doc.w, doc.h);
        c.getContext("2d").drawImage(bmp, internalClip.x, internalClip.y);
        const layer = addLayer("Pasted", c);
        if (!layer) return;
        registerAdd(layer);
        setSel({ polys: [rectPoly(internalClip.x, internalClip.y, bmp.width, bmp.height)], invert: false });
        setTool("move");
        renderLayers(); touch();
        return;
      }
      insertImage(bmp, "Pasted");
    }

    // ---- floating pixels: move, nudge and transform ---------------------------------------------------------
    // Lifting takes the selected pixels (or the whole layer) off the layer into `tf`, drawn on the stroke
    // buffer; committing draws them back, so a whole move or transform is one undo step.
    function tfPolys(t) {
      const plain = t.angle === 0 && t.w === t.src.width && t.h === t.src.height;
      if (plain) {
        const dx = t.cx - t.cx0, dy = t.cy - t.cy0;
        return t.origSel.polys.map((p) => p.map(([x, y]) => [x + dx, y + dy]));
      }
      const ca = Math.cos(t.angle), sa = Math.sin(t.angle), hw = t.w / 2, hh = t.h / 2;
      return [[[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [t.cx + x * ca - y * sa, t.cy + x * sa + y * ca])];
    }

    function beginFloat(mode) {
      const L = layerForEdit(); if (!L) return false;
      const before = copyCanvas(L.canvas);
      const origSel = sel ? { polys: clonePolys(sel.polys), invert: sel.invert } : null;
      let src, x = 0, y = 0;
      if (sel) {
        const part = selectionPixels(L);
        src = part.canvas; x = part.x; y = part.y;
        L.ctx.save(); L.ctx.clip(selPath(), "evenodd"); L.ctx.clearRect(0, 0, doc.w, doc.h); L.ctx.restore();
      } else {
        src = copyCanvas(L.canvas);
        L.ctx.clearRect(0, 0, doc.w, doc.h);
      }
      const cx = x + src.width / 2, cy = y + src.height / 2;
      tf = { layer: L, before, src, mode, origSel, cx, cy, cx0: cx, cy0: cy, w: src.width, h: src.height, angle: 0, drag: null };
      buffer.style.opacity = String(L.opacity);
      drawFloat();
      return true;
    }

    function drawFloat() {
      bctx.clearRect(0, 0, doc.w, doc.h);
      bctx.save();
      bctx.imageSmoothingQuality = "high";
      bctx.translate(tf.cx, tf.cy);
      bctx.rotate(tf.angle);
      bctx.drawImage(tf.src, -tf.w / 2, -tf.h / 2, tf.w, tf.h);
      bctx.restore();
      if (tf.origSel && !tf.origSel.invert) setSel({ polys: tfPolys(tf), invert: false });
      updateTfHandles();
    }

    function commitFloat(skipUndo) {
      if (!tf) return;
      const t = tf;
      tf = null;
      t.layer.ctx.drawImage(buffer, 0, 0);
      bctx.clearRect(0, 0, doc.w, doc.h);
      if (!skipUndo) pushPixels(t.layer, t.before);
      if (t.origSel && !t.origSel.invert) setSel({ polys: tfPolys(t), invert: false });
      else if (t.origSel) setSel(null);
      updateTfHandles();
      thumbFor(t.layer);
      touch();
    }

    function cancelFloat() {
      if (!tf) return;
      const t = tf;
      tf = null;
      t.layer.ctx.clearRect(0, 0, doc.w, doc.h);
      t.layer.ctx.drawImage(t.before, 0, 0);
      bctx.clearRect(0, 0, doc.w, doc.h);
      setSel(t.origSel);
      updateTfHandles();
      thumbFor(t.layer);
    }

    function startTransform() {
      if (tf && tf.mode === "transform") return;
      if (tf) commitFloat();
      beginFloat("transform");
    }

    let lastNudge = 0;
    function nudge(dx, dy) {
      if (tf) { tf.cx += dx; tf.cy += dy; drawFloat(); return; }
      if (!beginFloat("move")) return;
      tf.cx += dx; tf.cy += dy;
      drawFloat();
      const top = undoStack[undoStack.length - 1];
      const merge = !!(top && top.nudge && top.layer === tf.layer && Date.now() - lastNudge < 900);
      commitFloat(merge); // a run of nudges is one undo step
      if (!merge) { const e = undoStack[undoStack.length - 1]; if (e) e.nudge = true; }
      lastNudge = Date.now();
    }

    function updateTfHandles() {
      if (!tf || tf.mode !== "transform") { tfEl.style.display = "none"; return; }
      tfEl.style.display = "block";
      tfEl.style.transform = `translate(${tf.cx}px, ${tf.cy}px) rotate(${tf.angle}rad)`;
      const hw = tf.w / 2, hh = tf.h / 2, off = 26 / view.s;
      const pos = { nw: [-hw, -hh], n: [0, -hh], ne: [hw, -hh], e: [hw, 0], se: [hw, hh], s: [0, hh], sw: [-hw, hh], w: [-hw, 0] };
      for (const el of tfEl.querySelectorAll(".tf-h")) {
        const [x, y] = pos[el.dataset.k];
        el.style.left = `${x}px`; el.style.top = `${y}px`;
      }
      tfBox.style.cssText = `left:${-hw}px;top:${-hh}px;width:${tf.w}px;height:${tf.h}px`;
      tfRot.style.cssText = `left:0px;top:${-hh - off}px`;
      tfLine.style.cssText = `left:0px;top:${-hh - off}px;height:${off}px`;
    }

    function tfHit(pt) {
      const ca = Math.cos(tf.angle), sa = Math.sin(tf.angle);
      const dx = pt.x - tf.cx, dy = pt.y - tf.cy;
      const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca; // into the object's own frame
      const r = 11 / view.s, hw = tf.w / 2, hh = tf.h / 2;
      const near = (x, y) => Math.abs(lx - x) <= r && Math.abs(ly - y) <= r;
      if (near(0, -hh - 26 / view.s)) return { kind: "rotate" };
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]]) {
        if (near(sx * hw, sy * hh)) return { kind: "scale", sx, sy };
      }
      if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return { kind: "move" };
      return null;
    }

    function tfDragMove(pt, shift) {
      const d = tf.drag;
      if (d.kind === "move") {
        tf.cx = d.cx0 + (pt.x - d.p0.x);
        tf.cy = d.cy0 + (pt.y - d.p0.y);
      } else if (d.kind === "rotate") {
        let a = Math.atan2(pt.y - tf.cy, pt.x - tf.cx) + Math.PI / 2;
        if (shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        tf.angle = a;
      } else {
        const ca = Math.cos(d.a0), sa = Math.sin(d.a0);
        const lp = { x: (pt.x - d.cx0) * ca + (pt.y - d.cy0) * sa, y: -(pt.x - d.cx0) * sa + (pt.y - d.cy0) * ca };
        const ax = -d.sx * d.w0 / 2, ay = -d.sy * d.h0 / 2; // the opposite corner or side stays put
        let w = d.w0, hh = d.h0;
        if (d.sx && d.sy && !shift) { // corners keep the proportions; Shift stretches freely
          const ux = d.sx * d.w0, uy = d.sy * d.h0;
          const f = Math.max(0.03, ((lp.x - ax) * ux + (lp.y - ay) * uy) / (ux * ux + uy * uy));
          w = d.w0 * f; hh = d.h0 * f;
        } else {
          if (d.sx) w = Math.max(4, d.sx * (lp.x - ax));
          if (d.sy) hh = Math.max(4, d.sy * (lp.y - ay));
        }
        const A = { x: d.cx0 + ax * ca - ay * sa, y: d.cy0 + ax * sa + ay * ca };
        const nax = -d.sx * w / 2, nay = -d.sy * hh / 2;
        tf.w = w; tf.h = hh;
        tf.cx = A.x - (nax * ca - nay * sa);
        tf.cy = A.y - (nax * sa + nay * ca);
      }
      drawFloat();
    }

    // ---- paint bucket ------------------------------------------------------------------------------------
    const fillSet = { tol: 28, all: true };
    try { Object.assign(fillSet, JSON.parse(localStorage.getItem("thumblab.fill") || "{}")); } catch (e) { /* defaults */ }
    const persistFill = () => { try { localStorage.setItem("thumblab.fill", JSON.stringify(fillSet)); } catch (e) { /* ignore */ } };

    function fillAt(pt) {
      if (tf) commitFloat();
      const L = layerForEdit(); if (!L) return;
      const x = Math.floor(pt.x), y = Math.floor(pt.y);
      if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
      const w = doc.w, hh = doc.h;
      const data = (fillSet.all ? flatten() : L.canvas).getContext("2d").getImageData(0, 0, w, hh).data;
      const si = (y * w + x) * 4;
      const sr = data[si], sg = data[si + 1], sb = data[si + 2], sa = data[si + 3];
      const tol = fillSet.tol * 2.55;
      const ok = (i) => Math.abs(data[i] - sr) <= tol && Math.abs(data[i + 1] - sg) <= tol && Math.abs(data[i + 2] - sb) <= tol && Math.abs(data[i + 3] - sa) <= tol;
      const mask = new Uint8Array(w * hh);
      const stack = [x, y];
      while (stack.length) {
        const cy = stack.pop(), cx = stack.pop();
        let lx = cx;
        while (lx >= 0 && !mask[cy * w + lx] && ok((cy * w + lx) * 4)) lx--;
        lx++;
        let up = false, down = false;
        for (let px = lx; px < w && !mask[cy * w + px] && ok((cy * w + px) * 4); px++) {
          mask[cy * w + px] = 1;
          if (cy > 0) {
            const m = !mask[(cy - 1) * w + px] && ok(((cy - 1) * w + px) * 4);
            if (m && !up) { stack.push(px, cy - 1); up = true; } else if (!m) up = false;
          }
          if (cy < hh - 1) {
            const m = !mask[(cy + 1) * w + px] && ok(((cy + 1) * w + px) * 4);
            if (m && !down) { stack.push(px, cy + 1); down = true; } else if (!m) down = false;
          }
        }
      }
      // one pixel of growth so anti-aliased line edges don't leave a pale halo
      const grown = new Uint8Array(mask);
      for (let yy = 0; yy < hh; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const i = yy * w + xx;
          if (!mask[i]) continue;
          if (xx > 0) grown[i - 1] = 1;
          if (xx < w - 1) grown[i + 1] = 1;
          if (yy > 0) grown[i - w] = 1;
          if (yy < hh - 1) grown[i + w] = 1;
        }
      }
      const rgbv = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16));
      const out = new ImageData(w, hh);
      for (let i = 0; i < grown.length; i++) {
        if (!grown[i]) continue;
        out.data[i * 4] = rgbv[0]; out.data[i * 4 + 1] = rgbv[1]; out.data[i * 4 + 2] = rgbv[2]; out.data[i * 4 + 3] = 255;
      }
      const tmp = TL.canvas(w, hh);
      tmp.getContext("2d").putImageData(out, 0, 0);
      const before = copyCanvas(L.canvas);
      L.ctx.save();
      if (sel) L.ctx.clip(selPath(), "evenodd");
      L.ctx.drawImage(tmp, 0, 0);
      L.ctx.restore();
      pushPixels(L, before); thumbFor(L); touch();
    }

    // ---- pointer wiring -----------------------------------------------------------------------------------
    function effectiveTool(e) {
      if (e.pointerType === "pen" && (e.buttons & 32)) return "eraser"; // pen's eraser end
      return tool;
    }

    function startRotate(e) {
      const r = viewport.getBoundingClientRect();
      const ccx = r.left + view.cx, ccy = r.top + view.cy;
      rotating = { ccx, ccy, a0: view.angle, start: Math.atan2(e.clientY - ccy, e.clientX - ccx) };
      view.touched = true;
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function updateSelecting(pt) {
      const s = selecting;
      if (s.kind === "select") {
        const x0 = clamp(Math.min(s.start.x, pt.x), 0, doc.w), x1 = clamp(Math.max(s.start.x, pt.x), 0, doc.w);
        const y0 = clamp(Math.min(s.start.y, pt.y), 0, doc.h), y1 = clamp(Math.max(s.start.y, pt.y), 0, doc.h);
        s.poly = rectPoly(x0, y0, x1 - x0, y1 - y0);
        setSel({ polys: [s.poly], invert: false });
      } else {
        const last = s.pts[s.pts.length - 1];
        if (Math.hypot(pt.x - last[0], pt.y - last[1]) > 1.5) s.pts.push([pt.x, pt.y]);
        setSel({ polys: [s.pts], invert: false });
      }
    }

    function finishSelecting() {
      const s = selecting;
      selecting = null;
      if (s.kind === "select") {
        if (!s.poly || (s.poly[2][0] - s.poly[0][0] < 2 && s.poly[2][1] - s.poly[0][1] < 2)) setSel(null); // a plain click deselects
      } else if (s.pts.length < 3) setSel(null);
    }

    viewport.style.touchAction = "none";
    viewport.addEventListener("pointerdown", (e) => {
      viewport.focus({ preventScroll: true });
      if (e.button === 1 || spaceDown) {
        pan = { x: e.clientX, y: e.clientY, cx0: view.cx, cy0: view.cy };
        view.touched = true;
        viewport.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.button !== 0 && e.pointerType === "mouse") return;
      if (tool === "rotate") { startRotate(e); return; }
      const pt = pointerDoc(e);
      if (tf && tf.mode === "transform") {
        const hit = tfHit(pt);
        if (hit) {
          tf.drag = { ...hit, p0: pt, cx0: tf.cx, cy0: tf.cy, w0: tf.w, h0: tf.h, a0: tf.angle };
          viewport.setPointerCapture(e.pointerId);
        }
        e.preventDefault();
        return;
      }
      const t = e.altKey ? "picker" : effectiveTool(e);
      if (t === "picker") { pickColor(e); viewport.setPointerCapture(e.pointerId); stroke = { picker: true }; return; }
      if (t === "move") {
        if (!beginFloat("move")) return;
        tf.drag = { kind: "move", p0: pt, cx0: tf.cx, cy0: tf.cy };
        viewport.setPointerCapture(e.pointerId);
        return;
      }
      if (t === "fill") { fillAt(pt); return; }
      if (t === "select" || t === "lasso") {
        if (tf) commitFloat();
        selecting = { kind: t, start: pt, pts: [[pt.x, pt.y]], poly: null };
        viewport.setPointerCapture(e.pointerId);
        return;
      }
      if (!PAINT_TOOLS.includes(t) || !beginStroke(e, t)) return;
      viewport.setPointerCapture(e.pointerId);
      addSample(pt, pressureOf(e), true);
      renderDebug(e);
      e.preventDefault();
    });

    viewport.addEventListener("pointermove", (e) => {
      moveCursor(e);
      renderDebug(e);
      if (pan) {
        view.cx = pan.cx0 + (e.clientX - pan.x);
        view.cy = pan.cy0 + (e.clientY - pan.y);
        applyView();
        return;
      }
      if (rotating) {
        let a = rotating.a0 + (Math.atan2(e.clientY - rotating.ccy, e.clientX - rotating.ccx) - rotating.start);
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12); // 15 degree steps
        view.angle = a;
        applyView();
        return;
      }
      if (tf && tf.drag) { tfDragMove(pointerDoc(e), e.shiftKey); return; }
      if (selecting) { updateSelecting(pointerDoc(e)); return; }
      if (stroke && stroke.picker) { pickColor(e); return; }
      if (!stroke) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const list = events.length ? events : [e];
      for (const ev of list) addSample(pointerDoc(ev), pressureOf(ev), true);
    });

    const release = () => {
      if (pan) { pan = null; return; }
      if (rotating) { rotating = null; return; }
      if (tf && tf.drag) {
        tf.drag = null;
        if (tf.mode === "move") commitFloat(); // a plain move is done when you let go; Ctrl+T stays open
        return;
      }
      if (selecting) { finishSelecting(); return; }
      if (stroke && stroke.picker) { stroke = null; return; }
      endStroke();
    };
    viewport.addEventListener("pointerup", release);
    viewport.addEventListener("pointercancel", release);
    viewport.addEventListener("pointerleave", () => { cursor.style.display = "none"; });
    viewport.addEventListener("pointerenter", () => { cursor.style.display = ""; });

    viewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      view.touched = true;
      setZoomAt(e.clientX - r.left, e.clientY - r.top, view.s * Math.pow(1.0015, -e.deltaY));
    }, { passive: false });

    const CURSORS = { picker: "crosshair", fill: "crosshair", select: "crosshair", lasso: "crosshair", move: "move", rotate: "grab" };
    function moveCursor(e) {
      const def = TOOL_DEFS[tool];
      if (!PAINT_TOOLS.includes(tool)) { cursor.style.display = "none"; viewport.style.cursor = CURSORS[tool] || ""; return; }
      viewport.style.cursor = "none";
      const r = viewport.getBoundingClientRect();
      const d = Math.max(4, settings[tool].size * view.s);
      cursor.style.cssText = `display:block;width:${d}px;height:${d}px;left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`;
      cursor.classList.toggle("erase", def.erase);
    }

    function pickColor(e) {
      const pt = pointerDoc(e);
      const x = Math.floor(pt.x), y = Math.floor(pt.y);
      if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
      const d = flatten().getContext("2d").getImageData(x, y, 1, 1).data;
      setColor("#" + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, "0")).join(""));
    }

    // ---- keyboard ----------------------------------------------------------------------------------------
    let debugOn = false;
    let holdPrev = null; // the tool to go back to when R (rotate view) is released

    const SHORTCUTS = [
      ["P  B  E  K", "Pen, pressure brush, eraser, pressure eraser"],
      ["F", "Paint bucket"],
      ["I  or  Alt+click", "Eyedropper"],
      ["V", "Move the selection (or the layer when nothing is selected)"],
      ["M  /  L", "Rectangle select  /  lasso select"],
      ["Hold R, drag", "Rotate the view (Shift snaps to 15°)"],
      ["Space + drag", "Pan"],
      ["Wheel", "Zoom"],
      ["Ctrl+0  /  Ctrl+1", "Fit and straighten the view  /  100%"],
      ["Ctrl+A", "Select everything"],
      ["Ctrl+D  or  Esc", "Deselect"],
      ["Ctrl+I", "Invert the selection"],
      ["Delete", "Clear the selection"],
      ["Alt+Backspace", "Fill the selection with the colour"],
      ["Ctrl+Backspace", "Fill the selection with the background colour"],
      ["Ctrl+C  /  X  /  V", "Copy, cut, paste"],
      ["Ctrl+Shift+C", "Copy the whole picture"],
      ["Ctrl+T", "Transform: drag the handles, Enter to apply, Esc to cancel"],
      ["Arrow keys", "Nudge 1px (Shift: 10px)"],
      ["X", "Swap colour and background colour"],
      ["[   ]", "Brush size"],
      ["H", "Mirror the view"],
      ["G", "Guides"],
      ["Ctrl+Z  /  Ctrl+Y", "Undo / redo"],
      ["Ctrl+Shift+D", "Pen debug readout"],
    ];

    function showShortcuts() {
      TL.modal({
        title: "Shortcuts",
        body: h("div.keylist", SHORTCUTS.map(([k, d]) => h("div.keyrow", h("kbd", k), h("span", d)))),
        buttons: [{ label: "Close", value: null }],
      });
    }

    const onKeyDown = (e) => {
      if (destroyed) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) && e.key !== "Escape") return;
      if (document.querySelector("#modal-root .overlay")) return;
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.code === "Space") { spaceDown = true; viewport.style.cursor = "grab"; e.preventDefault(); return; }
      if (ctrl) {
        if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if (k === "y") { e.preventDefault(); redo(); return; }
        if (e.shiftKey && k === "d") { debugOn = !debugOn; renderStatus(); return; }
        if (k === "0") { e.preventDefault(); fitView(); return; }
        if (k === "1") { e.preventDefault(); setZoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1); return; }
        if (k === "a") { e.preventDefault(); selectAll(); return; }
        if (k === "d") { e.preventDefault(); deselect(); return; }
        if (k === "i") { e.preventDefault(); invertSelection(); return; }
        if (k === "t") { e.preventDefault(); startTransform(); return; }
        if (k === "c") { e.preventDefault(); if (e.shiftKey) { if (tf) commitFloat(); pngBytes().then((b) => window.host.copyImage(b)).then(() => TL.toast("Copied the whole picture")); } else copySelection(false); return; }
        if (k === "x") { e.preventDefault(); copySelection(true); return; }
        if (k === "v") { e.preventDefault(); pasteLayer(); return; }
        if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); clearSelectionPixels(color2); return; }
        return;
      }
      if (e.altKey) {
        if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); clearSelectionPixels(color); }
        return;
      }
      if (e.key === "Escape") {
        if (tf) cancelFloat(); else if (sel) setSel(null);
        return;
      }
      if (e.key === "Enter") { if (tf) { e.preventDefault(); commitFloat(); } return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); clearSelectionPixels(); return; }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudge(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
        return;
      }
      if (k === "r") { e.preventDefault(); if (!e.repeat && tool !== "rotate") { holdPrev = tool; setTool("rotate"); } return; }
      if (k === "x") { swapColors(); return; }
      if (k === "[") { adjustSize(-1); return; }
      if (k === "]") { adjustSize(1); return; }
      if (k === "h") { view.mirror = !view.mirror; applyView(); renderTop(); return; }
      if (k === "g") { view.guides = !view.guides; syncStack(); renderTop(); return; }
      if (e.key === "?") { showShortcuts(); return; }
      const hit = Object.entries(TOOL_DEFS).find(([, d]) => d.key === k);
      if (hit) setTool(hit[0]);
    };
    const onKeyUp = (e) => {
      if (e.code === "Space") { spaceDown = false; viewport.style.cursor = ""; }
      if (e.key.toLowerCase() === "r" && holdPrev) { const back = holdPrev; holdPrev = null; setTool(back); } // R is a hold: let go and you're back
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ---- layers ------------------------------------------------------------------------------------
    function thumbFor(layer) {
      if (!layer.thumb) return;
      const c = layer.thumb;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(layer.canvas, 0, 0, c.width, c.height);
    }

    function addLayer(name, canvas, at) {
      if (tf) commitFloat();
      if (doc.layers.length >= MAX_LAYERS) { TL.toast(`Up to ${MAX_LAYERS} layers.`); return null; }
      const layer = makeLayer(name || `Layer ${doc.layers.length + 1}`, canvas);
      const index = at === undefined ? doc.active + 1 : at;
      doc.layers.splice(index, 0, layer);
      doc.active = index;
      syncStack();
      return layer;
    }

    function removeLayer(i) {
      if (tf) commitFloat();
      const layer = doc.layers[i];
      const prevActive = doc.active;
      doc.layers.splice(i, 1);
      doc.active = clamp(prevActive >= i ? prevActive - 1 : prevActive, 0, doc.layers.length - 1);
      syncStack();
      return layer;
    }

    function renderLayers() {
      TL.clear(layersPanel);
      const active = activeLayer();
      const registerAdd = (layer) => {
        const at = doc.layers.indexOf(layer);
        pushOps(() => { removeLayer(doc.layers.indexOf(layer)); renderLayers(); }, () => { doc.layers.splice(at, 0, layer); doc.active = at; syncStack(); renderLayers(); });
      };
      layersPanel.append(h("div.sk-sect-head", h("strong", "Layers"),
        h("span.spacer"),
        TL.iconBtn("plus", "New layer", () => {
          const layer = addLayer(); if (!layer) return;
          registerAdd(layer); renderLayers(); touch();
        }, { class: "small" }),
        TL.iconBtn("copy", "Duplicate layer", () => {
          const src = activeLayer();
          const layer = addLayer(`${src.name} copy`, copyCanvas(src.canvas)); if (!layer) return;
          layer.opacity = src.opacity;
          registerAdd(layer); syncStack(); renderLayers(); touch();
        }, { class: "small" }),
        TL.iconBtn("up", "Move layer up", () => reorder(1), { class: "small" }),
        TL.iconBtn("down", "Move layer down", () => reorder(-1), { class: "small" }),
        TL.iconBtn("trash", "Delete layer", () => {
          if (doc.layers.length < 2) { TL.toast("A sketch needs at least one layer."); return; }
          const at = doc.active;
          const layer = removeLayer(at);
          pushOps(() => { doc.layers.splice(at, 0, layer); doc.active = at; syncStack(); renderLayers(); }, () => { removeLayer(doc.layers.indexOf(layer)); renderLayers(); });
          renderLayers(); touch();
        }, { class: "small danger" })));

      const list = h("div.sk-layer-list");
      for (let i = doc.layers.length - 1; i >= 0; i--) {
        const l = doc.layers[i];
        const th = TL.canvas(64, Math.round(64 * doc.h / doc.w));
        l.thumb = th;
        thumbFor(l);
        list.append(h("div.sk-layer-row", {
          class: i === doc.active ? "active" : "",
          onclick: () => { if (tf) commitFloat(); doc.active = i; syncStack(); renderLayers(); },
        },
          TL.iconBtn(l.visible ? "eye" : "eyeOff", l.visible ? "Hide layer" : "Show layer", (e) => { e.stopPropagation(); l.visible = !l.visible; syncStack(); renderLayers(); touch(); }, { class: `small ${l.visible ? "" : "dim"}` }),
          h("div.sk-layer-thumb", th),
          h("span.sk-layer-name", {
            title: "Double-click to rename",
            ondblclick: async (e) => { e.stopPropagation(); const n = await TL.prompt("Layer name", l.name); if (n) { l.name = n; renderLayers(); touch(); } },
          }, l.name)));
      }
      layersPanel.append(list);
      layersPanel.append(h("label.sk-field", h("span.sk-field-top", "Layer opacity", h("span.val", `${Math.round(active.opacity * 100)}%`)),
        h("input", {
          type: "range", min: "0", max: "100", value: String(Math.round(active.opacity * 100)),
          oninput: (e) => { active.opacity = e.target.value / 100; active.el.style.opacity = active.visible ? String(active.opacity) : "0"; TL.$(".val", e.target.closest("label")).textContent = `${e.target.value}%`; },
          onchange: () => touch(),
        })));
      layersPanel.append(h("div.sk-sect-head", h("strong", "Add picture")),
        h("div.row.wrap",
          TL.iconBtn("library", "From a library", openLibraryPicker, { class: "solid" }),
          TL.iconBtn("imagePlus", "From an image file", pickImageFile, { class: "solid" }),
          TL.iconBtn("paste", "From the clipboard (Ctrl+V)", pasteLayer, { class: "solid" }),
          h("span.spacer"),
          TL.iconBtn("minus", "Shrink the layer's picture", () => scaleLayer(1 / 1.1), { class: "solid" }),
          TL.iconBtn("plus", "Enlarge the layer's picture", () => scaleLayer(1.1), { class: "solid" })));
    }

    function reorder(dir) {
      if (tf) commitFloat();
      const i = doc.active, j = i + dir;
      if (j < 0 || j >= doc.layers.length) return;
      const swap = () => { const [l] = doc.layers.splice(i, 1); doc.layers.splice(j, 0, l); doc.active = j; syncStack(); renderLayers(); };
      const unswap = () => { const [l] = doc.layers.splice(j, 1); doc.layers.splice(i, 0, l); doc.active = i; syncStack(); renderLayers(); };
      swap();
      pushOps(unswap, swap);
      touch();
    }

    function scaleLayer(f) {
      if (tf) commitFloat();
      const layer = activeLayer();
      const before = copyCanvas(layer.canvas);
      layer.ctx.clearRect(0, 0, doc.w, doc.h);
      layer.ctx.imageSmoothingQuality = "high";
      layer.ctx.save();
      layer.ctx.translate(doc.w / 2, doc.h / 2);
      layer.ctx.scale(f, f);
      layer.ctx.drawImage(before, -doc.w / 2, -doc.h / 2);
      layer.ctx.restore();
      pushPixels(layer, before);
      thumbFor(layer); touch();
    }

    /** Draws an image onto a new layer, fitted to ~70% of the canvas and centred. */
    function insertImage(img, name) {
      const layer = addLayer(name || "Image");
      if (!layer) return;
      const s = Math.min(1, (doc.w * 0.7) / img.width, (doc.h * 0.7) / img.height);
      const w = img.width * s, hh = img.height * s;
      layer.ctx.imageSmoothingQuality = "high";
      layer.ctx.drawImage(img, (doc.w - w) / 2, (doc.h - hh) / 2, w, hh);
      const at = doc.layers.indexOf(layer);
      pushOps(() => { removeLayer(doc.layers.indexOf(layer)); renderLayers(); }, () => { doc.layers.splice(at, 0, layer); doc.active = at; syncStack(); renderLayers(); });
      setTool("move");
      renderLayers(); touch();
    }

    async function pickImageFile() {
      const [p] = await window.host.pickFiles({ title: "Add an image as a layer", images: true });
      if (!p) return;
      try {
        const canvas = await TL.previewToCanvas(await window.host.preview(p));
        insertImage(canvas, TL.baseName(p));
      } catch (e) { TL.toast(e.message, "bad"); }
    }

    async function openLibraryPicker() {
      const sources = TL.librarySources(project);
      let closeFn;
      const browser = TL.libraryBrowser(sources, {
        onPick: async (item) => {
          insertImage(await TL.loadBitmap(item.file), item.name);
          closeFn && closeFn();
        },
      });
      const p = TL.modal({ title: "Pick from a library", body: browser, wide: true, buttons: [{ label: "Close", value: null }] });
      closeFn = () => TL.$("#modal-root .modal-head .ib") && TL.$("#modal-root .modal-head .ib").click();
      await p;
    }

    viewport.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); });
    viewport.addEventListener("drop", async (e) => {
      e.preventDefault();
      for (const f of e.dataTransfer.files) {
        const p = window.host.pathForFile(f);
        if (!p) continue;
        try { insertImage(await TL.previewToCanvas(await window.host.preview(p)), TL.baseName(p)); } catch (err) { TL.toast(err.message, "bad"); }
      }
    });

    // ---- tool + option panels ----------------------------------------------------------------------
    function setTool(t) {
      if (tf) commitFloat();
      tool = t;
      cursor.style.display = "none";
      renderTools(); renderOptions();
    }

    function setColor(c) {
      color = c;
      localStorage.setItem("thumblab.color", c);
      recent = [c, ...recent.filter((x) => x !== c)].slice(0, 8);
      renderTools();
    }

    function setColor2(c) {
      color2 = c;
      localStorage.setItem("thumblab.color2", c);
      renderTools();
    }

    function swapColors() {
      const a = color;
      color = color2; color2 = a;
      localStorage.setItem("thumblab.color", color);
      localStorage.setItem("thumblab.color2", color2);
      renderTools();
    }

    function adjustSize(dir) {
      if (!PAINT_TOOLS.includes(tool)) return;
      const s = settings[tool];
      const step = s.size < 20 ? 2 : s.size < 80 ? 6 : 16;
      s.size = clamp(s.size + dir * step, 1, 400);
      persistTools(); renderOptions();
    }

    function persistTools() {
      try { localStorage.setItem("thumblab.tools", JSON.stringify(settings)); localStorage.setItem("thumblab.feel", String(feel)); } catch (e) { /* ignore */ }
    }

    let advOpen = false;

    function renderTools() {
      TL.clear(toolsPanel);
      toolsPanel.append(
        h("div.sk-tool-grid", Object.entries(TOOL_DEFS).map(([key, def]) => h("button.sk-tool", {
          class: tool === key ? "on" : "", "data-tip": `${def.label} (${def.key.toUpperCase()}): ${def.tip}`, "aria-label": def.label,
          onclick: () => setTool(key),
        }, TL.icon(def.glyph, 22)))),
        h("div.sk-color",
          h("div.sk-colorwell",
            h("input.cw-bg", { type: "color", value: color2, title: "Background colour (X swaps)", oninput: (e) => setColor2(e.target.value) }),
            h("input.cw-fg", { type: "color", value: color, title: "Colour", oninput: (e) => setColor(e.target.value) }),
            TL.iconBtn("swap", "Swap the two colours (X)", swapColors, { class: "small cw-swap" })),
          h("div.sk-swatches", [...recent, ...SWATCHES.filter((s) => !recent.includes(s))].slice(0, 12).map((s) =>
            h("button.sk-swatch", { style: { background: s }, class: s === color ? "on" : "", "aria-label": s, "data-tip": s, onclick: () => setColor(s) })))));
    }

    function slider(label, get, set, min, max, step, fmt) {
      const out = h("span.val", fmt ? fmt(get()) : String(get()));
      return h("label.sk-field", h("span.sk-field-top", label, out),
        h("input", {
          type: "range", min, max, step: step || 1, value: String(get()),
          oninput: (e) => { const v = parseFloat(e.target.value); set(v); out.textContent = fmt ? fmt(v) : String(v); persistTools(); },
        }));
    }

    function renderOptions() {
      TL.clear(optionsPanel);
      const def = TOOL_DEFS[tool];
      if (PAINT_TOOLS.includes(tool)) {
        const s = settings[tool];
        const pct = (v) => `${Math.round(v * 100)}%`;
        const more = h("details.more", { open: advOpen, ontoggle: () => { advOpen = more.open; } },
          h("summary", "Pressure and feel"),
          ...[
            tool === "pen" || tool === "eraser" ? null : slider("Softness", () => 1 - s.hardness, (v) => { s.hardness = 1 - v; }, 0, 1, 0.05, pct),
            slider("Pressure changes size", () => s.pSize, (v) => { s.pSize = v; }, 0, 1, 0.05, pct),
            slider("Pressure changes opacity", () => s.pOpacity, (v) => { s.pOpacity = v; }, 0, 1, 0.05, pct),
            slider("Smoothing", () => s.smooth, (v) => { s.smooth = v; }, 0, 1, 0.05, pct),
            h("label.sk-field", h("span.sk-field-top", "Pressure curve", h("span.val", "soft to firm")),
              h("input", { type: "range", min: "0", max: "100", value: String(feel), oninput: (e) => { feel = parseFloat(e.target.value); persistTools(); } })),
            h("div.row", TL.iconBtn("refresh", "Reset this tool to its defaults", () => { Object.assign(s, TOOL_DEFS[tool].defaults); persistTools(); renderOptions(); }, { class: "small", label: "Reset" })),
          ].filter(Boolean));
        optionsPanel.append(
          h("div.sk-sect-head", h("strong", def.label)),
          slider("Size", () => s.size, (v) => { s.size = v; }, 1, 400, 1, (v) => `${v}px`),
          slider("Opacity", () => s.opacity, (v) => { s.opacity = v; }, 0.05, 1, 0.05, pct),
          more);
      } else if (tool === "fill") {
        optionsPanel.append(
          h("div.sk-sect-head", h("strong", def.label)),
          slider("Tolerance", () => fillSet.tol, (v) => { fillSet.tol = v; persistFill(); }, 0, 100, 1, (v) => `${v}%`),
          h("label.check.inline", h("input", { type: "checkbox", checked: !!fillSet.all, onchange: (e) => { fillSet.all = e.target.checked; persistFill(); } }),
            h("span.small", "Look at every layer")),
          h("p.muted.small", "On: fills the area you see, even when the lines are on another layer."));
      } else {
        optionsPanel.append(h("div.sk-sect-head", h("strong", def.label)), h("p.muted.small", def.tip));
      }
      optionsPanel.append(
        h("div.sk-sect-head", h("strong", "Selection")),
        h("div.row.wrap",
          TL.iconBtn("select", "Select everything (Ctrl+A)", selectAll, { class: "solid" }),
          TL.iconBtn("x", "Deselect (Ctrl+D)", deselect, { class: "solid" }),
          TL.iconBtn("contrast", "Invert the selection (Ctrl+I)", invertSelection, { class: "solid" }),
          TL.iconBtn("transform", "Transform: scale and rotate (Ctrl+T)", startTransform, { class: "solid" }),
          TL.iconBtn("trash", "Clear the selected pixels (Delete)", () => clearSelectionPixels(), { class: "solid danger" })));
    }

    // ---- status ---------------------------------------------------------------------------------------
    let debugText = "";
    function renderDebug(e) {
      if (debugOn) debugText = `${e.pointerType} · pressure ${e.pressure.toFixed(2)} · buttons ${e.buttons} · tilt ${e.tiltX ?? 0}/${e.tiltY ?? 0}`;
      else debugText = "";
      renderStatus();
    }
    function renderStatus(bad) {
const b = selBounds();
      const turn = Math.abs(view.angle) > 0.001 ? ` · ${Math.round(((view.angle * 180 / Math.PI) % 360 + 360) % 360)}°` : "";
      status.textContent = `${doc.w}×${doc.h} · ${Math.round(view.s * 100)}%${turn}${b ? ` · selection ${b.w}×${b.h}` : ""} · ${lastSaved}${debugText ? " · " + debugText : ""}`;
      status.classList.toggle("bad", !!bad);
    }

    // ---- handoff -------------------------------------------------------------------------------------------
    const nameSafe = () => (variant.name || "sketch").replace(/[\\/:*?"<>|]/g, "_");

    async function pngBytes() { return TL.canvasToBytes(flatten(), "image/png"); }

    async function savePsdAs() {
      await flush();
      const bytes = await window.host.readFile(variant.source);
      const p = await window.host.saveAs(bytes, nameSafe(), "psd");
      if (p) TL.toast(`Saved ${TL.fileName(p)}`);
    }

    async function handoffFolder() {
      let dir = TL.state.settings.handoffFolder;
      if (!dir) {
        dir = await window.host.pickFolder("Choose your handoff folder (iCloud Drive / Dropbox works well for iPad)");
        if (!dir) return;
        TL.state.settings.handoffFolder = dir; TL.saveSettings();
      }
      await flush();
      const res = await window.host.sendToFolder({ dir, base: nameSafe(), png: await pngBytes(), psd: await window.host.readFile(variant.source) });
      TL.toast(`Sent ${res} to ${dir}`);
    }

    function handoffMenu(anchor) {
      const items = [
        ["external", "Open in its default app (layered PSD)", async () => { await flush(); const err = await window.host.openPath(variant.source); if (err) TL.toast(err, "bad"); }],
        ["layers", "Save PSD as… (keeps layers)", savePsdAs],
        ["image", "Save PNG as…", async () => { const p = await window.host.saveAs(await pngBytes(), nameSafe(), "png"); if (p) TL.toast(`Saved ${TL.fileName(p)}`); }],
        ["copy", "Copy flattened image", async () => { await window.host.copyImage(await pngBytes()); TL.toast("Copied. Paste it into any app."); }],
        ["send", "Send PSD + PNG to handoff folder", handoffFolder],
        ["folderOpen", "Change handoff folder…", async () => { const d = await window.host.pickFolder("Choose your handoff folder"); if (d) { TL.state.settings.handoffFolder = d; TL.saveSettings(); TL.toast("Handoff folder set"); } }],
        ["folder", "Show the PSD in its folder", () => window.host.reveal(variant.source)],
      ];
      const menu = h("div.popmenu", items.map(([icon, label, fn]) => h("button", { onclick: async () => { menu.remove(); try { await fn(); } catch (e) { TL.toast(e.message, "bad"); } } }, TL.icon(icon, 16), label)));
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.right = `${window.innerWidth - r.right}px`;
      document.body.append(menu);
      const away = (e) => { if (!menu.contains(e.target)) { menu.remove(); window.removeEventListener("pointerdown", away, true); } };
      setTimeout(() => window.addEventListener("pointerdown", away, true), 0);
    }

    /** Drag-out chip: prepares the file on pointerdown so the OS drag can start immediately. */
    function dragChip(label, ext) {
      let file = null;
      const chip = h("div.drag-chip", { draggable: true, "data-tip": `Drag the ${ext.toUpperCase()} into Photoshop, CSP or a folder` }, TL.icon(ext === "png" ? "image" : "layers", 15), label);
      chip.addEventListener("pointerdown", async () => {
        file = null;
        if (ext === "png") file = await window.host.writeTemp(`${nameSafe()}.png`, await pngBytes());
        else { await flush(); file = variant.source; }
      });
      chip.addEventListener("dragstart", (e) => { e.preventDefault(); if (file) window.host.startDrag(file); else TL.toast("Hold the mouse a moment, then drag.", ""); });
      return chip;
    }

    // ---- top bar -------------------------------------------------------------------------------------------------
    const topbar = h("div.sk-top");
    function renderTop() {
      TL.clear(topbar);
      const sendBtn = TL.iconBtn("send", "Send this sketch to another app", (e) => handoffMenu(e.currentTarget), { kind: "primary", label: "Send" });
      topbar.append(
        TL.iconBtn("back", "Back to the project", async () => { await close(); }),
        h("span.sk-title", h("span.label-pill", variant.label), variant.name),
        TL.iconBtn("undo", "Undo (Ctrl+Z)", undo),
        TL.iconBtn("redo", "Redo (Ctrl+Y)", redo),
        h("span.sk-sep"),
        TL.iconBtn("fit", "Fit to window and straighten (Ctrl+0)", fitView),
        TL.iconBtn("zoom100", "100% (Ctrl+1)", () => setZoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1)),
        TL.iconBtn("mirror", "Mirror the view to spot mistakes (H)", () => { view.mirror = !view.mirror; applyView(); renderTop(); }, { on: view.mirror, toggle: true }),
        TL.iconBtn("grid", "Guides: thirds, safe margin, duration badge zone (G)", () => { view.guides = !view.guides; syncStack(); renderTop(); }, { on: view.guides, toggle: true }),
        TL.iconBtn("keys", "Keyboard shortcuts (?)", showShortcuts),
        h("span.sk-sep"),
        TL.fxBar(),
        h("span.spacer"),
        dragChip("PNG", "png"), dragChip("PSD", "psd"),
        sendBtn);
    }

    async function close() {
      await flush();
      destroy();
      nav.closeSketch();
    }

    // ---- external changes ---------------------------------------------------------------------------------------
    const offWatch = window.host.onFileChanged(async (msg) => {
      if (destroyed || msg.key !== `${project.id}:${variant.id}`) return;
      const reload = await TL.confirm("This sketch was saved by another app. Reload its layers here? (Keep yours to ignore the change; your version is saved again on your next stroke.)", "Reload from file");
      if (!reload) return;
      destroy(); nav.closeSketch(variant);
    });

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      offWatch();
      ro.disconnect();
    }

    const onResize = () => {};
    const ro = new ResizeObserver(() => { if (!view.touched && viewport.clientWidth) fitView(); });

    // ---- assemble ---------------------------------------------------------------------------------------------------
    renderTop();
    renderTools();
    renderOptions();
    renderLayers();
    syncStack();
    lastSaved = "Saved";
    renderStatus();

    const left = h("aside.sk-side.left", toolsPanel, optionsPanel);
    const right = h("aside.sk-side.right", layersPanel);
    const center = h("div.sk-center", viewport, status);
    root.append(topbar, h("div.sk-body", left, center, right));
    ro.observe(viewport);
    window.addEventListener("resize", onResize);

    return { el: root, close, destroy, flush };
  };
})(window.TL);
