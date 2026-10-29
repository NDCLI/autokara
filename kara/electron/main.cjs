const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require('electron')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { buildFfmpegArgs, buildVideoPreviewArgs, assertOutputDoesNotMatchInputs, parseProgressLine, publishRenderOutput, supportsBrowserPreviewEncoders, supportsRequiredEncoders } = require('./render-utils.cjs')
const { extractWaveform } = require('./waveform.cjs')
const { createTranscriptionCache } = require('./transcription-cache.cjs')
const { createRecoveryStore } = require('./recovery-store.cjs')
const { createJobRegistry } = require('./job-registry.cjs')

// Allow isolated packaged launches for smoke checks without touching the normal profile.
if (process.env.KARA_USER_DATA_DIR?.trim()) {
  app.setPath('userData', path.resolve(process.env.KARA_USER_DATA_DIR.trim()))
}

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const renderJobs = createJobRegistry()
const transcriptionJobs = createJobRegistry()
const separationJobs = createJobRegistry()
let capabilityCheck
const videoPreviewJobs = new Map()
let transcriptionCache
let recoveryStore
let quitRequested = false
let mainWindow = null
const settingsFile = () => path.join(app.getPath('userData'), 'provider-settings.json')
function getTranscriptionCache() {
  if (!transcriptionCache) transcriptionCache = createTranscriptionCache({ directory: path.join(app.getPath('userData'), 'transcription-cache') })
  return transcriptionCache
}
function getRecoveryStore() {
  if (!recoveryStore) recoveryStore = createRecoveryStore(path.join(app.getPath('userData'), 'recovery.kara.json'))
  return recoveryStore
}
function cancelTranscriptionJob(job) {
  job.canceled = true
  job.abortController.abort()
  if (job.child && !job.child.killed) job.child.kill()
}
function pythonCandidates(preferredExecutable) {
  if (preferredExecutable?.trim()) return [{ executable: preferredExecutable.trim(), prefix: [] }]
  if (process.env.KARA_PYTHON?.trim()) return [{ executable: process.env.KARA_PYTHON.trim(), prefix: [] }]
  return process.platform === 'win32'
    ? [
        ...[path.join(app.getPath('userData'), 'runtime', 'Scripts', 'python.exe'), path.join(__dirname, '..', '.venv-kara', 'Scripts', 'python.exe')].filter((candidate) => fsSync.existsSync(candidate)).map((executable) => ({ executable, prefix: [] })),
        { executable: 'py', prefix: ['-3.12'] }, { executable: 'py', prefix: ['-3.11'] }, { executable: 'py', prefix: ['-3.10'] },
        { executable: 'python3.12', prefix: [] }, { executable: 'python3.11', prefix: [] }, { executable: 'python3.10', prefix: [] },
        { executable: 'python', prefix: [] }, { executable: 'py', prefix: ['-3'] },
      ]
    : [{ executable: 'python3.12', prefix: [] }, { executable: 'python3.11', prefix: [] }, { executable: 'python3.10', prefix: [] }, { executable: 'python3', prefix: [] }, { executable: 'python', prefix: [] }]
}
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
  kind: 'local',
  model: 'small',
  language: 'vi',
}

function normalizeProviderProfile(value) {
  const source = value && typeof value === 'object' ? value : {}
  const kind = source.kind === 'local' ? 'local' : 'mock'
  const profile = {
    ...DEFAULT_PROVIDER,
    kind,
    model: typeof source.model === 'string' ? source.model : DEFAULT_PROVIDER.model,
    language: typeof source.language === 'string' ? source.language : DEFAULT_PROVIDER.language,
  }
  for (const key of ['localModelPath', 'localPythonPath']) {
    if (typeof source[key] === 'string') profile[key] = source[key]
  }
  if (['auto', 'cpu', 'cuda'].includes(source.localDevice)) profile.localDevice = source.localDevice
  if (['original', 'vocal', 'auto'].includes(source.localSource)) profile.localSource = source.localSource
  if (typeof source.useVocalSeparation === 'boolean') profile.useVocalSeparation = source.useVocalSeparation
  return profile
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
    renderJobs.cancelOwned(window, cancelRenderJob)
    transcriptionJobs.cancelOwned(window, cancelTranscriptionJob)
    separationJobs.cancelOwned(window, cancelTranscriptionJob)
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
    const profile = normalizeProviderProfile(value.profile)
    const legacyCredentials = Object.hasOwn(value, 'encryptedApiKey')
    const legacyProfile = value.profile?.kind === 'deepgram' || value.profile?.kind === 'custom' || Object.hasOwn(value.profile || {}, 'endpoint')
    if (legacyCredentials || legacyProfile) await writeSettings(profile)
    return { profile }
  } catch {
    return { profile: { ...DEFAULT_PROVIDER } }
  }
}

