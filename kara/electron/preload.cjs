const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kara', {
  isElectron: true,
  pickFile: (kind) => ipcRenderer.invoke('pick-file', kind),
  getMediaUrl: (filePath) => ipcRenderer.invoke('media-url', filePath),
  getWaveform: (filePath) => ipcRenderer.invoke('waveform', filePath),
  extractVideoAudio: (filePath) => ipcRenderer.invoke('extract-video-audio', filePath),
  prepareVideoPreview: (filePath) => ipcRenderer.invoke('prepare-video-preview', filePath),
  getMediaFingerprint: (filePath) => ipcRenderer.invoke('media-fingerprint', filePath),
  getMediaSignature: (filePath) => ipcRenderer.invoke('media-signature', filePath),
  loadCachedTranscript: (key) => ipcRenderer.invoke('load-cached-transcript', key),
  readTextFile: (filePath) => ipcRenderer.invoke('read-text-file', filePath),
  openProject: () => ipcRenderer.invoke('open-project'),
  saveProject: (project, currentPath) => ipcRenderer.invoke('save-project', project, currentPath),
  loadRecoveryProject: () => ipcRenderer.invoke('load-recovery-project'),
  saveRecoveryProject: (project) => ipcRenderer.invoke('save-recovery-project', project),
  clearRecoveryProject: () => ipcRenderer.invoke('clear-recovery-project'),
  saveExport: (format, content, suggestedName) => ipcRenderer.invoke('save-export', format, content, suggestedName),
  loadProviderSettings: () => ipcRenderer.invoke('load-provider-settings'),
  saveProviderSettings: (profile) => ipcRenderer.invoke('save-provider-settings', profile),
  checkLocalRuntime: (profile) => ipcRenderer.invoke('check-local-runtime', profile),
  separateVocals: (jobId, audioPath, pythonPath) => ipcRenderer.invoke('separate-vocals', jobId, audioPath, pythonPath),
  cancelSeparation: (jobId) => ipcRenderer.invoke('cancel-separation', jobId),
  transcribe: (jobId, profile, audioPath, lyricsText) => ipcRenderer.invoke('transcribe', jobId, profile, audioPath, lyricsText),
  cancelTranscribe: (jobId) => ipcRenderer.invoke('cancel-transcribe', jobId),
  onTranscribeProgress: (listener) => {
    const handler = (_event, progress) => listener(progress)
    ipcRenderer.on('transcribe-progress', handler)
    return () => ipcRenderer.removeListener('transcribe-progress', handler)
  },
  startRender: (request) => ipcRenderer.invoke('start-render', request),
  onRenderProgress: (listener) => {
    const handler = (_event, progress) => listener(progress)
    ipcRenderer.on('render-progress', handler)
    return () => ipcRenderer.removeListener('render-progress', handler)
  },
  cancelRender: (jobId) => ipcRenderer.invoke('cancel-render', jobId),
})
