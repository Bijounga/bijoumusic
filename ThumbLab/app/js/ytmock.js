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
    home: { label: "Home feed", width: 1280, counts: [12, 24, 36, 48] },
    search: { label: "Search results", width: 1100, counts: [6, 12, 18, 24] },
    watch: { label: "Watch page sidebar", width: 1280, counts: [10, 20, 30, 40] },
    mobile: { label: "Phone", width: 390, counts: [6, 12, 18, 24] },
  };

  const liveCache = new Map(); // "niche|order" -> { videos, at, cached }

  /** "12:34" or "1:02:03" -> seconds (0 if unknown). */
  function seconds(text) {
    if (!text) return 0;
    return text.split(":").reduce((n, part) => n * 60 + (parseInt(part, 10) || 0), 0);
  }

  function avatar(name) {
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
      h("div.yt-row", avatar(item.channel),
        h("div.yt-text", h("div.yt-title", item.title), h("div.yt-sub", item.channel), h("div.yt-sub", stats(item)))));
  }

  function searchItem(item, opts) {
    return h("div.yt-item.search",
      thumbBox(item, opts),
      h("div.yt-text",
        h("div.yt-title.big", item.title),
        h("div.yt-sub", stats(item)),
        h("div.yt-row.tight", avatar(item.channel), h("span.yt-sub", item.channel)),
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
      h("div.yt-row", avatar(item.channel),
        h("div.yt-text", h("div.yt-title", item.title), h("div.yt-sub", `${item.channel} · ${TL.fmtViews(item.views)} views · ${item.ago}`))));
  }

  // ---- the view --------------------------------------------------------------------------

  TL.testView = (project, nav) => {
    const t = project.test;
    const root = h("div.testview");
    const controls = h("div.test-controls");
    const status = h("div.test-status");
    const holder = h("div.test-holder");
    root.append(controls, holder);

    let feed = { items: [], live: false, note: "" };
    let token = 0;

    const channelName = () => TL.state.settings.channelName || "Your Channel";
    const countOf = () => LAYOUTS[t.layout].counts[TL.clamp((t.sample || 1) - 1, 0, 3)];

    const variantsToShow = () => {
      const all = project.variants.filter((v) => v.img);
      if (!all.length) return [];
      if (t.showAll) return all;
      const one = all.find((v) => v.id === t.variantId) || all.find((v) => v.pick) || all[0];
      return [one];
    };

    // ---- competition source
    async function loadFeed(force) {
      const my = ++token;
      const need = countOf() + 6;
      let items = null, note = "", live = false;
      const wantLive = t.source !== "placeholder" && TL.state.hasKey;
      if (wantLive) {
        try {
          // One YouTube search page is 50 videos; big feeds fetch a second page.
          const pages = need > 36 ? 2 : 1;
          const key = `${project.niche}|${t.order}|${pages}`;
          let res = liveCache.get(key);
          if (!res) { res = await window.host.ytNiche({ query: project.niche, order: t.order, pages, force: !!force }); liveCache.set(key, res); }
          if (my !== token) return;
          const rnd = TL.rng(t.seed);
          // Shorts show as a narrow strip inside a 16:9 box and can run up to 3 minutes.
          const pool = res.videos.filter((v) => !t.hideShorts || seconds(v.duration) > 180);
          for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
          items = pool.slice(0, need).map((v) => ({ ...v, ago: TL.timeAgo(v.published) }));
          live = true;
          note = `Real YouTube videos for "${project.niche}"${res.cached ? " (saved copy, under 24 hours old)" : ""}.`;
          if (items.length < countOf()) note += ` Only ${items.length} real videos were available, so some repeat. Turn off Hide Shorts or pick a broader niche for more.`;
        } catch (e) {
          note = `${e.message} Showing placeholders instead.`;
        }
      } else if (t.source !== "placeholder") {
        note = "Placeholder feed. Add a YouTube API key in Settings to compare against real videos in this niche.";
      } else {
        note = "Placeholder feed (chosen).";
      }
      if (!items) items = TL.fakeFeed(project.niche, t.seed, need);
      if (my !== token) return;
      feed = { items, live, note };
      renderPage();
    }

    // ---- page
    function composeList(count) {
      const mine = variantsToShow().map((v) => ({
        id: `mine-${v.id}`, mine: true, label: v.label, thumb: TL.imgUrl(v.img, v.rev),
        title: v.title || project.title, channel: channelName(), views: 1200, ago: "Just now", duration: t.durationText || "12:34",
      }));
      const others = feed.items.slice();
      const slots = [];
      const start = TL.clamp(t.slot, 1, count) - 1;
      let oi = 0;
      for (let i = 0; i < count; i++) {
        const mi = i - start;
        if (mi >= 0 && mi < mine.length) slots.push(mine[mi]);
        else slots.push(others[oi++ % others.length]);
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
      const chips = ["All", project.niche, "Live", "Recently uploaded", "Watched"];

      const header = h("div.yt-header",
        h("span.yt-burger", "☰"),
        h("span.yt-brand", "▶ Feed preview"),
        h("span.yt-search", h("span", "Search"), h("span.yt-mag", "🔍")),
        h("span.yt-me", "◉"));
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
            h("div.yt-player", h("span.yt-play", "▶")),
            h("div.yt-title.big", (main && (main.title || project.title)) || project.title),
            h("div.yt-row", avatar(channelName()), h("div.yt-text", h("div.yt-title.small", channelName()), h("div.yt-sub", "12K subscribers")))),
          h("div.yt-side-col", items.map((it, i) => wrapMine(sideItem(it, opts), it, i))));
      } else {
        body = h("div.yt-mobile-list", items.map((it, i) => wrapMine(mobileItem(it, opts), it, i)));
      }

      const frame = h("div.yt-frame", { class: `${t.dark ? "dark" : "light"} ${t.layout}`, style: { width: `${lay.width}px` } },
        header, chipRow, body);
      holder.append(frame);
      fit(frame);
      status.textContent = feed.note;
      status.classList.toggle("bad", !feed.live && /YouTube says|rejected|quota/i.test(feed.note));
    }

    function fit(frame) {
      const lay = LAYOUTS[t.layout];
      const avail = holder.clientWidth - 32;
      const scale = t.zoom === "real" ? 1 : Math.min(1, avail / lay.width);
      frame.style.zoom = String(Math.max(0.3, scale));
    }

    // ---- controls
    function renderControls() {
      TL.clear(controls);
      const vs = project.variants.filter((v) => v.img);
      const sel = (opts, value, on) => h("select.select", { onchange: (e) => on(e.target.value) },
        opts.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
      const niches = TL.NICHES.includes(project.niche) ? TL.NICHES : [project.niche, ...TL.NICHES];

      controls.append(
        h("div.row.wrap",
          h("div.seg", [
            ...vs.map((v) => h("button.seg-btn", {
              class: !t.showAll && (variantsToShow()[0] === v) ? "on" : "",
              title: `Test version ${v.label}`,
              onclick: () => { t.showAll = false; t.variantId = v.id; TL.saveProject(project); renderControls(); renderPage(); },
            }, v.label)),
            vs.length > 1 ? h("button.seg-btn", {
              class: t.showAll ? "on" : "", title: "Put every version in the feed, side by side",
              onclick: () => { t.showAll = !t.showAll; TL.saveProject(project); renderControls(); renderPage(); },
            }, "All") : null,
          ]),
          sel(Object.entries(LAYOUTS).map(([k, l]) => [k, l.label]), t.layout, (v) => { t.layout = v; TL.saveProject(project); renderControls(); renderPage(); loadFeed(); }),
          h("button.btn.small", { onclick: () => { t.dark = !t.dark; TL.saveProject(project); renderPage(); } }, t.dark ? "☾ Dark" : "☀ Light"),
          h("label.inline", "Niche",
            h("select.select", {
              onchange: async (e) => {
                let val = e.target.value;
                if (val === "__custom") {
                  val = await TL.prompt("Search terms for the niche", project.niche, "e.g. terraria calamity boss guide");
                  if (!val) { renderControls(); return; }
                }
                project.niche = val; TL.saveProject(project); renderControls(); loadFeed();
              },
            }, [...niches.map((n) => h("option", { value: n, selected: n === project.niche }, n)), h("option", { value: "__custom" }, "Custom search…")])),
          h("label.inline", "Position",
            h("input.text.tiny", {
              type: "number", min: "1", max: String(countOf()), value: String(t.slot),
              onchange: (e) => { t.slot = TL.clamp(parseInt(e.target.value, 10) || 1, 1, countOf()); TL.saveProject(project); renderPage(); },
            })),
          h("label.inline", { title: "How many videos are on the page around yours" }, "Videos",
            h("select.select", {
              onchange: (e) => { t.sample = parseInt(e.target.value, 10); t.slot = TL.clamp(t.slot, 1, countOf()); TL.saveProject(project); renderControls(); loadFeed(); },
            }, LAYOUTS[t.layout].counts.map((n, i) => h("option", { value: i + 1, selected: (t.sample || 1) === i + 1 }, String(n))))),
          h("button.btn.small", {
            title: "A different set of videos around yours, and a different spot for yours",
            onclick: () => {
              t.seed = Math.floor(Math.random() * 1e6);
              const room = Math.max(1, countOf() - variantsToShow().length + 1);
              t.slot = 1 + Math.floor(Math.random() * room);
              TL.saveProject(project); renderControls(); loadFeed();
            },
          }, "⟳ Shuffle"),
          h("button.btn.small", {
            title: "Fetch fresh results from YouTube",
            disabled: !TL.state.hasKey,
            onclick: () => { liveCache.clear(); loadFeed(true); },
          }, "Refresh live"),
          sel([["relevance", "Relevant"], ["viewCount", "Most viewed"], ["date", "Newest"]], t.order, (v) => { t.order = v; TL.saveProject(project); loadFeed(); })),
        h("div.row.wrap",
          TL.fxBar(),
          h("label.check.inline", { title: "Leave out videos of 3 minutes or less (Shorts) from the real feed" },
            h("input", { type: "checkbox", checked: !!t.hideShorts, onchange: (e) => { t.hideShorts = e.target.checked; TL.saveProject(project); loadFeed(); } }), h("span", "Hide Shorts")),
          h("label.check.inline", h("input", { type: "checkbox", checked: t.duration, onchange: (e) => { t.duration = e.target.checked; TL.saveProject(project); renderPage(); } }), h("span", "Duration badge")),
          h("label.check.inline", h("input", { type: "checkbox", checked: !!t.highlight, onchange: (e) => { t.highlight = e.target.checked; TL.saveProject(project); renderPage(); } }), h("span", "Mark mine")),
          sel([["fit", "Fit to window"], ["real", "Real size"]], t.zoom || "fit", (v) => { t.zoom = v; TL.saveProject(project); renderPage(); }),
          h("label.inline", "Source",
            sel([["auto", TL.state.hasKey ? "Live (YouTube)" : "Placeholder"], ["placeholder", "Always placeholder"]], t.source, (v) => { t.source = v; TL.saveProject(project); loadFeed(); }))),
        status);
    }

    if (!project.variants.some((v) => v.img)) {
      root.append(h("div.empty.big", h("strong", "Nothing to test yet"),
        h("p", "Bring in a sketch or a finished thumbnail first, then it appears here among the competition."),
        h("button.btn.primary", { onclick: () => nav.setTab("canvas") }, "Bring art in")));
      return root;
    }

    renderControls();
    status.textContent = "Loading the feed…";
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
