const { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage } = require('electron')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { buildFfmpegArgs, assertOutputDoesNotMatchInputs, parseProgressLine, publishRenderOutput } = require('./render-utils.cjs')

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const renderJobs = new Map()
let capabilityCheck
let quitRequested = false
let mainWindow = null
const settingsFile = () => path.join(app.getPath('userData'), 'provider-settings.json')
const localWhisperWorker = () => {
  const candidates = [
    path.join(process.resourcesPath, 'local-whisper-worker.py'),
    path.join(process.resourcesPath, 'electron', 'local-whisper-worker.py'),
    path.join(__dirname, 'local-whisper-worker.py'),
  ]
  const bundled = candidates.find((candidate) => fsSync.existsSync(candidate)) || candidates[0]
  return bundled.includes(`${path.sep}app.asar${path.sep}`)
    ? bundled.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : bundled
}

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
  const window = new BrowserWindow({
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
  mainWindow = window
  window.on('closed', () => {
    for (const job of renderJobs.values()) if (job.owner === window) cancelRenderJob(job)
    if (mainWindow === window) mainWindow = null
  })
  if (isDev) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(path.join(__dirname, '../dist/index.html'))
}

function ensureFile(filePath) {
  const resolved = path.resolve(filePath)
  if (!fsSync.existsSync(resolved) || !fsSync.statSync(resolved).isFile()) throw new Error('File không tồn tại hoặc đã bị di chuyển.')
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

function spawnLocalWorker(args) {
  const worker = localWhisperWorker()
  const candidates = process.env.KARA_PYTHON
    ? [{ executable: process.env.KARA_PYTHON, prefix: [] }]
    : process.platform === 'win32'
      ? [{ executable: 'python', prefix: [] }, { executable: 'py', prefix: ['-3'] }]
      : [{ executable: 'python3', prefix: [] }, { executable: 'python', prefix: [] }]
  return new Promise((resolve, reject) => {
    let index = 0
    let child
    let settled = false
    let lastError
    const start = () => {
      if (index >= candidates.length) {
        reject(lastError || new Error('Không tìm thấy Python runtime để chạy timestamp local.'))
        return
      }
      const candidate = candidates[index++]
      child = spawn(candidate.executable, [...candidate.prefix, worker, ...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
        const lines = stdout.split(/\r?\n/)
        stdout = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const message = JSON.parse(line)
            if (message.type === 'result') return resolve(message)
            if (message.type === 'error') lastError = new Error(message.message || 'Local timestamp worker thất bại.')
          } catch { /* ignore non-JSON worker output */ }
        }
      })
      child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      child.once('error', (error) => {
        lastError = error
        start()
      })
      child.once('close', (code) => {
        if (settled) return
        if (code !== 0 && !lastError && stderr.trim()) lastError = new Error(stderr.trim().split(/\r?\n/).at(-1))
        if (code !== 0) start()
      })
    }
    const finish = (handler) => (value) => {
      if (settled) return
      settled = true
      handler(value)
    }
    const originalResolve = resolve
    resolve = finish(originalResolve)
    start()
  })
}

async function callLocalWhisper(profile, audioPath) {
  ensureFile(audioPath)
  if (!fsSync.existsSync(localWhisperWorker())) throw new Error('Không tìm thấy worker timestamp local trong ứng dụng.')
  const requestedModel = profile.localModelPath || profile.model
  const model = profile.localModelPath || (['tiny', 'base', 'small', 'medium'].includes(requestedModel) ? requestedModel : 'small')
  const result = await spawnLocalWorker(['--audio', ensureFile(audioPath), '--model', model, '--language', profile.language || 'vi', '--device', profile.localDevice || 'auto'])
  if (!Array.isArray(result.segments)) throw new Error('Worker local trả về dữ liệu timestamp không hợp lệ.')
  return { duration: result.duration, segments: result.segments }
}

