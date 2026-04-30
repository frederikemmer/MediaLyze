const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("medialyzeDesktop", {
  isDesktop: () => true,
  selectLibraryPaths: () => ipcRenderer.invoke("medialyze:select-library-paths"),
});
