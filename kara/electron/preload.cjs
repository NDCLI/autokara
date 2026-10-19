const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kara', {
  isElectron: true,
  pickFile: (kind) => ipcRenderer.invoke('pick-file', kind),
  getMediaUrl: (filePath) => ipcRenderer.invoke('media-url', filePath),
  readTextFile: (filePath) => ipcRenderer.invoke('read-text-file', filePath),
  openProject: () => ipcRenderer.invoke('open-project'),
  saveProject: (project, currentPath) => ipcRenderer.invoke('save-project', project, currentPath),
  saveExport: (format, content, suggestedName) => ipcRenderer.invoke('save-export', format, content, suggestedName),
  loadProviderSettings: () => ipcRenderer.invoke('load-provider-settings'),
  saveProviderSettings: (profile, apiKey) => ipcRenderer.invoke('save-provider-settings', profile, apiKey),
  transcribe: (profile, audioPath, lyricsText) => ipcRenderer.invoke('transcribe', profile, audioPath, lyricsText),
})
