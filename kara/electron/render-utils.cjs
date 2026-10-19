const path = require('node:path')

function escapeFilterPath(value) {
  return path.resolve(value)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function validateVideo(video) {
  if (!video || !Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width < 16 || video.height < 16) {
    throw new Error('Kích thước video không hợp lệ.')
  }
  if (typeof video.backgroundColor !== 'string' || !/^#[\da-f]{6}$/i.test(video.backgroundColor)) {
    throw new Error('Màu nền video không hợp lệ.')
  }
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

module.exports = { buildFfmpegArgs, escapeFilterPath, parseProgressLine }