async function writeSettings(profile) {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true })
  await fs.writeFile(settingsFile(), JSON.stringify({ profile: normalizeProviderProfile(profile) }, null, 2), 'utf8')
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

function spawnLocalWorker(args, onProgress, job, preferredExecutable) {
  const worker = localWhisperWorker()
  const candidates = pythonCandidates(preferredExecutable)
  const isHealthCheck = args.includes('--health-check')
  return new Promise((resolve, reject) => {
    let index = 0
    let settled = false
    let lastError
    let bestHealthResult
    let timeout
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      job.abortController.signal.removeEventListener('abort', abortCurrent)
      error ? reject(error) : resolve(value)
    }
    const abortCurrent = () => {
      lastError = new Error('Đã hủy nhận dạng.')
      if (job.child && !job.child.killed) job.child.kill()
      else if (!job.child) finish(lastError)
    }
    timeout = setTimeout(() => {
      if (settled) return
      lastError = new Error('Nhận dạng local vượt quá thời gian chờ 30 phút.')
      if (job.child && !job.child.killed) job.child.kill()
      else finish(lastError)
    }, 30 * 60 * 1000)
    job.abortController.signal.addEventListener('abort', abortCurrent, { once: true })
    if (job.canceled) return abortCurrent()
    const start = () => {
      if (settled) return
      if (index >= candidates.length) {
        if (isHealthCheck && bestHealthResult) return finish(null, bestHealthResult)
        finish(lastError || new Error('Không tìm thấy Python runtime để chạy timestamp local.'))
        return
      }
      const candidate = candidates[index++]
      job.executable = candidate.executable
      const child = spawn(candidate.executable, [...candidate.prefix, worker, ...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      job.child = child
      let spawnFailed = false
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
            if (message.type === 'progress') onProgress?.(message)
            if (message.type === 'result') {
              if (!isHealthCheck) return finish(null, message)
              const score = Number(Boolean(message.pythonSupported)) * 2 + Number(Boolean(message.runtimeReady)) * 4 + Number(Boolean(message.stableWhisper?.available)) * 2 + Number(Boolean(message.demucs?.available))
              const bestScore = bestHealthResult ? Number(Boolean(bestHealthResult.pythonSupported)) * 2 + Number(Boolean(bestHealthResult.runtimeReady)) * 4 + Number(Boolean(bestHealthResult.stableWhisper?.available)) * 2 + Number(Boolean(bestHealthResult.demucs?.available)) : -1
              if (score > bestScore) bestHealthResult = message
              const requirement = job.runtimeRequirement || 'fasterWhisper'
              const requirementReady = requirement === 'directAlignment'
                ? message.runtimeReady && message.stableWhisper?.available
                : requirement === 'demucs'
                  ? message.demucs?.available
                  : message.runtimeReady
              if (message.pythonSupported && requirementReady) return finish(null, message)
              if (index >= candidates.length) return finish(null, bestHealthResult)
            }
            if (message.type === 'error') {
              lastError = new Error(message.message || 'Local timestamp worker thất bại.')
              lastError.code = message.code
            }
          } catch { /* ignore non-JSON worker output */ }
        }
      })
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-16384) })
      child.once('error', (error) => {
        spawnFailed = true
        lastError = error
        if (error.code === 'ENOENT') start()
        else finish(error)
      })
      child.once('close', (code) => {
        if (settled || spawnFailed) return
        if (job.canceled) {
          finish(lastError || new Error('Đã hủy nhận dạng.'))
          return
        }
        if (isHealthCheck && code === 0 && bestHealthResult && index < candidates.length) start()
        else if (lastError && ['runtime-missing', 'runtime-unsupported'].includes(lastError.code) && index < candidates.length) {
          lastError = undefined
          start()
        } else if (code === 0 && !lastError) finish(new Error('Worker local kết thúc mà không trả kết quả.'))
        else if (lastError) finish(lastError)
        else finish(new Error(stderr.trim().split(/\r?\n/).at(-1) || `Worker local kết thúc với mã ${code}.`))
      })
    }
    start()
  })
}

