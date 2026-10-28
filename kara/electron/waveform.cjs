const { spawn } = require('node:child_process')

const MAX_IMAGE_BYTES = 2 * 1024 * 1024

function extractWaveform(ffmpegPath, audioPath, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-i', audioPath,
      '-filter_complex', '[0:a:0]showwavespic=s=188x48:scale=lin:colors=#7763b5|#5d91a1[wave]', '-map', '[wave]',
      '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1',
    ], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    let size = 0
    let stderr = ''
    let settled = false
    const finish = (error, image) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve(image)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('Tạo waveform vượt quá 30 giây.'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_IMAGE_BYTES) {
        child.kill()
        finish(new Error('Ảnh waveform vượt quá giới hạn kích thước.'))
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4096) })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      if (settled) return
      const image = Buffer.concat(chunks)
      const isPng = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      if (code !== 0 || !isPng) finish(new Error(stderr.trim() || `FFmpeg không tạo được waveform (mã ${code}).`))
      else finish(null, image)
    })
  })
}

module.exports = { extractWaveform }
