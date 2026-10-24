/**
 * Placeholder competition: procedurally drawn "YouTube-style" thumbnails plus believable
 * titles/channels, used when there is no API key (or the key's quota is used up). They are
 * deliberately loud - big faces, arrows, shouty text - so a quiet thumbnail has to earn
 * its place.
 */
(function (TL) {
  const VOCAB = {
    Gaming: ["Elden Ring", "this boss", "Hardcore mode", "the final level", "speedrun", "the new update"],
    Minecraft: ["Minecraft", "a 1x1 world", "Hardcore", "the Ender Dragon", "a mega base", "survival"],
    Terraria: ["Terraria", "Calamity mod", "Master mode", "Moon Lord", "a Terraria boss", "Expert mode"],
    "Tech reviews": ["the new phone", "this laptop", "a $5 gadget", "the M5 chip", "AI glasses", "this keyboard"],
    Commentary: ["this drama", "the algorithm", "this trend", "creator burnout", "this scandal", "the internet"],
    Vlog: ["a week in Tokyo", "moving out", "my morning routine", "this trip", "a day alone", "my new room"],
    Animation: ["my animation", "a 3 second loop", "this cartoon", "stick figures", "my first short", "a fight scene"],
    "Drawing and art": ["digital art", "my art style", "a speedpaint", "my sketchbook", "the pen tool", "a character design"],
    "Video editing": ["my editing", "Premiere Pro", "a viral edit", "this transition", "After Effects", "my workflow"],
    Education: ["the universe", "black holes", "the Roman Empire", "this experiment", "quantum physics", "the human brain"],
    Music: ["this song", "a guitar solo", "my new album", "a beat in 10 minutes", "piano covers", "this chord"],
    Cooking: ["a 5 star burger", "ramen", "the perfect steak", "a $1 meal", "my grandma's recipe", "pizza dough"],
    Fitness: ["30 days of pushups", "a full body workout", "a cold plunge", "my gym routine", "calisthenics", "running"],
    "Horror stories": ["the abandoned house", "this creepypasta", "a haunted game", "the basement", "a true story", "the night shift"],
  };

  const TEMPLATES = [
    "I Tried {x} For 24 Hours",
    "{X}, But It Gets Harder Every Time",
    "The Truth About {x}",
    "Why Everyone Is Wrong About {x}",
    "I Spent 100 Days On {x}",
    "{X} Is Actually INSANE",
    "Beating {x} With Only One Hand",
    "This {x} Secret Changes Everything",
    "How I Mastered {x} In 10 Minutes",
    "I Built The Perfect {x}",
    "{X} (Full Story)",
    "Nobody Expected This From {x}",
    "Testing {x} So You Don't Have To",
    "{X} But Everything Is Cursed",
  ];

  const CHANNELS = [
    "Pixel Pioneer", "Nova Frames", "Daily Dax", "The Rift", "Mango Studio", "Coldbrew", "Static Cat", "ByteSize",
    "Lumen Lab", "Wobbly Wizard", "North Peak", "Hazel & Co", "Blue Orbit", "Rusty Gear", "Tiny Titan", "Ember TV",
    "Quokka Plays", "Drift Theory", "Salt Mine", "Orbit Kid", "Moth Light", "Parallel Pete", "Glitch Garden", "Cinder",
  ];

  const AGES = ["3 hours ago", "1 day ago", "2 days ago", "4 days ago", "1 week ago", "2 weeks ago", "3 weeks ago", "1 month ago", "2 months ago", "5 months ago", "1 year ago"];

  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  function titleCase(s) { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }

  function makeText(r, niche) {
    const vocab = VOCAB[niche] || [niche.toLowerCase(), "this", "my project", "the challenge"];
    const x = pick(r, vocab);
    return pick(r, TEMPLATES).replace("{x}", x).replace("{X}", titleCase(x));
  }

  function duration(r) {
    const m = Math.floor(2 + r() * r() * 40), s = Math.floor(r() * 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // ---- drawing -------------------------------------------------------------------------

  const hsl = (h, s, l) => `hsl(${Math.round(h) % 360} ${Math.round(s)}% ${Math.round(l)}%)`;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function face(ctx, r, cx, cy, rad, hue) {
    const skin = pick(r, ["#f2c6a0", "#e0a97c", "#c68642", "#8d5524", "#ffd8b8", hsl(hue + 120, 60, 60), hsl(hue + 180, 70, 55)]);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath(); ctx.ellipse(cx + rad * 0.08, cy + rad * 0.12, rad, rad * 1.02, 0, 0, 7); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse(cx, cy, rad, rad * 1.02, 0, 0, 7); ctx.fill();
    ctx.lineWidth = rad * 0.06; ctx.strokeStyle = "#111"; ctx.stroke();
    // hair cap
    ctx.fillStyle = pick(r, ["#1b1b1b", "#5a3825", "#e8c547", "#d94f3d", "#3b6fd9"]);
    ctx.beginPath(); ctx.ellipse(cx, cy - rad * 0.55, rad * 1.02, rad * 0.55, 0, Math.PI, 0); ctx.fill();
    // eyes (wide = shocked, which is the genre's favourite)
    const ex = rad * 0.38, ey = cy - rad * 0.05, er = rad * (0.2 + r() * 0.1);
    for (const sx of [-1, 1]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.ellipse(cx + sx * ex, ey, er, er * 1.15, 0, 0, 7); ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(cx + sx * ex + er * 0.15, ey + er * 0.1, er * 0.42, 0, 7); ctx.fill();
    }
    // mouth
    ctx.fillStyle = "#3a0d12";
    ctx.beginPath(); ctx.ellipse(cx, cy + rad * 0.5, rad * (0.2 + r() * 0.25), rad * (0.12 + r() * 0.25), 0, 0, 7); ctx.fill();
    ctx.stroke();
  }

  function bigText(ctx, r, x, y, w, h, lines, hue) {
    const lh = h / lines;
    for (let i = 0; i < lines; i++) {
      const lw = w * (i === 0 ? 1 : 0.55 + r() * 0.4);
      const yy = y + i * lh;
      ctx.lineJoin = "round";
      ctx.lineWidth = lh * 0.2; ctx.strokeStyle = "#000";
      const fill = i === 0 ? "#fff" : pick(r, ["#ffe600", "#ff3b30", hsl(hue + 150, 100, 60), "#fff"]);
      ctx.fillStyle = fill;
      // Blocky letter-shapes: a row of tall rounded rects with gaps
      const n = Math.max(3, Math.round(lw / (lh * 0.62)));
      const cw = lw / n;
      for (let k = 0; k < n; k++) {
        if (r() < 0.12) continue; // word gap
        const hh = lh * (0.78 + r() * 0.2);
        roundRect(ctx, x + k * cw, yy + (lh - hh) / 2, cw * 0.8, hh, cw * 0.25);
        ctx.stroke(); ctx.fill();
      }
    }
  }

  function arrow(ctx, x, y, len, ang, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = color; ctx.strokeStyle = "#000"; ctx.lineWidth = len * 0.06; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.1); ctx.lineTo(len * 0.62, -len * 0.1); ctx.lineTo(len * 0.62, -len * 0.26);
    ctx.lineTo(len, 0); ctx.lineTo(len * 0.62, len * 0.26); ctx.lineTo(len * 0.62, len * 0.1); ctx.lineTo(0, len * 0.1);
    ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  function draw(seed, niche) {
    const r = TL.rng(seed);
    const W = 320, H = 180;
    const c = TL.canvas(W, H);
    const ctx = c.getContext("2d");
    const dark = niche === "Horror stories" || r() < 0.2;
    const hue = r() * 360;
    const sat = dark ? 45 : 70 + r() * 30;
    const g = ctx.createLinearGradient(0, 0, W, H * (0.4 + r()));
    g.addColorStop(0, hsl(hue, sat, dark ? 14 : 40 + r() * 15));
    g.addColorStop(1, hsl(hue + 35 + r() * 40, sat, dark ? 28 : 28 + r() * 25));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // light rays / glow
    const glow = ctx.createRadialGradient(W * (0.3 + r() * 0.4), H * 0.45, 4, W * 0.5, H * 0.5, W * 0.6);
    glow.addColorStop(0, `hsla(${hue + 20},100%,${dark ? 45 : 75}%,.55)`);
    glow.addColorStop(1, "hsla(0,0%,0%,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    const layout = Math.floor(r() * 4);
    const left = r() < 0.5;
    if (layout === 0) { // face + text
      const rad = H * (0.3 + r() * 0.1);
      face(ctx, r, left ? W * 0.27 : W * 0.73, H * 0.55, rad, hue);
      bigText(ctx, r, left ? W * 0.5 : W * 0.04, H * 0.1, W * 0.46, H * 0.62, 2, hue);
      if (r() < 0.6) arrow(ctx, left ? W * 0.5 : W * 0.46, H * 0.85, W * 0.22, left ? -0.5 : Math.PI + 0.5, "#ff2d2d");
    } else if (layout === 1) { // big centered object + arrow
      ctx.fillStyle = hsl(hue + 180, 80, 55); ctx.strokeStyle = "#000"; ctx.lineWidth = 4;
      const s = H * (0.5 + r() * 0.2), x = W / 2 - s / 2, y = H * 0.12;
      roundRect(ctx, x, y, s, s, s * 0.2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.beginPath(); ctx.arc(W / 2, y + s / 2, s * 0.25, 0, 7); ctx.fill();
      arrow(ctx, W * 0.08, H * 0.7, W * 0.3, -0.35, "#ffe600");
      bigText(ctx, r, W * 0.06, H * 0.8, W * 0.88, H * 0.17, 1, hue);
    } else if (layout === 2) { // versus split
      ctx.fillStyle = hsl(hue + 120, 80, 45); ctx.beginPath(); ctx.moveTo(W * 0.52, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W * 0.42, H); ctx.fill();
      face(ctx, r, W * 0.22, H * 0.55, H * 0.26, hue);
      face(ctx, r, W * 0.78, H * 0.55, H * 0.26, hue + 90);
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 5; ctx.font = "900 46px Arial Black, Impact, sans-serif"; ctx.textAlign = "center";
      ctx.strokeText("VS", W / 2, H * 0.62); ctx.fillText("VS", W / 2, H * 0.62);
    } else { // text heavy
      bigText(ctx, r, W * 0.06, H * 0.12, W * 0.88, H * 0.76, 3, hue);
      if (r() < 0.6) face(ctx, r, W * 0.86, H * 0.8, H * 0.16, hue);
    }
    // vignette
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    return c.toDataURL("image/jpeg", 0.82);
  }

  const cache = new Map();

  /** A deterministic list of fake videos for a niche. */
  TL.fakeFeed = (niche, seed, count) => {
    const out = [];
    const r = TL.rng(seed * 7919 + niche.length * 31);
    for (let i = 0; i < count; i++) {
      const itemSeed = Math.floor(r() * 1e9);
      const key = `${niche}|${itemSeed}`;
      if (!cache.has(key)) cache.set(key, draw(itemSeed, niche));
      const rr = TL.rng(itemSeed + 5);
      out.push({
        id: `fake-${itemSeed}`,
        title: makeText(rr, niche),
        channel: pick(rr, CHANNELS),
        views: Math.round(Math.exp(Math.log(4000) + rr() * Math.log(2000))),
        ago: pick(rr, AGES),
        duration: duration(rr),
        thumb: cache.get(key),
        fake: true,
      });
    }
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return out;
  };
})(window.TL);