async function callLocalWhisper(profile, audioPath, lyricsText, onProgress, job) {
  ensureFile(audioPath)
  if (!fsSync.existsSync(localWhisperWorker())) throw new Error('Không tìm thấy worker timestamp local trong ứng dụng.')
  const requestedModel = profile.localModelPath || profile.model
  const model = profile.localModelPath || (['tiny', 'base', 'small', 'medium', 'large-v3-turbo'].includes(requestedModel) ? requestedModel : 'small')
  const args = ['--audio', ensureFile(audioPath), '--model', model, '--language', profile.language || 'vi', '--device', profile.localDevice || 'auto']
  let lyricsDirectory
  if (lyricsText?.trim()) {
    lyricsDirectory = await fs.mkdtemp(path.join(app.getPath('temp'), 'kara-lyrics-'))
    const lyricsFile = path.join(lyricsDirectory, 'lyrics.txt')
    await fs.writeFile(lyricsFile, lyricsText, 'utf8')
    args.push('--lyrics-file', lyricsFile)
  }
  let result
  try {
    result = await spawnLocalWorker(args, onProgress, job, profile.localPythonPath)
  } finally {
    if (lyricsDirectory) await fs.rm(lyricsDirectory, { recursive: true, force: true })
  }
  if (!Array.isArray(result.segments)) throw new Error('Worker local trả về dữ liệu timestamp không hợp lệ.')
  return { duration: result.duration, segments: result.segments, timingMethod: result.timingMethod, device: result.device, deviceFallbackReason: result.deviceFallbackReason }
}

