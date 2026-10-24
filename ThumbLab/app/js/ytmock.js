/**
 * Test tab: your thumbnail dropped into a YouTube-style page among its competition.
 * The competition is real (YouTube Data API, searched by niche) when a key is saved,
 * otherwise loud placeholder thumbnails. Layouts: home grid, search results, watch-page
 * sidebar, and phone. Blur / grayscale / squint apply to the whole page.
 */
(function (TL) {
  const { h } = TL;

  const LAYOUTS = {
    // counts: how many videos the page shows at each "Videos" setting (rows of the feed)
    home: { label: "Home feed", icon: "home", width: 1280, counts: [12, 24, 36, 48] },
    search: { label: "Search results", icon: "results", width: 1100, counts: [6, 12, 18, 24] },
    watch: { label: "Watch page sidebar", icon: "watch", width: 1280, counts: [10, 20, 30, 40] },
    mobile: { label: "Phone", icon: "phone", width: 390, counts: [6, 12, 18, 24] },
  };

  const liveCache = new Map(); // "niche|order" -> { videos, at, cached }

  /** "12:34" or "1:02:03" -> seconds (0 if unknown). */
  function seconds(text) {
    if (!text) return 0;
    return text.split(":").reduce((n, part) => n * 60 + (parseInt(part, 10) || 0), 0);
  }

  function avatar(name, url) {
    if (url) return h("img.yt-avatar", { src: url, alt: "" });
    const hue = [...name].reduce((n, c) => n + c.charCodeAt(0) * 7, 0) % 360;
    return h("span.yt-avatar", { style: { background: `hsl(${hue} 55% 45%)` } }, name.trim()[0] || "?");
  }

  function durationBadge(item, on) {
    return on && item.duration ? h("span.yt-dur", item.duration) : null;
  }

  function stats(item) {
    return `${TL.fmtViews(item.views)} views · ${item.ago}`;
  }

  // ---- item renderers --------------------------------------------------------------------

  function thumbBox(item, opts) {
    return h("div.thumb.yt-thumb", h("img.fx", { src: item.thumb, alt: "", draggable: false }),
      durationBadge(item, opts.duration));
  }

  function homeItem(item, opts) {
    return h("div.yt-item.home",
      thumbBox(item, opts),
      h("div.yt-row", avatar(item.channel, item.avatar),
        h("div.yt-text", h("div.yt-title", item.title), h("div.yt-sub", item.channel), h("div.yt-sub", stats(item)))));
  }

  function searchItem(item, opts) {
    return h("div.yt-item.search",
      thumbBox(item, opts),
      h("div.yt-text",
        h("div.yt-title.big", item.title),
        h("div.yt-sub", stats(item)),
        h("div.yt-row.tight", avatar(item.channel, item.avatar), h("span.yt-sub", item.channel)),
        h("div.yt-sub.dim", "A short description of the video appears here, giving a little more context about what you'll watch…")));
  }

  function sideItem(item, opts) {
    return h("div.yt-item.side",
      thumbBox(item, opts),
      h("div.yt-text", h("div.yt-title.small", item.title), h("div.yt-sub", item.channel), h("div.yt-sub", stats(item))));
  }

  function mobileItem(item, opts) {
    return h("div.yt-item.mobile",
      thumbBox(item, opts),
      h("div.yt-row", avatar(item.channel, item.avatar),
        h("div.yt-text", h("div.yt-title", item.title), h("div.yt-sub", `${item.channel} · ${TL.fmtViews(item.views)} views · ${item.ago}`))));
  }

  // ---- the view --------------------------------------------------------------------------

  TL.testView = (project, nav) => {
    const t = project.test;
    const root = h("div.testview");
    const controls = h("div.test-controls");
    const warnSlot = h("span.warn-slot");
    const holder = h("div.test-holder");
    root.append(controls, holder);

    let feed = { items: [], live: false, note: "" };
    let token = 0;

    const linked = () => TL.state.settings.channel || null;
    const channelName = () => (linked() && linked().title) || TL.state.settings.channelName || "Your Channel";
    const channelAvatar = () => (linked() && linked().avatar) || "";
    const countOf = () => LAYOUTS[t.layout].counts[TL.clamp((t.sample || 1) - 1, 0, 3)];

    const variantsToShow = () => {
      const all = project.variants.filter((v) => v.img);
      if (!all.length) return [];
      if (t.showAll) return all;
      const one = all.find((v) => v.id === t.variantId) || all.find((v) => v.pick) || all[0];
      return [one];
    };

    // ---- competition source
    const DAY = 24 * 3600 * 1000;
    const RANGES = [["all", "All time"], ["24h", "Last 24 hours"], ["30d", "Last month"], ["90d", "Last 3 months"], ["365d", "Last year"], ["custom", "Custom range…"]];
    const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

    /** The publish-date window for "Most viewed", or null for all time / other orders. */
    function rangeFor() {
      if (t.order !== "viewCount" || !t.range || t.range === "all") return null;
      const days = { "24h": 1, "30d": 30, "90d": 90, "365d": 365 }[t.range];
      if (days) return { key: t.range, after: new Date(Date.now() - days * DAY).toISOString() };
      if (t.range === "custom") {
        const after = t.rangeFrom ? new Date(`${t.rangeFrom}T00:00:00`).toISOString() : undefined;
        const before = t.rangeTo ? new Date(`${t.rangeTo}T23:59:59`).toISOString() : undefined;
        return { key: `custom:${t.rangeFrom || ""}:${t.rangeTo || ""}`, after, before };
      }
      return null;
    }

    let warning = "";
    function updateWarn() {
      TL.clear(warnSlot);
      if (warning) warnSlot.append(TL.iconBtn("info", warning, () => TL.toast(warning), { class: "warnicon" }));
    }

    async function loadFeed(force) {
      const my = ++token;
      const need = countOf() + 6;
      let items = null, live = false, ownCount = 0, warn = "";
      const niche = (project.niche || "").trim();
      const wantLive = t.source !== "placeholder" && TL.state.hasKey && !!niche;
      if (wantLive) {
        try {
          const range = rangeFor();
          const key = `${niche}|${t.order}|${range ? range.key : "all"}|${!!t.hideShorts}|${need}`;
          let res = liveCache.get(key);
          if (!res) {
            res = await window.host.ytNiche({ query: niche, order: t.order, want: need, hideShorts: !!t.hideShorts, range, force: !!force });
            liveCache.set(key, res);
          }
          if (my !== token) return;
          const rnd = TL.rng(t.seed);
          // Shorts show as a narrow strip inside a 16:9 box and can run up to 3 minutes.
          const pool = res.videos.filter((v) => !t.hideShorts || seconds(v.duration) > 180);
          for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
          items = pool.slice(0, need).map((v) => ({ ...v, ago: TL.timeAgo(v.published) }));
          live = true;
          // Your own latest uploads, mixed in, so a new thumbnail is judged against your usual ones too.
          if (linked() && t.mixMine !== false) {
            try {
              const ckey = `channel|${linked().handle}`;
              let own = liveCache.get(ckey);
              if (!own) { own = await window.host.ytChannel({ handle: linked().handle, force: !!force }); liveCache.set(ckey, own); }
              if (my !== token) return;
              const mineVideos = own.videos.filter((v) => !t.hideShorts || seconds(v.duration) > 180);
              const n = Math.min(mineVideos.length, Math.max(3, Math.round(countOf() * 0.25)));
              if (n) {
                // Shuffle yours in among the videos that are actually on the page; the rest wait as spares.
                const shown = Math.max(0, countOf() - n);
                const visible = [...items.slice(0, shown), ...mineVideos.slice(0, n).map((v) => ({ ...v, ago: TL.timeAgo(v.published) }))];
                for (let i = visible.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [visible[i], visible[j]] = [visible[j], visible[i]]; }
                items = [...visible, ...items.slice(shown)];
                ownCount = n;
              }
            } catch (e) { warn = `Your uploads could not be added: ${e.message}`; }
          }
          if (!warn && items.length < countOf()) {
            warn = items.length
              ? `Only ${items.length} real videos match these filters, so the page shows fewer. Try a wider time frame or a broader niche.`
              : "No real videos match these filters. Try a wider time frame or a broader niche.";
          }
        } catch (e) {
          // Electron prefixes errors from the main process; show only what YouTube said.
          warn = `${String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")} Showing placeholders instead.`;
          TL.toast(warn, "bad");
        }
      } else if (t.source !== "placeholder" && TL.state.hasKey && !niche) {
        warn = "Type a niche to compare against real videos for it. Showing placeholders for now.";
      }
      if (!items) items = TL.fakeFeed(niche || "General", t.seed, need);
      if (my !== token) return;
      feed = { items, live, ownCount };
      warning = warn;
      renderPage();
    }

    // ---- page
    function composeList(count) {
      const mine = variantsToShow().map((v) => ({
        id: `mine-${v.id}`, mine: true, label: v.label, thumb: TL.imgUrl(v.img, v.rev),
        title: v.title || project.title, channel: channelName(), avatar: channelAvatar(), views: 1200, ago: "Just now", duration: t.durationText || "12:34",
      }));
      const others = feed.items.slice();
      // Real videos are never repeated: when there are too few, the page simply shows fewer.
      const total = Math.min(count, others.length + mine.length);
      const slots = [];
      const start = TL.clamp(t.slot, 1, Math.max(1, total)) - 1;
      let oi = 0;
      for (let i = 0; i < total; i++) {
        const mi = i - start;
        if (mi >= 0 && mi < mine.length) slots.push(mine[mi]);
        else if (oi < others.length) slots.push(others[oi++]);
      }
      return slots;
    }

    function wrapMine(el, item, index) {
      if (!item.mine) {
        el.addEventListener("click", () => { t.slot = index + 1; TL.saveProject(project); renderPage(); });
        el.title = "Click to move your thumbnail here";
        return el;
      }
      el.classList.add("mine");
      if (t.highlight) { el.classList.add("marked"); el.append(h("span.mine-tag", `Yours ${item.label}`)); }
      return el;
    }

    function renderPage() {
      TL.clear(holder);
      const lay = LAYOUTS[t.layout];
      const items = composeList(countOf());
      const opts = { duration: t.duration };
      const chips = ["All", project.niche || "General", "Live", "Recently uploaded", "Watched"];

      const header = h("div.yt-header",
        h("span.yt-burger", TL.icon("menu", 20)),
        h("span.yt-brand", TL.icon("play", 18), "Feed preview"),
        h("span.yt-search", h("span", "Search"), TL.icon("search", 16)),
        h("span.yt-me", avatar(channelName(), channelAvatar())));
      const chipRow = h("div.yt-chips", chips.map((c, i) => h("span.yt-chip", { class: i === 0 ? "active" : "" }, c)));

      let body;
      if (t.layout === "home") {
        body = h("div.yt-grid", items.map((it, i) => wrapMine(homeItem(it, opts), it, i)));
      } else if (t.layout === "search") {
        body = h("div.yt-results", items.map((it, i) => wrapMine(searchItem(it, opts), it, i)));
      } else if (t.layout === "watch") {
        const main = variantsToShow()[0];
        body = h("div.yt-watch",
          h("div.yt-player-col",
            h("div.yt-player", h("span.yt-play", TL.icon("play", 64))),
            h("div.yt-title.big", (main && (main.title || project.title)) || project.title),
            h("div.yt-row", avatar(channelName(), channelAvatar()), h("div.yt-text", h("div.yt-title.small", channelName()), h("div.yt-sub", "12K subscribers")))),
          h("div.yt-side-col", items.map((it, i) => wrapMine(sideItem(it, opts), it, i))));
      } else {
        body = h("div.yt-mobile-list", items.map((it, i) => wrapMine(mobileItem(it, opts), it, i)));
      }

      const frame = h("div.yt-frame", { class: `${t.dark ? "dark" : "light"} ${t.layout}`, style: { width: `${lay.width}px` } },
        header, chipRow, body);
      holder.append(frame);
      fit(frame);
      updateWarn();
    }

    function fit(frame) {
      const lay = LAYOUTS[t.layout];
      const avail = holder.clientWidth - 32;
      const scale = t.zoom === "real" ? 1 : Math.min(1, avail / lay.width);
      frame.style.zoom = String(Math.max(0.3, scale));
    }

    // ---- controls
    const customLabel = () => `${t.rangeFrom ? fmtDay(`${t.rangeFrom}T00:00:00`) : "Start"} to ${t.rangeTo ? fmtDay(`${t.rangeTo}T00:00:00`) : "now"}`;

    /** A from / to date pair for "Most viewed". Leave "to" empty for up to now. */
    async function customRange() {
      const today = new Date().toISOString().slice(0, 10);
      const from = h("input.text", { type: "date", value: t.rangeFrom || "", max: today });
      const to = h("input.text", { type: "date", value: t.rangeTo || "", max: today });
      const ok = await TL.modal({
        title: "Custom time frame",
        body: h("div.form", h("label", "From", from), h("label", "To (empty means now)", to)),
        buttons: [{ label: "Cancel", value: false }, { label: "Apply", kind: "primary", value: true }],
      });
      if (!ok) return;
      if (from.value && to.value && from.value > to.value) { TL.toast("The start date has to come before the end date.", "bad"); return customRange(); }
      t.range = "custom"; t.rangeFrom = from.value; t.rangeTo = to.value;
      TL.saveProject(project);
    }

    function renderControls() {
      TL.clear(controls);
      const vs = project.variants.filter((v) => v.img);
      const save = () => TL.saveProject(project);
      const group = (...kids) => h("div.tgroup", kids.filter(Boolean));
      const toggle = (icon, tip, on, fn, disabled) => TL.iconBtn(icon, tip, fn, { on, toggle: true, disabled });
      const select = (opts, value, on) => h("select.select", { onchange: (e) => on(e.target.value) },
        opts.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));

      const versions = h("div.seg", [
        ...vs.map((v) => h("button.seg-btn", {
          class: !t.showAll && (variantsToShow()[0] === v) ? "on" : "",
          title: `Test version ${v.label}`,
          onclick: () => { t.showAll = false; t.variantId = v.id; save(); renderControls(); renderPage(); },
        }, v.label)),
        vs.length > 1 ? h("button.seg-btn", {
          class: t.showAll ? "on" : "", title: "Every version in the feed, side by side",
          onclick: () => { t.showAll = !t.showAll; save(); renderControls(); renderPage(); },
        }, TL.icon("compare", 15)) : null,
      ]);
      const layouts = h("div.seg", Object.entries(LAYOUTS).map(([k, l]) => h("button.seg-btn", {
        class: t.layout === k ? "on" : "", title: l.label,
        onclick: () => { t.layout = k; save(); renderControls(); renderPage(); loadFeed(); },
      }, TL.icon(l.icon, 16))));

      controls.append(
        h("div.tbar",
          group(versions),
          group(layouts,
            TL.iconBtn(t.dark ? "moon" : "sun", t.dark ? "Dark page (click for light)" : "Light page (click for dark)", () => { t.dark = !t.dark; save(); renderControls(); renderPage(); })),
          group(
            h("label.fld", { title: "Order of the real videos" }, TL.icon("sort", 15),
              select([["relevance", "Relevant"], ["viewCount", "Most viewed"], ["date", "Newest"]], t.order, (v) => { t.order = v; save(); renderControls(); loadFeed(); })),
            t.order === "viewCount" ? h("label.fld", { title: "Only videos published in this time frame" }, TL.icon("calendar", 15),
              h("select.select", {
                onchange: async (e) => {
                  const v = e.target.value;
                  if (v === "custom") { await customRange(); } else { t.range = v; save(); }
                  renderControls(); loadFeed();
                },
              }, RANGES.map(([val, label]) => h("option", { value: val, selected: (t.range || "all") === val },
                val === "custom" && t.range === "custom" ? customLabel() : label)))) : null),
          group(
            h("label.fld", { title: "Where your thumbnail sits" }, TL.icon("hash", 15),
              h("input.text.num", {
                type: "number", min: "1", max: String(countOf()), value: String(t.slot),
                onchange: (e) => { t.slot = TL.clamp(parseInt(e.target.value, 10) || 1, 1, countOf()); save(); renderPage(); },
              })),
            h("label.fld", { title: "How many videos are on the page around yours" }, TL.icon("gridView", 15),
              h("select.select", {
                onchange: (e) => { t.sample = parseInt(e.target.value, 10); t.slot = TL.clamp(t.slot, 1, countOf()); save(); renderControls(); loadFeed(); },
              }, LAYOUTS[t.layout].counts.map((n, i) => h("option", { value: i + 1, selected: (t.sample || 1) === i + 1 }, String(n))))),
            TL.iconBtn("shuffle", "New videos around yours, and a new spot for yours", () => {
              t.seed = Math.floor(Math.random() * 1e6);
              const room = Math.max(1, countOf() - variantsToShow().length + 1);
              t.slot = 1 + Math.floor(Math.random() * room);
              save(); renderControls(); loadFeed();
            }),
            TL.iconBtn("refresh", "Fetch fresh videos from YouTube", () => { liveCache.clear(); loadFeed(true); }, { disabled: !TL.state.hasKey })),
          group(
            toggle("phoneOff", "Hide Shorts (videos of 3 minutes or less)", !!t.hideShorts, () => { t.hideShorts = !t.hideShorts; save(); renderControls(); loadFeed(); }),
            toggle("clock", "Duration badge on thumbnails", !!t.duration, () => { t.duration = !t.duration; save(); renderControls(); renderPage(); }),
            toggle("flag", "Mark mine: outline your thumbnail", !!t.highlight, () => { t.highlight = !t.highlight; save(); renderControls(); renderPage(); }),
            toggle(t.zoom === "real" ? "zoom100" : "fit", t.zoom === "real" ? "Real size (click to fit the window)" : "Fit to window (click for real size)", t.zoom === "real", () => { t.zoom = t.zoom === "real" ? "fit" : "real"; save(); renderControls(); renderPage(); }),
            toggle("channel", linked() ? "Mix in your latest uploads" : "Link your channel in Settings to mix in your uploads", !!linked() && t.mixMine !== false,
              () => { t.mixMine = t.mixMine === false; save(); renderControls(); loadFeed(); }, !linked()),
            toggle("globe", TL.state.hasKey ? "Real YouTube videos (off: placeholders)" : "Real videos need a YouTube API key in Settings", t.source !== "placeholder" && TL.state.hasKey,
              () => { t.source = t.source === "placeholder" ? "auto" : "placeholder"; save(); renderControls(); loadFeed(); }, !TL.state.hasKey)),
          group(
            h("label.fld", { title: "Niche: what the real videos are searched for" }, TL.icon("tag", 15),
              TL.nicheBox({ value: project.niche, group: project.id, onCommit: (val) => { project.niche = val; save(); renderControls(); loadFeed(); } }))),
          h("span.spacer"),
          warnSlot,
          group(TL.fxBar())),
        );
      updateWarn();
    }

    if (!project.variants.some((v) => v.img)) {
      root.append(h("div.empty.big", TL.icon("monitor", 32), h("strong", "Nothing to test yet"),
        h("p", "Bring in a sketch or a finished thumbnail, then see it among the competition."),
        h("div.row.center", TL.iconBtn("tray", "Bring in art", () => nav.setTab("canvas"), { kind: "primary", label: "Bring in art" }))));
      return root;
    }

    renderControls();
    loadFeed();

    // Keyboard: ← → cycle versions without touching the mouse.
    const onKey = (e) => {
      if (!root.isConnected) { window.removeEventListener("keydown", onKey); return; }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.ctrlKey || e.altKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const vs = project.variants.filter((v) => v.img);
      if (vs.length < 2) return;
      const cur = variantsToShow()[0];
      const i = vs.indexOf(cur);
      const next = vs[(i + (e.key === "ArrowRight" ? 1 : -1) + vs.length) % vs.length];
      t.showAll = false; t.variantId = next.id; TL.saveProject(project);
      renderControls(); renderPage();
    };
    window.addEventListener("keydown", onKey);
    const ro = new ResizeObserver(() => requestAnimationFrame(() => { const f = TL.$(".yt-frame", holder); if (f) fit(f); }));
    ro.observe(holder);
    const off = TL.on("variant-updated", () => { if (!root.isConnected) { off(); ro.disconnect(); return; } renderPage(); });
    return root;
  };
})(window.TL);
