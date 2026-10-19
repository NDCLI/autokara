const { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage } = require('electron')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
let mainWindow = null
const settingsFile = () => path.join(app.getPath('userData'), 'provider-settings.json')

const DEFAULT_PROVIDER = {
  kind: 'mock',
  endpoint: 'https://api.deepgram.com/v1/listen',
  model: 'nova-3',
  language: 'vi',
  diarize: true,
  customSegmentsPath: 'segments',
  customWordsPath: 'words',
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0c1020',
    title: 'Kara Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  if (isDev) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
}

function ensureFile(filePath) {
  const resolved = path.resolve(filePath)
  if (!fsSync.existsSync(resolved)) throw new Error('File không tồn tại hoặc đã bị di chuyển.')
  return resolved
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsFile(), 'utf8')
    const value = JSON.parse(raw)
    return { profile: { ...DEFAULT_PROVIDER, ...(value.profile || {}) }, encryptedApiKey: value.encryptedApiKey }
  } catch {
    return { profile: { ...DEFAULT_PROVIDER }, encryptedApiKey: undefined }
  }
}

async function writeSettings(profile, apiKey) {
  const encryptedApiKey = apiKey && safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(apiKey).toString('base64')
    : undefined
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true })
  await fs.writeFile(settingsFile(), JSON.stringify({ profile, encryptedApiKey }, null, 2), 'utf8')
}

async function getApiKey() {
  const settings = await readSettings()
  if (!settings.encryptedApiKey || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64'))
  } catch {
    return ''
  }
}

function makeId(prefix, index) {
  return `${prefix}-${index + 1}`
}

function mockTranscript(lyricsText) {
  const lines = (lyricsText || 'Chưa có lời để mô phỏng timing').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let cursor = 0
  const segments = lines.map((text, index) => {
    const tokens = text.split(/\s+/).filter(Boolean)
    const start = cursor
    const end = start + Math.max(2.2, Math.min(5.2, tokens.length * 0.52))
    const span = (end - start) / Math.max(tokens.length, 1)
    const words = tokens.map((word, wordIndex) => ({
      id: `${makeId('word', index)}-${wordIndex + 1}`,
      text: word,
      start: start + wordIndex * span,
      end: start + (wordIndex + 1) * span,
      confidence: 0.5,
    }))
    cursor = end + 0.28
    return { id: makeId('segment', index), text, start, end, speakerId: index % 2 ? 'speaker_1' : 'speaker_0', confidence: 0.5, words }
  })
  return { segments }
}

function readPath(value, pathValue) {
  if (!pathValue) return value
  return pathValue.split('.').reduce((current, part) => {
    const match = part.match(/^([^\[]+)(?:\[(\d+)\])?$/)
    if (!match || current === null || current === undefined || typeof current !== 'object') return undefined
    const next = current[match[1]]
    return match[2] === undefined ? next : Array.isArray(next) ? next[Number(match[2])] : undefined
  }, value)
}

function number(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeWords(raw, segmentStart, segmentEnd, segmentIndex) {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const value = item
    const text = String(value.punctuated_word || value.word || value.text || '').trim()
    if (!text) return []
    const start = Math.max(segmentStart, number(value.start, segmentStart))
    const end = Math.max(start + 0.01, Math.min(segmentEnd, number(value.end, start + 0.1)))
    return [{ id: `word-${segmentIndex}-${index + 1}`, text, start, end, confidence: number(value.confidence, 1) }]
  })
}

function normalizeDeepgram(payload) {
  const alternative = payload?.results?.channels?.[0]?.alternatives?.[0]
  if (!alternative) throw new Error('Deepgram response không có channel/alternative.')
  const words = normalizeWords(alternative.words, 0, Number.MAX_SAFE_INTEGER, 0)
  const paragraphs = alternative.paragraphs?.paragraphs
  if (Array.isArray(paragraphs) && paragraphs.length) {
    const segments = paragraphs.flatMap((paragraph, index) => {
      const start = number(paragraph.start)
      const end = Math.max(start + 0.1, number(paragraph.end, start + 1))
      const paragraphWords = normalizeWords(paragraph.sentences || paragraph.words, start, end, index)
      const text = String(paragraph.text || paragraphWords.map((word) => word.text).join(' ')).trim()
      return text ? [{ id: `segment-${index + 1}`, text, start, end, speakerId: paragraph.speaker === undefined ? undefined : String(paragraph.speaker), confidence: number(paragraph.confidence, 1), words: paragraphWords }] : []
    })
    if (segments.length) return { segments, duration: payload?.metadata?.duration }
  }
  const transcript = String(alternative.transcript || '').trim()
  if (!transcript) throw new Error('Deepgram response không có transcript.')
  return { segments: [{ id: 'segment-1', text: transcript, start: words[0]?.start || 0, end: words.at(-1)?.end || 1, words }], duration: payload?.metadata?.duration }
}