async function separateVocals(audioPath, preferredExecutable, job) {
  const source = ensureFile(audioPath)
  const stats = await fs.stat(source)
  const key = require('node:crypto').createHash('sha256').update(`${path.resolve(source)}\0${stats.size}\0${stats.mtimeMs}`).digest('hex')
  const cacheRoot = path.join(app.getPath('userData'), 'separation-cache', key)
  const outputRoot = path.join(cacheRoot, 'demucs-output')
  const basename = path.basename(source, path.extname(source))
  const modelDirectory = path.join(outputRoot, 'htdemucs', basename)
  const vocalsPath = path.join(modelDirectory, 'vocals.wav')
  const instrumentalPath = path.join(modelDirectory, 'no_vocals.wav')
  try {
    if ((await fs.stat(vocalsPath)).size && (await fs.stat(instrumentalPath)).size) return { vocalsPath, instrumentalPath, cacheHit: true }
  } catch {}
  const runtime = await checkLocalRuntime({ localPythonPath: preferredExecutable }, 'demucs')
  if (!runtime.pythonSupported) throw new Error('Demucs cần Python 3.10–3.12 theo runtime hiện tại.')
  if (!runtime.demucs?.available) {
    if (runtime.demucs?.version) throw new Error(`Demucs đã có nhưng runtime thiếu dependency: ${runtime.demucs.error || 'không thể import module'}.`)
    throw new Error('Chưa cài Demucs trong Python runtime đã chọn. Cài bằng: python -m pip install demucs')
  }
  const candidates = pythonCandidates(preferredExecutable)
  await fs.mkdir(cacheRoot, { recursive: true })
  await fs.rm(modelDirectory, { recursive: true, force: true })
  const args = ['-m', 'demucs', '--two-stems=vocals', '--name', 'htdemucs', '--out', outputRoot, source]
  await new Promise((resolve, reject) => {
    let index = 0
    let settled = false
    let lastError
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      job.abortController.signal.removeEventListener('abort', abort)
      error ? reject(error) : resolve()
    }
    const abort = () => {
      lastError = new Error('Đã hủy tách vocal.')
      if (job.child && !job.child.killed) job.child.kill()
      else finish(lastError)
    }
    const timeout = setTimeout(() => {
      lastError = new Error('Tách vocal quá 2 giờ và đã dừng.')
      if (job.child && !job.child.killed) job.child.kill()
      else finish(lastError)
    }, 2 * 60 * 60 * 1000)
    job.abortController.signal.addEventListener('abort', abort, { once: true })
    const start = () => {
      if (settled || job.canceled) return abort()
      if (index >= candidates.length) return finish(lastError || new Error('Không tìm được Python runtime để chạy Demucs.'))
      const candidate = candidates[index++]
      job.executable = candidate.executable
      const child = spawn(candidate.executable, [...candidate.prefix, ...args], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      job.child = child
      let spawnFailed = false
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-12000) })
      child.once('error', (error) => {
        spawnFailed = true
        lastError = error
        if (error.code === 'ENOENT') start()
        else finish(error)
      })
      child.once('close', (code) => {
        if (settled || spawnFailed) return
        if (job.canceled) return finish(new Error('Đã hủy tách vocal.'))
        if (code === 0) return finish(null)
        finish(new Error(stderr.trim().split(/\r?\n/).at(-1) || `Demucs kết thúc với mã ${code}.`))
      })
    }
    start()
  })
  if (job.canceled) throw new Error('Đã hủy tách vocal.')
  if (!(await fs.stat(vocalsPath)).size || !(await fs.stat(instrumentalPath)).size) throw new Error('Demucs kết thúc nhưng không tạo đủ hai stem WAV.')
  return { vocalsPath, instrumentalPath, cacheHit: false }
}

async function checkLocalRuntime(profile = {}, runtimeRequirement = 'directAlignment') {
  if (!fsSync.existsSync(localWhisperWorker())) throw new Error('Không tìm thấy worker timestamp local trong ứng dụng.')
  const job = { child: null, canceled: false, abortController: new AbortController(), runtimeRequirement }
  const result = await spawnLocalWorker(['--health-check'], undefined, job, profile.localPythonPath)
  if (!result.healthCheck || !result.pythonVersion || !result.fasterWhisper) throw new Error('Python runtime trả về báo cáo kiểm tra không hợp lệ.')
  let manifest = null
  let manifestLoaded = false
  const manifestCandidates = [
    path.join(process.resourcesPath, 'local-runtime-manifest.json'),
    path.join(__dirname, 'local-runtime-manifest.json'),
  ]
  for (const manifestPath of manifestCandidates) {
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      manifestLoaded = true
      break
    } catch {}
  }
  return { ...result, manifest, manifestLoaded, pythonExecutable: result.pythonExecutable || job.executable }
}

async function callProvider(profile, audioPath, lyricsText, onProgress, job) {
  if (profile.kind === 'mock') return mockTranscript(lyricsText)
  if (profile.kind === 'local') return callLocalWhisper(profile, audioPath, lyricsText, onProgress, job)
  throw new Error('Provider không được hỗ trợ. Hãy chọn Demo offline hoặc Whisper local.')
}


