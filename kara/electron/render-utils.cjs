const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')

function escapeFilterPath(value) {
  return path.resolve(value)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function comparablePath(value) {
  const resolved = path.resolve(value)
  try {
    return fs.realpathSync.native(resolved).toLowerCase()
  } catch {
    return resolved.toLowerCase()
  }
}

function assertOutputDoesNotMatchInputs(outputPath, audioPath, backgroundPath) {
  const output = comparablePath(outputPath)
  const inputs = [audioPath, backgroundPath].filter((value) => typeof value === 'string' && value.length > 0)
  if (inputs.some((input) => comparablePath(input) === output)) {
    throw new Error('File output không được trùng với file audio hoặc video nền.')
  }
}

async function publishRenderOutput(tempPath, outputPath, { isCanceled = () => false } = {}) {
  const backupPath = `${outputPath}.${process.pid}.${Date.now()}.kara-backup`
  let backedUp = false
  let published = false
  try {
    if (isCanceled()) return { status: 'canceled' }
    try {
      await fsp.rename(outputPath, backupPath)
      backedUp = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (isCanceled()) {
      if (backedUp) await fsp.rename(backupPath, outputPath)
      return { status: 'canceled' }
    }
    await fsp.rename(tempPath, outputPath)
    published = true
    if (backedUp) await fsp.rm(backupPath, { force: true }).catch(() => {})
    return { status: 'done', path: outputPath }
  } catch (error) {
    if (backedUp && !published) {
      try {
        await fsp.rename(backupPath, outputPath)
      } catch (restoreError) {
        error.restoreError = restoreError
      }
    }
    throw error
  }
}

function validateVideo(video) {
  if (!video || !Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width < 16 || video.height < 16 || video.width > 3840 || video.height > 2160 || video.width % 2 || video.height % 2) {
    throw new Error('Kích thước video không hợp lệ.')
  }
  if (typeof video.backgroundColor !== 'string' || !/^#[\da-f]{6}$/i.test(video.backgroundColor)) {
    throw new Error('Màu nền video không hợp lệ.')
  }
}

function supportsRequiredEncoders(encoderList) {
  return typeof encoderList === 'string'
    && /\blibx264\b/.test(encoderList)
    && /^\s*A[A-Z.]{5}\s+aac\b/m.test(encoderList)
}

function supportsBrowserPreviewEncoders(encoderList) {
  return supportsRequiredEncoders(encoderList)
}

function buildVideoPreviewArgs({ sourcePath, outputPath }) {
  return [
    '-hide_banner', '-nostdin', '-y', '-i', path.resolve(sourcePath),
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    '-vf', 'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=20',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-threads', '2', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4',
    path.resolve(outputPath),
  ]
}

function buildFfmpegArgs({ audioPath, backgroundPath, subtitlePath, outputPath, video }) {
  validateVideo(video)
  const color = video.backgroundColor.slice(1)
  const subtitleFilter = `subtitles=filename='${escapeFilterPath(subtitlePath)}'`
  const backgroundFilter = `scale=${video.width}:${video.height}:force_original_aspect_ratio=decrease,pad=${video.width}:${video.height}:(ow-iw)/2:(oh-ih)/2:color=0x${color}`
  const inputArgs = backgroundPath
    ? ['-stream_loop', '-1', '-i', path.resolve(backgroundPath), '-i', path.resolve(audioPath), '-map', '0:v:0', '-map', '1:a:0', '-vf', `${backgroundFilter},${subtitleFilter}`]
    : ['-f', 'lavfi', '-i', `color=c=0x${color}:s=${video.width}x${video.height}:r=30`, '-i', path.resolve(audioPath), '-vf', subtitleFilter]
  return [
    '-hide_banner', '-y',
    ...inputArgs,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    path.resolve(outputPath),
  ]
}

function parseClock(value) {
  const match = String(value).match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || '0'}`)
}

function parseProgressLine(line, duration) {
  if (typeof line !== 'string') return null
  const [key, value] = line.trim().split('=', 2)
  if (!key || value === undefined) return null
  if (key === 'progress') return { percent: value === 'end' ? 100 : null, status: value === 'end' ? 'Hoàn tất mã hóa…' : null }
  if (key !== 'out_time' || !Number.isFinite(duration) || duration <= 0) return null
  const elapsed = parseClock(value)
  if (elapsed === null) return null
  const percent = Math.max(0, Math.min(99, Math.round(elapsed / duration * 100)))
  return { percent, status: `Đang mã hóa · ${percent}%` }
}

module.exports = { assertOutputDoesNotMatchInputs, buildFfmpegArgs, buildVideoPreviewArgs, escapeFilterPath, parseProgressLine, publishRenderOutput, supportsBrowserPreviewEncoders, supportsRequiredEncoders }
