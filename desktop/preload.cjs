const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("medialyzeDesktop", {
  isDesktop: () => true,
  selectLibraryPath: () => ipcRenderer.invoke("medialyze:select-library-path"),
});