function normalizeCustom(payload, profile) {
  const rawSegments = readPath(payload, profile.customSegmentsPath || 'segments')
  if (!Array.isArray(rawSegments)) throw new Error('Provider không trả về segments hợp lệ. Kiểm tra JSON path.')
  const segments = rawSegments.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const value = item
    const start = number(value.start || value.startTime)
    const end = Math.max(start + 0.1, number(value.end || value.endTime, start + 1))
    const words = normalizeWords(value.words, start, end, index)
    const text = String(value.text || value.transcript || words.map((word) => word.text).join(' ')).trim()
    return text ? [{ id: String(value.id || `segment-${index + 1}`), text, start, end, speakerId: value.speaker === undefined ? value.speakerId === undefined ? undefined : String(value.speakerId) : String(value.speaker), confidence: value.confidence === undefined ? undefined : number(value.confidence), words }] : []
  })
  if (!segments.length) throw new Error('Provider không trả về segment có nội dung.')
  return { segments }
}

async function callProvider(profile, audioPath, lyricsText) {
  if (profile.kind === 'mock') return mockTranscript(lyricsText)
  const audio = await fs.readFile(ensureFile(audioPath))
  const apiKey = await getApiKey()
  if (!apiKey) throw new Error('Chưa có API key. Mở Cấu hình provider để lưu key trên máy này.')
  if (!profile.endpoint?.trim()) throw new Error('Provider chưa có endpoint.')
  const url = new URL(profile.endpoint)
  if (profile.kind === 'deepgram') {
    url.searchParams.set('model', profile.model)
    url.searchParams.set('language', profile.language)
    url.searchParams.set('diarize', String(profile.diarize))
    url.searchParams.set('punctuate', 'true')
    url.searchParams.set('utterances', 'true')
    url.searchParams.set('paragraphs', 'true')
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/octet-stream' },
    body: audio,
    signal: AbortSignal.timeout(120000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Provider trả về HTTP ${response.status}.`)
  return profile.kind === 'deepgram' ? normalizeDeepgram(payload) : normalizeCustom(payload, profile)
}

function registerIpc() {
  ipcMain.handle('pick-file', async (_event, kind) => {
    const filters = kind === 'lyrics'
      ? [{ name: 'Lyrics / subtitles', extensions: ['txt', 'lrc', 'srt', 'ass', 'ssa'] }]
      : [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm'] }]
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters })
    if (result.canceled || !result.filePaths[0]) return null
    const selected = ensureFile(result.filePaths[0])
    return { path: selected, displayName: path.basename(selected), mimeType: kind === 'lyrics' ? 'text/plain' : undefined, url: kind === 'lyrics' ? undefined : `kara-media://local/${encodeURIComponent(selected)}` }
  })
  ipcMain.handle('media-url', async (_event, filePath) => `kara-media://local/${encodeURIComponent(ensureFile(filePath))}`)
  ipcMain.handle('read-text-file', async (_event, filePath) => fs.readFile(ensureFile(filePath), 'utf8'))
  ipcMain.handle('open-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Kara Studio project', extensions: ['kara.json', 'json'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const projectPath = ensureFile(result.filePaths[0])
    const project = JSON.parse(await fs.readFile(projectPath, 'utf8'))
    return { path: projectPath, project }
  })
  ipcMain.handle('save-project', async (_event, project, currentPath) => {
    const result = currentPath ? { canceled: false, filePath: currentPath } : await dialog.showSaveDialog(mainWindow, { defaultPath: `${project.title || 'kara-project'}.kara.json`, filters: [{ name: 'Kara Studio project', extensions: ['kara.json'] }] })
    if (result.canceled || !result.filePath) return null
    const target = result.filePath.endsWith('.kara.json') ? result.filePath : `${result.filePath}.kara.json`
    await fs.writeFile(target, JSON.stringify(project, null, 2), 'utf8')
    return { path: target }
  })
  ipcMain.handle('save-export', async (_event, format, content, suggestedName) => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
    if (result.canceled || !result.filePath) return null
    const target = result.filePath.toLowerCase().endsWith(`.${format}`) ? result.filePath : `${result.filePath}.${format}`
    await fs.writeFile(target, content, 'utf8')
    return { path: target }
  })
  ipcMain.handle('load-provider-settings', async () => {
    const settings = await readSettings()
    return { profile: settings.profile, apiKeyPresent: Boolean(settings.encryptedApiKey) }
  })
  ipcMain.handle('save-provider-settings', async (_event, profile, apiKey) => writeSettings(profile, apiKey))
  ipcMain.handle('transcribe', async (_event, profile, audioPath, lyricsText) => callProvider(profile, audioPath, lyricsText))
}

protocol.registerSchemesAsPrivileged([{ scheme: 'kara-media', privileges: { secure: true, supportFetchAPI: true, stream: true } }])
app.whenReady().then(() => {
  protocol.handle('kara-media', (request) => {
    const encodedPath = request.url.replace('kara-media://local/', '')
    const target = ensureFile(decodeURIComponent(encodedPath))
    return net.fetch(`file://${target}`)
  })
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
