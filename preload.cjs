const { contextBridge, ipcRenderer } = require("electron");

// Expose a narrow, explicit desktop API instead of Node.js access in the renderer.
// Renderer'a Node.js erişimi açmak yerine dar kapsamlı ve açık bir masaüstü API'si sun.
contextBridge.exposeInMainWorld("yukiWindow", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close")
});

contextBridge.exposeInMainWorld("yukiStatus", {
  update: (text) => ipcRenderer.send("status:update", String(text || ""))
});

contextBridge.exposeInMainWorld("yukiAgent", {
  chooseFolder: () => ipcRenderer.invoke("agent:choose-folder"),
  chooseProjectFolder: () => ipcRenderer.invoke("agent:choose-project-folder"),
  chooseComputerFolder: () => ipcRenderer.invoke("agent:choose-computer-folder"),
  removeComputerFolder: (path) => ipcRenderer.invoke("agent:remove-computer-folder", String(path || "")),
  accessStatus: () => ipcRenderer.invoke("agent:access-status"),
  resourceUsage: () => ipcRenderer.invoke("agent:resource-usage"),
  notifyBackgroundReply: () => ipcRenderer.send("app:background-reply"),
  copyText: (text) => ipcRenderer.invoke("agent:copy-text", String(text || "")),
  ollamaStartupStatus: () => ipcRenderer.invoke("agent:ollama-startup-status"),
  ollamaModelPreset: () => ipcRenderer.invoke("agent:ollama-model-preset"),
  setOllamaModelPreset: (preset) => ipcRenderer.invoke("agent:set-ollama-model-preset", String(preset || "core")),
  onOllamaStartupStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("ollama:startup-status", listener);
    return () => ipcRenderer.removeListener("ollama:startup-status", listener);
  },
  searchFiles: (query) => ipcRenderer.invoke("agent:search-files", String(query || "")),
  readFile: (path) => ipcRenderer.invoke("agent:read-file", String(path || "")),
  openFile: (path) => ipcRenderer.invoke("agent:open-file", String(path || "")),
  saveFile: (fileName, content) => ipcRenderer.invoke("agent:save-file", String(fileName || ""), String(content || "")),
  openApp: (appKey) => ipcRenderer.invoke("agent:open-app", String(appKey || "")),
  googleSearch: (query) => ipcRenderer.invoke("agent:google-search", String(query || ""))
});