async function callProvider(profile, audioPath, lyricsText) {
  if (profile.kind === 'mock') return mockTranscript(lyricsText)
  if (profile.kind === 'local') return callLocalWhisper(profile, audioPath)
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


function resolveFfmpegPath() {
  const candidates = []
  try {
    const packagePath = require('ffmpeg-static')
    if (typeof packagePath === 'string') {
      candidates.push(packagePath)
      candidates.push(packagePath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`))
    }
  } catch { /* resolved from explicit paths below */ }
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'))
  candidates.push(path.join(__dirname, '../node_modules/ffmpeg-static/ffmpeg.exe'))
  const executable = candidates.find((candidate) => candidate && fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile())
  if (!executable) throw new Error('Không tìm thấy FFmpeg đi kèm ứng dụng. Hãy cài lại Kara Studio.')
  return executable
}

function captureProcessOutput(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let failure = ''
    const collect = (target, chunk) => {
      const next = target + chunk.toString()
      return next.length > 2_000_000 ? next.slice(-2_000_000) : next
    }
    child.stdout.on('data', (chunk) => { output = collect(output, chunk) })
    child.stderr.on('data', (chunk) => { failure = collect(failure, chunk) })
    child.once('error', () => reject(new Error('Không thể khởi động FFmpeg. Hãy cài lại ứng dụng.')))
    child.once('close', (code) => code === 0 ? resolve(`${output}\n${failure}`) : reject(new Error('Không thể kiểm tra khả năng của FFmpeg.')))
  })
}

async function getUsableFfmpeg() {
  if (!capabilityCheck) {
    capabilityCheck = (async () => {
      const executable = resolveFfmpegPath()
      const [filters, encoders] = await Promise.all([
        captureProcessOutput(executable, ['-hide_banner', '-filters']),
        captureProcessOutput(executable, ['-hide_banner', '-encoders']),
      ])
      if (!/\bsubtitles\b/.test(filters)) throw new Error('FFmpeg đi kèm thiếu bộ lọc phụ đề libass.')
      if (!/\blibx264\b/.test(encoders)) throw new Error('FFmpeg đi kèm thiếu bộ mã hóa H.264 (libx264).')
      if (!/^\s*[VAS\.]{6}\s+aac\b/m.test(encoders)) throw new Error('FFmpeg đi kèm thiếu bộ mã hóa âm thanh AAC.')
      return executable
    })()
  }
  try {
    return await capabilityCheck
  } catch (error) {
    capabilityCheck = undefined
    throw error
  }
}

function sendRenderProgress(job, percent, status) {
  if (!job.owner.isDestroyed() && !job.owner.webContents.isDestroyed()) {
    job.owner.webContents.send('render-progress', { jobId: job.id, percent, status })
  }
}

function cancelRenderJob(job) {
  if (job.closed || job.canceled) return
  job.canceled = true
  if (job.child && !job.ffmpegClosed && !job.child.killed) job.child.kill()
}

function safeOutputName(value) {
  const base = path.basename(typeof value === 'string' ? value : 'kara-video')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  return `${base || 'kara-video'}.mp4`
}

function validateRenderRequest(request) {
  if (!request || typeof request !== 'object' || typeof request.jobId !== 'string' || !/^[\w-]{1,100}$/.test(request.jobId)) {
    throw new Error('Yêu cầu render không hợp lệ.')
  }
  if (typeof request.audioPath !== 'string' || typeof request.assContent !== 'string' || request.assContent.length > 5_000_000) {
    throw new Error('Thiếu audio hoặc dữ liệu lời vượt quá giới hạn.')
  }
  if (request.backgroundPath !== undefined && (typeof request.backgroundPath !== 'string' || request.backgroundPath.length > 4096)) {
    throw new Error('Đường dẫn video nền không hợp lệ.')
  }
  if (!Number.isFinite(request.duration) || request.duration <= 0 || request.duration > 24 * 60 * 60) throw new Error('Thời lượng audio không hợp lệ.')
  const video = request.video
  if (!video || !Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width < 16 || video.height < 16 || video.width > 3840 || video.height > 2160 || video.width % 2 || video.height % 2) {
    throw new Error('Kích thước video không hợp lệ.')
  }
  if (typeof video.backgroundColor !== 'string' || !/^#[\da-f]{6}$/i.test(video.backgroundColor)) throw new Error('Màu nền video không hợp lệ.')
  const position = video.lyricPosition
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) {
    throw new Error('Vị trí lời karaoke không hợp lệ.')
  }
  return { ...request, video: { ...video, lyricPosition: { ...position } } }
}

async function runRenderJob(owner, request, outputPath, ffmpegPath, job = { id: request.jobId, owner, child: null, canceled: false, closed: false }) {
  const tempPath = path.join(path.dirname(outputPath), `.kara-studio-${request.jobId}.tmp.mp4`)
  const subtitlePath = path.join(app.getPath('temp'), `kara-studio-${request.jobId}.ass`)
  Object.assign(job, { owner, outputPath, tempPath, subtitlePath })
  renderJobs.set(job.id, job)
  try {
    sendRenderProgress(job, 0, 'Đang chuẩn bị render…')
    await fs.writeFile(subtitlePath, request.assContent, 'utf8')
    if (job.canceled) return null
    const args = buildFfmpegArgs({ audioPath: request.audioPath, backgroundPath: request.backgroundPath, subtitlePath, outputPath: tempPath, video: request.video })
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      job.child = child
      let stdoutBuffer = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() || ''
        for (const line of lines) {
          const progress = parseProgressLine(line, request.duration)
          if (progress?.percent !== null && progress?.percent !== undefined) sendRenderProgress(job, progress.percent, progress.status)
        }
      })
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000) })
      child.once('error', () => reject(new Error('Không thể khởi động FFmpeg. Hãy kiểm tra bản cài đặt của ứng dụng.')))
      child.once('close', (code) => {
        job.ffmpegClosed = true
        if (job.canceled) return resolve(null)
        if (code !== 0) {
          if (/No such filter.*subtitles|filter.*not found/i.test(stderr)) return reject(new Error('FFmpeg không có bộ lọc phụ đề libass cần thiết.'))
          return reject(new Error(`Render thất bại (mã ${code ?? 'không xác định'}). Kiểm tra file audio và dung lượng ổ đĩa.`))
        }
        resolve(true)
      })
    })
    if (job.canceled) return null
    if (!fsSync.existsSync(tempPath)) throw new Error('FFmpeg kết thúc nhưng không tạo được file video.')
    const published = await publishRenderOutput(tempPath, outputPath, { isCanceled: () => job.canceled })
    if (published.status === 'canceled') return null
    sendRenderProgress(job, 100, 'Video đã render xong.')
    return { path: published.path }
  } catch (error) {
    if (job.canceled) return null
    throw error
  } finally {
    job.closed = true
    renderJobs.delete(job.id)
    await Promise.all([fs.rm(subtitlePath, { force: true }), fs.rm(tempPath, { force: true })])
  }
}

function registerIpc() {
  ipcMain.handle('pick-file', async (_event, kind) => {
    const filters = kind === 'lyrics'
      ? [{ name: 'Lyrics / subtitles', extensions: ['txt', 'lrc', 'srt', 'ass', 'ssa'] }]
      : kind === 'background'
        ? [{ name: 'Video background', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }]
        : [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm'] }]
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters })
    if (result.canceled || !result.filePaths[0]) return null
    const selected = ensureFile(result.filePaths[0])
    const mimeType = kind === 'lyrics'
      ? 'text/plain'
      : kind === 'background'
        ? `video/${path.extname(selected).slice(1).toLowerCase()}`
        : undefined
    return { path: selected, displayName: path.basename(selected), mimeType, url: kind === 'lyrics' ? undefined : `kara-media://local/${encodeURIComponent(selected)}` }
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
  ipcMain.handle('start-render', async (event, rawRequest) => {
    const request = validateRenderRequest(rawRequest)
    if (renderJobs.has(request.jobId)) throw new Error('Render này đang chạy.')
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || owner.isDestroyed()) throw new Error('Cửa sổ render không còn hoạt động.')
    const job = { id: request.jobId, owner, outputPath: null, tempPath: null, subtitlePath: null, child: null, canceled: false, closed: false, ffmpegClosed: false, finished: null }
    renderJobs.set(job.id, job)
    const operation = (async () => {
      try {
        const audioPath = ensureFile(request.audioPath)
        const backgroundPath = request.backgroundPath ? ensureFile(request.backgroundPath) : undefined
        const ffmpegPath = await getUsableFfmpeg()
        if (job.canceled) return null
        const result = await dialog.showSaveDialog(owner, {
          defaultPath: safeOutputName('kara-video'),
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
        })
        if (job.canceled || result.canceled || !result.filePath) return null
        const outputPath = result.filePath.toLowerCase().endsWith('.mp4') ? result.filePath : `${result.filePath}.mp4`
        assertOutputDoesNotMatchInputs(outputPath, audioPath, backgroundPath)
        if ([...renderJobs.values()].some((active) => active !== job && active.outputPath && path.resolve(active.outputPath).toLowerCase() === path.resolve(outputPath).toLowerCase())) {
          throw new Error('Đang có một render khác sử dụng file đích này.')
        }
        job.outputPath = outputPath
        return await runRenderJob(owner, { ...request, audioPath, backgroundPath }, outputPath, ffmpegPath, job)
      } finally {
        job.closed = true
        if (renderJobs.get(job.id) === job) renderJobs.delete(job.id)
      }
    })()
    job.finished = operation
    return operation
  })
  ipcMain.handle('cancel-render', (event, jobId) => {
    if (typeof jobId !== 'string') return
    const owner = BrowserWindow.fromWebContents(event.sender)
    const job = renderJobs.get(jobId)
    if (job && owner && job.owner === owner) cancelRenderJob(job)
  })
}

protocol.registerSchemesAsPrivileged([{ scheme: 'kara-media', privileges: { secure: true, supportFetchAPI: true, stream: true } }])
app.whenReady().then(() => {
  protocol.handle('kara-media', (request) => {
    const encodedPath = request.url.replace('kara-media://local/', '')
    const target = ensureFile(decodeURIComponent(encodedPath))
    return net.fetch(pathToFileURL(target).toString())
  })
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('before-quit', (event) => {
  const jobs = [...renderJobs.values()]
  if (!jobs.length || quitRequested) return
  quitRequested = true
  event.preventDefault()
  for (const job of jobs) cancelRenderJob(job)
  void Promise.all(jobs.map((job) => job.finished ?? Promise.resolve())).then(() => app.quit())
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
