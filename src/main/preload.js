'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The renderer gets exactly these calls and nothing else — no fs, no shell,
// no ipcRenderer. Every path it ever sees has already been vetted by main.
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  scan: () => ipcRenderer.invoke('scan:run'),
  onScanProgress: (handler) => {
    const listener = (_event, progress) => handler(progress);
    ipcRenderer.on('scan:progress', listener);
    return () => ipcRenderer.removeListener('scan:progress', listener);
  },

  getArt: (aircraftId, options) => ipcRenderer.invoke('art:get', aircraftId, options),
  setArtOverride: (aircraftId) => ipcRenderer.invoke('art:setOverride', aircraftId),
  pasteArtOverride: (aircraftId) => ipcRenderer.invoke('art:pasteOverride', aircraftId),
  clearArtOverride: (aircraftId) => ipcRenderer.invoke('art:clearOverride', aircraftId),
  artSources: () => ipcRenderer.invoke('art:sources'),
  artCacheInfo: () => ipcRenderer.invoke('art:cacheInfo'),
  clearArtCache: () => ipcRenderer.invoke('art:clearCache'),

  openPath: (target) => ipcRenderer.invoke('shell:openPath', target),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  addRoot: () => ipcRenderer.invoke('roots:add'),
  rootCandidates: () => ipcRenderer.invoke('roots:candidates'),
  removeRoot: (dir) => ipcRenderer.invoke('roots:remove', dir),
});
