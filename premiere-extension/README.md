# BijouMusic Premiere panel (UXP)

Gain, pitch, nudge, normalize and "send to Premiere" tools. Needs Premiere Pro 25.6 or newer
and BijouMusic running (the panel talks to it on `localhost:8934`).

1. Premiere: Settings → Plugins → tick **Enable developer mode**.
2. Install the **UXP Developer Tool** from the Creative Cloud app.
3. In it: **Add Plugin** → pick `manifest.json` in this folder → **Load**.
4. After updating this folder, click **Reload** (or Load again) in the Developer Tool.

When the panel opens, the first line of its activity log shows which build is loaded.
