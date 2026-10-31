const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('flowDesktop', Object.freeze({
  check: () => ipcRenderer.invoke('desktop:check'),
  start: () => ipcRenderer.invoke('desktop:start'),
}));
