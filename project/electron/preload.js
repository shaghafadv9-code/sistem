// Preload — قناة آمنة (لا حاجة لوظائف إضافية حاليًا، جاهزة للتحديث التلقائي)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  version: '1.0.0',
  platform: process.platform,
  onOpenPalette: (fn) => ipcRenderer.on('open-palette', fn)
});
