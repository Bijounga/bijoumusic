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
    pen: { label: "Pen", glyph: "✒", key: "p", erase: false, tip: "Crisp line. Pressure changes the width.",
      defaults: { size: 8, opacity: 1, hardness: 1, pSize: 0.7, pOpacity: 0, smooth: 0.35 } },
    brush: { label: "Pressure brush", glyph: "🖌", key: "b", erase: false, tip: "Soft paint. Pressure changes both width and how much paint lands.",
      defaults: { size: 60, opacity: 1, hardness: 0.45, pSize: 0.5, pOpacity: 0.9, smooth: 0.2 } },
    eraser: { label: "Eraser", glyph: "⌫", key: "e", erase: true, tip: "Hard eraser. Pressure changes the width.",
      defaults: { size: 30, opacity: 1, hardness: 1, pSize: 0.5, pOpacity: 0, smooth: 0.2 } },
    softEraser: { label: "Pressure eraser", glyph: "◌", key: "k", erase: true, tip: "Soft eraser. Pressure changes both width and how much it removes.",
      defaults: { size: 70, opacity: 1, hardness: 0.4, pSize: 0.5, pOpacity: 0.9, smooth: 0.2 } },
    picker: { label: "Eyedropper", glyph: "💧", key: "i", tip: "Pick a colour from the picture (or Alt+click with any tool)." },
    move: { label: "Move layer", glyph: "✥", key: "v", tip: "Drag to move the active layer." },
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
    const view = { x: 0, y: 0, s: 1, mirror: false, guides: false };
    let stroke = null, pan = null, moving = null;
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
    const cursor = h("div.sk-cursor");
    const status = h("div.sk-status");
    const layersPanel = h("div.sk-layers");
    const toolsPanel = h("div.sk-tools");
    const optionsPanel = h("div.sk-options");

    stage.append(fxLayer, guides);
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
      stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
      mirror.style.transform = view.mirror ? "scaleX(-1)" : "";
      guides.style.transform = view.mirror ? "scaleX(-1)" : "";
      renderStatus();
    }

    function fitView() {
      const vw = viewport.clientWidth, vh = viewport.clientHeight;
      if (!vw || !vh) return;
      view.s = Math.min((vw - 48) / doc.w, (vh - 48) / doc.h);
      view.x = (vw - doc.w * view.s) / 2;
      view.y = (vh - doc.h * view.s) / 2;
      applyView();
    }

    function setZoomAt(cx, cy, newS) {
      newS = clamp(newS, 0.1, 8);
      const k = newS / view.s;
      view.x = cx - (cx - view.x) * k;
      view.y = cy - (cy - view.y) * k;
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
      const e = undoStack.pop();
      if (!e) return;
      if (e.kind === "pixels") swapPixels(e); else e.undo();
      redoStack.push(e);
      renderLayers(); touch();
    }
    function redo() {
      if (stroke) return;
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
      const r = stage.getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * doc.w;
      const y = ((e.clientY - r.top) / r.height) * doc.h;
      if (view.mirror) x = doc.w - x;
      return { x, y };
    }

    function pressureOf(e) {
      if (e.pointerType === "mouse") return 0.7;
      // Some pens report 0 on the very first event; treat that as light, not absent.
      return e.pressure > 0 ? e.pressure : 0.05;
    }

    function activeLayer() { return doc.layers[doc.active]; }

    function beginStroke(e, toolKey) {
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

    // ---- pointer wiring ----------------------------------------------------------------------
    function effectiveTool(e) {
      if (e.pointerType === "pen" && (e.buttons & 32)) return "eraser"; // pen's eraser end
      return tool;
    }

    viewport.style.touchAction = "none";
    viewport.addEventListener("pointerdown", (e) => {
      viewport.focus({ preventScroll: true });
      if (e.button === 1 || spaceDown) {
        pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        viewport.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const t = e.altKey ? "picker" : effectiveTool(e);
      if (t === "picker") { pickColor(e); viewport.setPointerCapture(e.pointerId); stroke = { picker: true }; return; }
      if (t === "move") {
        const pt = pointerDoc(e);
        moving = { x: pt.x, y: pt.y, dx: 0, dy: 0, layer: activeLayer(), before: copyCanvas(activeLayer().canvas) };
        viewport.setPointerCapture(e.pointerId);
        return;
      }
      if (!PAINT_TOOLS.includes(t) || !beginStroke(e, t)) return;
      viewport.setPointerCapture(e.pointerId);
      addSample(pointerDoc(e), pressureOf(e), true);
      renderDebug(e);
      e.preventDefault();
    });

    viewport.addEventListener("pointermove", (e) => {
      moveCursor(e);
      renderDebug(e);
      if (pan) {
        view.x = pan.vx + (e.clientX - pan.x);
        view.y = pan.vy + (e.clientY - pan.y);
        applyView();
        return;
      }
      if (moving) {
        const pt = pointerDoc(e);
        moving.dx = pt.x - moving.x; moving.dy = pt.y - moving.y;
        moving.layer.el.style.transform = `translate(${moving.dx * (view.mirror ? -1 : 1)}px, ${moving.dy}px)`;
        return;
      }
      if (stroke && stroke.picker) { pickColor(e); return; }
      if (!stroke) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const list = events.length ? events : [e];
      for (const ev of list) addSample(pointerDoc(ev), pressureOf(ev), true);
    });

    const release = (e) => {
      if (pan) { pan = null; return; }
      if (moving) {
        const m = moving; moving = null;
        m.layer.el.style.transform = "";
        const dx = Math.round(m.dx), dy = Math.round(m.dy);
        if (dx || dy) {
          m.layer.ctx.clearRect(0, 0, doc.w, doc.h);
          m.layer.ctx.drawImage(m.before, dx, dy);
          pushPixels(m.layer, m.before);
          thumbFor(m.layer); touch();
        }
        return;
      }
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
      setZoomAt(e.clientX - r.left, e.clientY - r.top, view.s * Math.pow(1.0015, -e.deltaY));
    }, { passive: false });

    function moveCursor(e) {
      const def = TOOL_DEFS[tool];
      if (!PAINT_TOOLS.includes(tool)) { cursor.style.display = "none"; viewport.style.cursor = tool === "picker" ? "crosshair" : tool === "move" ? "move" : ""; return; }
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

    // ---- keyboard ----------------------------------------------------------------------------------
    let debugOn = false;
    const onKeyDown = (e) => {
      if (destroyed) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) && e.key !== "Escape") return;
      if (document.querySelector("#modal-root .overlay")) return;
      const k = e.key.toLowerCase();
      if (e.code === "Space") { spaceDown = true; viewport.style.cursor = "grab"; e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === "d") { debugOn = !debugOn; renderStatus(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "0") { e.preventDefault(); fitView(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "1") { e.preventDefault(); setZoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1); return; }
      if ((e.ctrlKey || e.metaKey) && k === "v") { e.preventDefault(); pasteLayer(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === "[") { adjustSize(-1); return; }
      if (k === "]") { adjustSize(1); return; }
      if (k === "m") { view.mirror = !view.mirror; applyView(); renderOptions(); return; }
      if (k === "g") { view.guides = !view.guides; syncStack(); renderOptions(); return; }
      const hit = Object.entries(TOOL_DEFS).find(([, d]) => d.key === k);
      if (hit) setTool(hit[0]);
    };
    const onKeyUp = (e) => { if (e.code === "Space") { spaceDown = false; viewport.style.cursor = ""; } };
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
      if (doc.layers.length >= MAX_LAYERS) { TL.toast(`Up to ${MAX_LAYERS} layers.`); return null; }
      const layer = makeLayer(name || `Layer ${doc.layers.length + 1}`, canvas);
      const index = at === undefined ? doc.active + 1 : at;
      doc.layers.splice(index, 0, layer);
      doc.active = index;
      syncStack();
      return layer;
    }

    function removeLayer(i) {
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
      layersPanel.append(h("div.sk-sect-head", h("strong", "Layers"),
        h("span.spacer"),
        h("button.icon-btn.tiny", { title: "New layer", onclick: () => {
          const layer = addLayer(); if (!layer) return;
          const at = doc.layers.indexOf(layer);
          pushOps(() => { removeLayer(doc.layers.indexOf(layer)); renderLayers(); }, () => { doc.layers.splice(at, 0, layer); doc.active = at; syncStack(); renderLayers(); });
          renderLayers(); touch();
        } }, "＋"),
        h("button.icon-btn.tiny", { title: "Duplicate layer", onclick: () => {
          const src = activeLayer();
          const layer = addLayer(`${src.name} copy`, copyCanvas(src.canvas)); if (!layer) return;
          layer.opacity = src.opacity;
          const at = doc.layers.indexOf(layer);
          pushOps(() => { removeLayer(doc.layers.indexOf(layer)); renderLayers(); }, () => { doc.layers.splice(at, 0, layer); doc.active = at; syncStack(); renderLayers(); });
          syncStack(); renderLayers(); touch();
        } }, "⧉"),
        h("button.icon-btn.tiny", { title: "Delete layer", onclick: () => {
          if (doc.layers.length < 2) { TL.toast("A sketch needs at least one layer."); return; }
          const at = doc.active;
          const layer = removeLayer(at);
          pushOps(() => { doc.layers.splice(at, 0, layer); doc.active = at; syncStack(); renderLayers(); }, () => { removeLayer(doc.layers.indexOf(layer)); renderLayers(); });
          renderLayers(); touch();
        } }, "🗑"),
        h("button.icon-btn.tiny", { title: "Move layer up", onclick: () => reorder(1) }, "▲"),
        h("button.icon-btn.tiny", { title: "Move layer down", onclick: () => reorder(-1) }, "▼")));

      const list = h("div.sk-layer-list");
      for (let i = doc.layers.length - 1; i >= 0; i--) {
        const l = doc.layers[i];
        const th = TL.canvas(64, Math.round(64 * doc.h / doc.w));
        l.thumb = th;
        thumbFor(l);
        list.append(h("div.sk-layer-row", {
          class: i === doc.active ? "active" : "",
          onclick: () => { doc.active = i; syncStack(); renderLayers(); },
        },
          h("button.icon-btn.tiny", {
            title: l.visible ? "Hide" : "Show", class: l.visible ? "" : "off",
            onclick: (e) => { e.stopPropagation(); l.visible = !l.visible; syncStack(); renderLayers(); touch(); },
          }, l.visible ? "👁" : "—"),
          h("div.sk-layer-thumb", th),
          h("span.sk-layer-name", {
            title: "Double-click to rename",
            ondblclick: async (e) => { e.stopPropagation(); const n = await TL.prompt("Layer name", l.name); if (n) { l.name = n; renderLayers(); touch(); } },
          }, l.name)));
      }
      layersPanel.append(list);
      layersPanel.append(h("label.sk-field", "Layer opacity",
        h("input", {
          type: "range", min: "0", max: "100", value: String(Math.round(active.opacity * 100)),
          oninput: (e) => { active.opacity = e.target.value / 100; active.el.style.opacity = active.visible ? String(active.opacity) : "0"; },
          onchange: () => touch(),
        })));
      layersPanel.append(h("div.row.wrap",
        h("button.btn.small", { title: "Put a picture from your libraries on its own layer", onclick: openLibraryPicker }, "＋ From library"),
        h("button.btn.small", { onclick: pickImageFile }, "＋ Image file"),
        h("button.btn.small", { title: "Make the active layer bigger or smaller (around the canvas centre)", onclick: () => scaleLayer(1 / 1.1) }, "−"),
        h("button.btn.small", { onclick: () => scaleLayer(1.1) }, "＋ Scale")));
    }

    function reorder(dir) {
      const i = doc.active, j = i + dir;
      if (j < 0 || j >= doc.layers.length) return;
      const swap = () => { const [l] = doc.layers.splice(i, 1); doc.layers.splice(j, 0, l); doc.active = j; syncStack(); renderLayers(); };
      const unswap = () => { const [l] = doc.layers.splice(j, 1); doc.layers.splice(i, 0, l); doc.active = i; syncStack(); renderLayers(); };
      swap();
      pushOps(unswap, swap);
      touch();
    }

    function scaleLayer(f) {
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

    async function pasteLayer() {
      const bytes = await window.host.readClipboardImage();
      if (!bytes) { TL.toast("There's no image on the clipboard.", "bad"); return; }
      const bmp = await createImageBitmap(new Blob([bytes]));
      insertImage(bmp, "Pasted");
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
      closeFn = () => TL.$("#modal-root .modal-head .icon-btn") && TL.$("#modal-root .modal-head .icon-btn").click();
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
      tool = t;
      renderTools(); renderOptions();
    }

    function setColor(c) {
      color = c;
      localStorage.setItem("thumblab.color", c);
      recent = [c, ...recent.filter((x) => x !== c)].slice(0, 8);
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

    function renderTools() {
      TL.clear(toolsPanel);
      toolsPanel.append(
        h("div.sk-tool-grid", Object.entries(TOOL_DEFS).map(([key, def]) => h("button.sk-tool", {
          class: tool === key ? "on" : "", title: `${def.label} (${def.key.toUpperCase()}): ${def.tip}`,
          onclick: () => setTool(key),
        }, h("span.glyph", def.glyph), h("span.tl", def.label)))),
        h("div.sk-color",
          h("input", { type: "color", value: color, title: "Colour", oninput: (e) => setColor(e.target.value) }),
          h("div.sk-swatches", [...recent, ...SWATCHES.filter((s) => !recent.includes(s))].slice(0, 12).map((s) =>
            h("button.sk-swatch", { style: { background: s }, class: s === color ? "on" : "", title: s, onclick: () => setColor(s) })))));
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
        optionsPanel.append(...[
          h("div.sk-sect-head", h("strong", def.label)),
          slider("Size", () => s.size, (v) => { s.size = v; }, 1, 400, 1, (v) => `${v}px`),
          slider("Opacity", () => s.opacity, (v) => { s.opacity = v; }, 0.05, 1, 0.05, pct),
          tool === "pen" || tool === "eraser" ? null : slider("Softness", () => 1 - s.hardness, (v) => { s.hardness = 1 - v; }, 0, 1, 0.05, pct),
          slider("Pressure → size", () => s.pSize, (v) => { s.pSize = v; }, 0, 1, 0.05, pct),
          slider("Pressure → opacity", () => s.pOpacity, (v) => { s.pOpacity = v; }, 0, 1, 0.05, pct),
          slider("Smoothing", () => s.smooth, (v) => { s.smooth = v; }, 0, 1, 0.05, pct),
          h("label.sk-field", h("span.sk-field-top", "Pressure feel", h("span.val", "soft ↔ firm")),
            h("input", { type: "range", min: "0", max: "100", value: String(feel), oninput: (e) => { feel = parseFloat(e.target.value); persistTools(); } })),
          h("button.btn.small.ghost", { onclick: () => { Object.assign(s, TOOL_DEFS[tool].defaults); persistTools(); renderOptions(); } }, "Reset this tool"),
        ].filter(Boolean));
      } else {
        optionsPanel.append(h("div.sk-sect-head", h("strong", def.label)), h("p.muted", def.tip));
      }
      optionsPanel.append(
        h("div.sk-sect-head", h("strong", "View")),
        h("div.row.wrap",
          h("button.btn.small", { onclick: fitView, title: "Fit (Ctrl+0)" }, "Fit"),
          h("button.btn.small", { onclick: () => setZoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1), title: "100% (Ctrl+1)" }, "100%"),
          h("button.btn.small", { class: view.mirror ? "on" : "", title: "Flip the view to spot drawing mistakes (M)", onclick: () => { view.mirror = !view.mirror; applyView(); renderOptions(); } }, "Mirror"),
          h("button.btn.small", { class: view.guides ? "on" : "", title: "Thirds, safe margin and the duration-badge zone (G)", onclick: () => { view.guides = !view.guides; syncStack(); renderOptions(); } }, "Guides")));
    }

    // ---- status ---------------------------------------------------------------------------------------
    let debugText = "";
    function renderDebug(e) {
      if (debugOn) debugText = `${e.pointerType} · pressure ${e.pressure.toFixed(2)} · buttons ${e.buttons} · tilt ${e.tiltX ?? 0}/${e.tiltY ?? 0}`;
      else debugText = "";
      renderStatus();
    }
    function renderStatus(bad) {
      status.textContent = `${doc.w}×${doc.h} · ${Math.round(view.s * 100)}% · ${lastSaved}${debugText ? " · " + debugText : ""}`;
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
        ["Open in default app (layered PSD)", async () => { await flush(); const err = await window.host.openPath(variant.source); if (err) TL.toast(err, "bad"); }],
        ["Save PSD as… (keeps layers)", savePsdAs],
        ["Save PNG as…", async () => { const p = await window.host.saveAs(await pngBytes(), nameSafe(), "png"); if (p) TL.toast(`Saved ${TL.fileName(p)}`); }],
        ["Copy flattened image", async () => { await window.host.copyImage(await pngBytes()); TL.toast("Copied. Paste it into any app."); }],
        ["Send PSD + PNG to handoff folder", handoffFolder],
        ["Change handoff folder…", async () => { const d = await window.host.pickFolder("Choose your handoff folder"); if (d) { TL.state.settings.handoffFolder = d; TL.saveSettings(); TL.toast("Handoff folder set"); } }],
        ["Show the PSD in its folder", () => window.host.reveal(variant.source)],
      ];
      const menu = h("div.popmenu", items.map(([label, fn]) => h("button", { onclick: async () => { menu.remove(); try { await fn(); } catch (e) { TL.toast(e.message, "bad"); } } }, label)));
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
      const chip = h("div.drag-chip", { draggable: true, title: `Drag this into Photoshop, CSP or any folder (${ext.toUpperCase()})` }, `⠿ ${label}`);
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
    const sendBtn = h("button.btn.primary", { onclick: (e) => handoffMenu(e.currentTarget) }, "Send to… ▾");
    function renderTop() {
      TL.clear(topbar);
      topbar.append(
        h("button.btn", { onclick: async () => { await close(); } }, "← Back"),
        h("span.sk-title", h("span.label-pill", variant.label), " ", variant.name),
        h("button.icon-btn", { title: "Undo (Ctrl+Z)", onclick: undo }, "↶"),
        h("button.icon-btn", { title: "Redo (Ctrl+Y)", onclick: redo }, "↷"),
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
    const ro = new ResizeObserver(() => { if (!view.fitted && viewport.clientWidth) { view.fitted = true; fitView(); } });

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
