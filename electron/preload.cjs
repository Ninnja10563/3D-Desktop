'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose capabilities individually; the renderer never receives IPC or Node access.
contextBridge.exposeInMainWorld('depthNative', Object.freeze({
  platform: process.platform,
  getApps: () => ipcRenderer.invoke('depth:get-apps'),
  openApp: (id) => ipcRenderer.invoke('depth:open-app', id),
  getSources: () => ipcRenderer.invoke('depth:get-sources'),
  selectSource: (id) => ipcRenderer.invoke('depth:select-source', id),
  getScreenPermission: () => ipcRenderer.invoke('depth:screen-permission'),
  openScreenPrivacySettings: () => ipcRenderer.invoke('depth:screen-privacy'),
  toggleFullscreen: () => ipcRenderer.invoke('depth:toggle-fullscreen'),
}));
