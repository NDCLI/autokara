const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')

const CACHE_VERSION = 1

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fsSync.createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function stableProfile(profile) {
  return {
    kind: profile.kind,
    model: profile.model,
    language: profile.language,
    localModelPath: profile.localModelPath,
    localPythonPath: profile.localPythonPath,
    localDevice: profile.localDevice,
    useForcedAlignment: profile.useForcedAlignment,
    alignmentModelPath: profile.alignmentModelPath,
    localSource: profile.localSource,
  }
}

function isTranscriptResult(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.segments)) return false
  if (value.timingMethod !== undefined && !['asr', 'forced-alignment'].includes(value.timingMethod)) return false
  if (value.device !== undefined && !['cpu', 'cuda'].includes(value.device)) return false
  return value.segments.every((segment) => segment && typeof segment.id === 'string' && typeof segment.text === 'string'
    && Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.start >= 0 && segment.end > segment.start
    && Array.isArray(segment.words) && segment.words.every((word) => word && typeof word.id === 'string' && typeof word.text === 'string'
      && Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end > word.start
      && (word.confidence === undefined || (Number.isFinite(word.confidence) && word.confidence >= 0 && word.confidence <= 1)))
    && (segment.confidence === undefined || (Number.isFinite(segment.confidence) && segment.confidence >= 0 && segment.confidence <= 1)))
}

function createTranscriptionCache({ directory, maxEntries = 100, maxBytes = 512 * 1024 * 1024 }) {
  let operationQueue = Promise.resolve()
  function serialize(operation) {
    const pending = operationQueue.then(operation, operation)
    operationQueue = pending.then(() => undefined, () => undefined)
    return pending
  }

  async function touch(target) {
    let latest = BigInt(Date.now()) * 1_000_000n
    let entries
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { entries = [] }
    for (const item of entries) {
      if (!item.isFile() || !/^[a-f\d]{64}\.json$/.test(item.name)) continue
      try {
        const stats = await fs.stat(path.join(directory, item.name), { bigint: true })
        if (stats.mtimeNs > latest) latest = stats.mtimeNs
      } catch { /* entry may expire between listing and stat */ }
    }
    const next = latest + 1_000_000n
    const timestampSeconds = Number(next) / 1_000_000_000
    await fs.utimes(target, timestampSeconds, timestampSeconds)
  }

  async function keyFor(audioPath, profile, lyricsText, credentialScope = '', engineVersion = '', knownAudioHash) {
    const audioHash = knownAudioHash ?? await sha256File(audioPath)
    const input = JSON.stringify({ version: CACHE_VERSION, engineVersion, audioHash, profile: stableProfile(profile), lyricsText: lyricsText?.trim() ?? '', credentialScope })
    return crypto.createHash('sha256').update(input).digest('hex')
  }

  function entryPath(key) {
    if (!/^[a-f\d]{64}$/.test(key)) throw new Error('Cache key nhận dạng không hợp lệ.')
    return path.join(directory, `${key}.json`)
  }

  async function read(key) {
    return serialize(async () => {
      const target = entryPath(key)
      try {
        const entry = JSON.parse(await fs.readFile(target, 'utf8'))
        if (entry.version !== CACHE_VERSION || entry.key !== key || !isTranscriptResult(entry.result)) {
          await fs.rm(target, { force: true }).catch(() => {})
          return null
        }
        await touch(target).catch(() => {})
        return entry.result
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        await fs.rm(target, { force: true }).catch(() => {})
        return null
      }
    })
  }

  async function prune() {
    let entries
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { return }
    const files = []
    for (const item of entries) {
      if (!item.isFile() || !/^[a-f\d]{64}\.json$/.test(item.name)) continue
      const fullPath = path.join(directory, item.name)
      try {
        const stats = await fs.stat(fullPath, { bigint: true })
        files.push({ fullPath, mtime: stats.mtimeNs, size: stats.size })
      } catch { /* entry may have expired concurrently */ }
    }
    files.sort((a, b) => a.mtime === b.mtime ? 0 : b.mtime > a.mtime ? 1 : -1)
    let totalBytes = files.reduce((sum, item) => sum + item.size, 0n)
    for (let index = 0; index < files.length; index += 1) {
      const shouldDelete = index >= maxEntries || totalBytes > BigInt(maxBytes)
      if (!shouldDelete) continue
      await fs.rm(files[index].fullPath, { force: true }).catch(() => {})
      totalBytes -= files[index].size
    }
  }

  async function write(key, result) {
    return serialize(async () => {
      if (!isTranscriptResult(result)) throw new Error('Không thể cache transcript không hợp lệ.')
      await fs.mkdir(directory, { recursive: true })
      const target = entryPath(key)
      const temporary = `${target}.${crypto.randomUUID()}.tmp`
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: CACHE_VERSION, key, result }), 'utf8')
        await touch(temporary)
        await fs.rename(temporary, target)
        await prune()
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => {})
        throw error
      }
    })
  }

  return { fingerprintFor: sha256File, keyFor, read, write }
}

module.exports = { createTranscriptionCache }
