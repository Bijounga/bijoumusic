const { contextBridge, ipcRenderer, webUtils } = require("electron");

const call = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

function listen(channel) {
  return (callback) => {
    const fn = (_e, payload) => callback(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  };
}

contextBridge.exposeInMainWorld("host", {
  load: call("store:load"),
  saveSettings: call("store:saveSettings"),
  saveProject: call("store:saveProject"),
  deleteProject: call("store:deleteProject"),
  saveLibrary: call("store:saveLibrary"),
  deleteLibrary: call("store:deleteLibrary"),

  writeFile: (rel, bytes) => ipcRenderer.invoke("file:write", { rel, bytes }),
  readFile: call("file:read"),
  sendToFolder: call("os:sendToFolder"),
  copyIn: (src, rel) => ipcRenderer.invoke("file:copyIn", { src, rel }),
  removePath: call("file:remove"),
  stat: call("file:stat"),

  pickFiles: call("dialog:pickFiles"),
  pickFolder: call("dialog:pickFolder"),
  saveAs: (bytes, name, ext) => ipcRenderer.invoke("dialog:saveAs", { bytes, name, ext }),

  copyImage: call("os:copyImage"),
  readClipboardImage: call("os:readClipboardImage"),
  openPath: call("os:open"),
  reveal: call("os:reveal"),
  writeTemp: (name, bytes) => ipcRenderer.invoke("os:writeTemp", { name, bytes }),
  startDrag: (file) => ipcRenderer.send("os:startDrag", file),

  preview: call("art:preview"),
  readPsdLayers: call("art:readPsdLayers"),
  writePsd: (opts) => ipcRenderer.invoke("art:writePsd", opts),

  watchFiles: call("watch:files"),
  watchFolder: call("watch:folder"),
  onFileChanged: listen("watch:changed"),
  onFolderFiles: listen("folder:files"),

  ytSetKey: call("yt:setKey"),
  ytTest: call("yt:test"),
  ytNiche: call("yt:niche"),
  ytChannel: call("yt:channel"),

  // Dropped File objects no longer carry a .path; this recovers it.
  pathForFile: (file) => webUtils.getPathForFile(file),

  // Absolute path -> URL the page can load.
  fileUrl: (p) => "file:///" + String(p).replace(/\\/g, "/").replace(/^\/+/, "").replace(/#/g, "%23").replace(/\?/g, "%3F"),
});
