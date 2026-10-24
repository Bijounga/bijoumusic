/** Settings: YouTube API key, channel name, handoff folder, shared checklist. */
(function (TL) {
  const { h } = TL;

  TL.settingsView = () => {
    const root = h("div.settings");
    const s = TL.state.settings;

    const render = () => {
      TL.clear(root);
      const keyInput = h("input.text", { type: "password", placeholder: TL.state.hasKey ? "A key is saved. Paste a new one to replace it" : "Paste your YouTube Data API key", autocomplete: "off" });
      const keyStatus = h("div.muted", TL.state.hasKey ? "A key is saved (stored encrypted on this PC)." : "No key yet. The Test tab uses placeholder thumbnails until you add one.");

      root.append(
        h("h1", "Settings"),
        h("div.panel",
          h("h3", "Real competition videos (YouTube API)"),
          h("p.muted", "The Test tab can fill the feed with real videos from your niche. That needs a free YouTube Data API key:"),
          h("ol.steps",
            h("li", "Go to console.cloud.google.com and create a project."),
            h("li", "Enable \"YouTube Data API v3\" for it (APIs & Services → Library)."),
            h("li", "Create an API key (APIs & Services → Credentials → Create credentials → API key)."),
            h("li", "Paste it below. Searches are cached for a day, so the free quota goes a long way.")),
          h("div.row", keyInput,
            h("button.btn.primary", {
              onclick: async () => {
                const v = keyInput.value.trim();
                if (!v) { TL.toast("Paste a key first."); return; }
                TL.state.hasKey = await window.host.ytSetKey(v);
                TL.toast("Key saved"); render();
              },
            }, "Save"),
            h("button.btn", {
              disabled: !TL.state.hasKey,
              onclick: async () => {
                keyStatus.textContent = "Testing…";
                try { await window.host.ytTest(); keyStatus.textContent = "The key works."; keyStatus.className = "ok"; }
                catch (e) { keyStatus.textContent = e.message; keyStatus.className = "warn"; }
              },
            }, "Test key"),
            TL.state.hasKey ? h("button.btn.ghost", {
              onclick: async () => { TL.state.hasKey = await window.host.ytSetKey(""); TL.toast("Key removed"); render(); },
            }, "Remove key") : null),
          keyStatus),
        h("div.panel",
          h("h3", "Your channel"),
          h("label.field", "Channel name shown on your thumbnail in the Test feed",
            h("input.text", { value: s.channelName || "", placeholder: "Your Channel", oninput: (e) => { s.channelName = e.target.value; TL.saveSettings(); } }))),
        h("div.panel",
          h("h3", "Handoff folder"),
          h("p.muted", "\"Send to handoff folder\" in the sketch pad writes the PSD and PNG here. Pick a folder that syncs to your iPad (iCloud Drive, Dropbox…) to open sketches in Procreate."),
          h("div.row", h("code.path", s.handoffFolder || "Not set"),
            h("button.btn.small", {
              onclick: async () => { const d = await window.host.pickFolder("Choose the handoff folder"); if (d) { s.handoffFolder = d; TL.saveSettings(); render(); } },
            }, "Choose…"))),
        h("div.panel",
          h("h3", "Shared checklist"),
          h("button.btn", { onclick: () => TL.editChecklists() }, "Edit shared checklist…")),
        h("div.panel",
          h("h3", "Data"),
          h("p.muted", "Projects, sketches and libraries live here:"),
          h("div.row", h("code.path", TL.state.dataDir), h("button.btn.small", { onclick: () => window.host.reveal(TL.state.dataDir) }, "Show"))));
    };
    render();
    return root;
  };
})(window.TL);