function resolveFfmpegPath() {
  const candidates = []
  try {
    const packagePath = require('ffmpeg-static')
    if (typeof packagePath === 'string') {
      candidates.push(packagePath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`))
      candidates.push(packagePath)
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
    child.once('error', (error) => reject(new Error(`Không thể khởi động FFmpeg (${error.code ?? 'unknown'}): ${error.message}`)))
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
      if (!supportsRequiredEncoders(encoders)) throw new Error('FFmpeg đi kèm thiếu bộ mã hóa H.264 hoặc AAC cần thiết.')
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
    await Promise.all([fs.rm(subtitlePath, { force: true }), fs.rm(tempPath, { force: true })])
  }
}

function registerIpc() {
  ipcMain.handle('pick-file', async (_event, kind) => {
    const filters = kind === 'lyrics'
      ? [{ name: 'Lyrics / subtitles', extensions: ['txt', 'lrc', 'srt', 'ass', 'ssa'] }]
      : kind === 'background'
        ? [{ name: 'Video background', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }]
        : [{ name: kind === 'vocal' ? 'Vocal stem' : 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm'] }]
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
  ipcMain.handle('waveform', async (_event, filePath) => {
    const image = await extractWaveform(await getUsableFfmpeg(), ensureFile(filePath))
    return `data:image/png;base64,${image.toString('base64')}`
  })
  ipcMain.handle('extract-video-audio', async (_event, filePath) => {
    const source = ensureFile(filePath)
    const ffmpegPath = await getUsableFfmpeg()
    const directory = path.join(app.getPath('userData'), 'extracted-video-audio')
    await fs.mkdir(directory, { recursive: true })
    const stats = await fs.stat(source)
    const key = require('node:crypto').createHash('sha256').update(`${path.resolve(source)}\0${stats.size}\0${stats.mtimeMs}`).digest('hex')
    const output = path.join(directory, `${key}.wav`)
    try {
      const cached = await fs.stat(output)
      if (cached.size) return { path: output, displayName: `${path.basename(source, path.extname(source))} · audio.wav`, mimeType: 'audio/wav', url: `kara-media://local/${encodeURIComponent(output)}` }
    } catch {}
    const tempOutput = path.join(directory, `${randomUUID()}.tmp.wav`)
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, ['-nostdin', '-y', '-i', source, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '16000', '-c:a', 'pcm_s16le', tempOutput], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-8000) })
      child.once('error', reject)
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.includes('matches no streams') || stderr.includes('does not contain any stream') ? 'Video này không có track audio.' : `Không trích được audio từ video: ${stderr.trim().slice(-1200)}`)))
    })
    try {
      const extracted = await fs.stat(tempOutput)
      if (!extracted.size) throw new Error('Video không có track audio hợp lệ.')
      await fs.rename(tempOutput, output)
    } finally { await fs.rm(tempOutput, { force: true }) }
    return { path: output, displayName: `${path.basename(source, path.extname(source))} · audio.wav`, mimeType: 'audio/wav', url: `kara-media://local/${encodeURIComponent(output)}` }
  })
  ipcMain.handle('prepare-video-preview', async (_event, filePath) => {
    const source = ensureFile(filePath)
    const stats = await fs.stat(source)
    const key = require('node:crypto').createHash('sha256').update(`${path.resolve(source)}\0${stats.size}\0${stats.mtimeMs}\0preview-h264-v2`).digest('hex')
    const directory = path.join(app.getPath('userData'), 'video-preview-cache')
    const output = path.join(directory, `${key}.mp4`)
    try {
      const cached = await fs.stat(output)
      if (cached.size) return pathToFileURL(output).toString()
    } catch {}
    const active = videoPreviewJobs.get(key)
    if (active) return active
    const operation = (async () => {
      const ffmpegPath = await getUsableFfmpeg()
      const encoders = await captureProcessOutput(ffmpegPath, ['-hide_banner', '-encoders'])
      if (!supportsBrowserPreviewEncoders(encoders)) throw new Error('FFmpeg đi kèm thiếu bộ mã hóa H.264/AAC để tạo video xem trước tương thích.')
      await fs.mkdir(directory, { recursive: true })
      const tempOutput = path.join(directory, `${randomUUID()}.tmp.mp4`)
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(ffmpegPath, buildVideoPreviewArgs({ sourcePath: source, outputPath: tempOutput }), { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
          let stderr = ''
          child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-8000) })
          child.once('error', (error) => reject(new Error(`Không thể khởi động FFmpeg (${error.code ?? 'unknown'}): ${error.message}`)))
          child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`Không tạo được video xem trước: ${stderr.trim().slice(-1200)}`)))
        })
        const preview = await fs.stat(tempOutput)
        if (!preview.size) throw new Error('FFmpeg không tạo được video xem trước hợp lệ.')
        await fs.rename(tempOutput, output)
      } finally {
        await fs.rm(tempOutput, { force: true })
      }
      return pathToFileURL(output).toString()
    })()
    videoPreviewJobs.set(key, operation)
    try { return await operation } finally { if (videoPreviewJobs.get(key) === operation) videoPreviewJobs.delete(key) }
  })
  ipcMain.handle('media-fingerprint', async (_event, filePath) => getTranscriptionCache().fingerprintFor(ensureFile(filePath)))
  ipcMain.handle('media-signature', async (_event, filePath) => {
    const stats = fsSync.statSync(ensureFile(filePath))
    return { size: stats.size, modifiedAtMs: stats.mtimeMs }
  })
  ipcMain.handle('load-cached-transcript', async (_event, key) => {
    if (typeof key !== 'string' || !/^[a-f\d]{64}$/i.test(key)) return null
    return getTranscriptionCache().read(key)
  })
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
  ipcMain.handle('load-recovery-project', () => getRecoveryStore().load())
  ipcMain.handle('save-recovery-project', (_event, project) => getRecoveryStore().save(project))
  ipcMain.handle('clear-recovery-project', () => getRecoveryStore().clear())
  ipcMain.handle('save-export', async (_event, format, content, suggestedName) => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
    if (result.canceled || !result.filePath) return null
    const target = result.filePath.toLowerCase().endsWith(`.${format}`) ? result.filePath : `${result.filePath}.${format}`
    await fs.writeFile(target, content, 'utf8')
    return { path: target }
  })
  ipcMain.handle('load-provider-settings', async () => {
    const settings = await readSettings()
    return { profile: settings.profile }
  })
  ipcMain.handle('save-provider-settings', async (_event, profile) => writeSettings(profile))
  ipcMain.handle('pick-runtime-path', async (event, kind) => {
    if (!['python', 'model'].includes(kind)) throw new Error('Loại đường dẫn không hợp lệ.')
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(owner, kind === 'model'
      ? { title: 'Chọn thư mục model Whisper', properties: ['openDirectory'] }
      : { title: 'Chọn Python runtime', properties: ['openFile'], filters: [{ name: 'Python', extensions: ['exe'] }] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('check-local-runtime', async (_event, profile) => checkLocalRuntime(profile))
  ipcMain.handle('separate-vocals', async (event, jobId, audioPath, preferredPython) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (typeof jobId !== 'string' || !jobId || !owner || owner.isDestroyed()) throw new Error('Yêu cầu tách vocal không hợp lệ.')
    const job = { id: jobId, owner, child: null, canceled: false, abortController: new AbortController(), finished: null }
    separationJobs.register(job)
    try {
      const operation = separateVocals(audioPath, preferredPython, job)
      job.finished = operation
      const result = await operation
      if (job.canceled) throw new Error('Đã hủy tách vocal.')
      return { ...result, vocalsUrl: `kara-media://local/${encodeURIComponent(ensureFile(result.vocalsPath))}`, instrumentalUrl: `kara-media://local/${encodeURIComponent(ensureFile(result.instrumentalPath))}` }
    } finally {
      separationJobs.finish(job)
      separationJobs.delete(jobId)
    }
  })
  ipcMain.handle('cancel-separation', (event, jobId) => {
    const job = separationJobs.get(jobId)
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (job && owner && job.owner === owner) cancelTranscriptionJob(job)
  })
  ipcMain.handle('transcribe', async (event, jobId, profile, audioPath, lyricsText) => {
    profile = normalizeProviderProfile(profile)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const job = { id: jobId, owner, child: null, canceled: false, abortController: new AbortController(), finished: null }
    if (typeof jobId !== 'string' || !jobId) throw new Error('Mã nhận dạng không hợp lệ hoặc đang được sử dụng.')
    if (!owner || owner.isDestroyed()) throw new Error('Cửa sổ nhận dạng không còn hoạt động.')
    transcriptionJobs.register(job)
    try {
      let cacheKey
      let audioFingerprint
      let audioSignature
      let cachePersisted = false
      try {
        const cache = getTranscriptionCache()
        const resolvedAudioPath = ensureFile(audioPath)
        audioFingerprint = await cache.fingerprintFor(resolvedAudioPath)
        const stats = fsSync.statSync(resolvedAudioPath)
        audioSignature = { size: stats.size, modifiedAtMs: stats.mtimeMs }
        cacheKey = await cache.keyFor(resolvedAudioPath, profile, lyricsText, '', app.getVersion(), audioFingerprint)
        const cached = await getTranscriptionCache().read(cacheKey)
        if (cached) {
          if (job.canceled) throw new Error('Đã hủy nhận dạng.')
          return { ...cached, cacheHit: true, audioFingerprint, audioSignature, transcriptCacheKey: cacheKey }
        }
      } catch (error) {
        if (job.canceled) throw error
        cacheKey = undefined
      }
      const operation = callProvider(profile, audioPath, lyricsText, (progress) => {
        if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed()) return
        owner.webContents.send('transcribe-progress', { jobId, ...progress })
      }, job)
      job.finished = operation
      const result = await operation
      if (job.canceled) throw new Error('Đã hủy nhận dạng.')
      if (cacheKey) cachePersisted = await getTranscriptionCache().write(cacheKey, result).then(() => true, () => false)
      return { ...result, cacheHit: false, audioFingerprint, audioSignature, transcriptCacheKey: cachePersisted ? cacheKey : undefined }
    } finally {
      transcriptionJobs.finish(job)
      transcriptionJobs.delete(jobId)
    }
  })
  ipcMain.handle('cancel-transcribe', (event, jobId) => {
    const job = transcriptionJobs.get(jobId)
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (job && owner && job.owner === owner) {
      job.canceled = true
      job.abortController.abort()
      if (job.child && !job.child.killed) job.child.kill()
    }
  })
  ipcMain.handle('start-render', async (event, rawRequest) => {
    const request = validateRenderRequest(rawRequest)
    if (renderJobs.has(request.jobId)) throw new Error('Render này đang chạy.')
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || owner.isDestroyed()) throw new Error('Cửa sổ render không còn hoạt động.')
    const job = { id: request.jobId, owner, outputPath: null, tempPath: null, subtitlePath: null, child: null, canceled: false, closed: false, ffmpegClosed: false, finished: null }
    renderJobs.register(job)
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
        renderJobs.finish(job)
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
    const mimeType = path.extname(target).toLowerCase() === '.webm'
      ? 'video/webm'
      : path.extname(target).toLowerCase() === '.wav'
        ? 'audio/wav'
        : undefined
    return net.fetch(pathToFileURL(target).toString()).then((response) => {
      if (!mimeType || !response.ok) return response
      const headers = new Headers(response.headers)
      headers.set('content-type', mimeType)
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    })
  })
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('before-quit', (event) => {
  const jobs = [...renderJobs.values()]
  const transcriptionTasks = [...transcriptionJobs.values()]
  const separationTasks = [...separationJobs.values()]
  if ((!jobs.length && !transcriptionTasks.length && !separationTasks.length) || quitRequested) return
  quitRequested = true
  event.preventDefault()
  renderJobs.cancelAll(cancelRenderJob)
  transcriptionJobs.cancelAll(cancelTranscriptionJob)
  separationJobs.cancelAll(cancelTranscriptionJob)
  void Promise.all([renderJobs.waitForIdle(), transcriptionJobs.waitForIdle(), separationJobs.waitForIdle()]).then(() => app.quit())
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
