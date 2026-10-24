/** Settings: YouTube API key, channel name, handoff folder, shared checklist. */
(function (TL) {
  const { h } = TL;

  TL.settingsView = () => {
    const root = h("div.settings");
    const s = TL.state.settings;

    const section = (icon, title, ...kids) => h("div.panel",
      h("div.panel-head", TL.icon(icon, 16), h("h3", title)), kids);

    const render = () => {
      TL.clear(root);
      const keyInput = h("input.text", { type: "password", placeholder: TL.state.hasKey ? "Key saved. Paste a new one to replace it" : "YouTube Data API key", autocomplete: "off" });
      const keyStatus = h("div.muted.small", TL.state.hasKey ? "A key is saved (encrypted on this PC)." : "No key yet: the Test tab uses placeholder thumbnails.");

      root.append(
        h("h1", "Settings"),
        section("key", "YouTube API key",
          h("div.row", keyInput,
            TL.iconBtn("save", "Save key", async () => {
              const v = keyInput.value.trim();
              if (!v) { TL.toast("Paste a key first."); return; }
              TL.state.hasKey = await window.host.ytSetKey(v);
              TL.toast("Key saved"); render();
            }, { kind: "primary", label: "Save" }),
            TL.iconBtn("check", "Check that the key works", async () => {
              keyStatus.textContent = "Testing…";
              try { await window.host.ytTest(); keyStatus.textContent = "The key works."; keyStatus.className = "ok small"; }
              catch (e) { keyStatus.textContent = e.message; keyStatus.className = "warn"; }
            }, { class: "solid", label: "Test", disabled: !TL.state.hasKey }),
            TL.state.hasKey ? TL.iconBtn("trash", "Remove the saved key", async () => { TL.state.hasKey = await window.host.ytSetKey(""); TL.toast("Key removed"); render(); }, { class: "danger" }) : null),
          keyStatus,
          h("details.more",
            h("summary", "How to get a free key"),
            h("ol.steps",
              h("li", "Go to console.cloud.google.com and create a project."),
              h("li", "Enable YouTube Data API v3 (APIs & Services, Library)."),
              h("li", "Create an API key (Credentials, Create credentials). Restrict it to YouTube Data API v3."),
              h("li", "Paste it here. Searches are saved for a day, so the free quota lasts.")))),
        section("monitor", "Your channel",
          h("input.text", { value: s.channelName || "", placeholder: "Channel name shown on your thumbnail in the feed", oninput: (e) => { s.channelName = e.target.value; TL.saveSettings(); } })),
        section("send", "Handoff folder",
          h("div.row", h("code.path", s.handoffFolder || "Not set"),
            TL.iconBtn("folderOpen", "Choose the handoff folder", async () => { const d = await window.host.pickFolder("Choose the handoff folder"); if (d) { s.handoffFolder = d; TL.saveSettings(); render(); } }, { class: "solid" })),
          h("div.muted.small", "Where Send writes the PSD and PNG. Use an iCloud or Dropbox folder to open sketches in Procreate.")),
        section("checklist", "Shared checklist",
          TL.iconBtn("sliders", "Edit the shared checklist", () => TL.editChecklists(), { class: "solid", label: "Edit" })),
        section("folder", "Data",
          h("div.row", h("code.path", TL.state.dataDir), TL.iconBtn("external", "Show in Explorer", () => window.host.reveal(TL.state.dataDir), { class: "solid" }))));
    };
    render();
    return root;
  };
})(window.TL);
