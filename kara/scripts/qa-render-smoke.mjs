#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import ffmpegPath from 'ffmpeg-static'

const require = createRequire(import.meta.url)
const { buildFfmpegArgs } = require('../electron/render-utils.cjs')
const { extractWaveform } = require('../electron/waveform.cjs')
if (!ffmpegPath) throw new Error('Bundled FFmpeg executable is unavailable.')

const outputDir = process.env.KARA_RENDER_QA_DIR
  ? path.resolve(process.env.KARA_RENDER_QA_DIR)
  : await mkdtemp(path.join(os.tmpdir(), 'kara-render-smoke-'))
await mkdir(outputDir, { recursive: true })
const audioPath = path.join(outputDir, 'synthetic-audio.wav')
const subtitlePath = path.join(outputDir, 'karaoke.ass')
const outputPath = path.join(outputDir, 'karaoke-smoke.mp4')
const video = { width: 640, height: 360, backgroundColor: '#10162a', lyricPosition: { x: 0.5, y: 0.78 } }

execFileSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4.6',
  '-c:a', 'pcm_s16le', audioPath,
], { stdio: 'pipe' })
const waveform = await extractWaveform(ffmpegPath, audioPath)
if (waveform.readUInt32BE(16) !== 188 || waveform.readUInt32BE(20) !== 48) throw new Error('Waveform PNG has unexpected dimensions.')
await writeFile(path.join(outputDir, 'waveform-smoke.png'), waveform)

const server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' })
try {
  const { buildAss } = await server.ssrLoadModule('/src/lib/export/subtitles.ts')
  const { DEFAULT_EXPORT_OPTIONS } = await server.ssrLoadModule('/shared/contracts.ts')
  const segments = [
    { id: 'line-1', text: 'Câu đầu', start: 0.5, end: 1.5, speakerRole: 'female', words: [
      { id: 'w1', text: 'Câu', start: 0.5, end: 0.95 }, { id: 'w2', text: 'đầu', start: 1, end: 1.5 },
    ] },
    { id: 'line-2', text: 'Câu tiếp theo', start: 3.5, end: 4.5, speakerRole: 'male', words: [
      { id: 'w3', text: 'Câu', start: 3.5, end: 3.75 }, { id: 'w4', text: 'tiếp', start: 3.8, end: 4.05 }, { id: 'w5', text: 'theo', start: 4.1, end: 4.5 },
    ] },
  ]
  await writeFile(subtitlePath, buildAss(segments, { ...DEFAULT_EXPORT_OPTIONS, leadInMs: 0, leadOutMs: 0 }, video), 'utf8')
} finally {
  await server.close()
}

execFileSync(ffmpegPath, buildFfmpegArgs({ audioPath, subtitlePath, outputPath, video }), { stdio: 'pipe' })
const probe = spawnSync(ffmpegPath, ['-hide_banner', '-i', outputPath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
if (probe.status !== 0) throw new Error(probe.stderr || 'Could not decode the rendered MP4.')
const probeText = `${probe.stdout}\n${probe.stderr}`
const duration = Number(probeText.match(/Duration: (\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/)?.slice(1).reduce((seconds, part, index) => seconds + Number(part) * [3600, 60, 1][index], 0))
if (!/Video: h264/.test(probeText) || !/Audio: aac/.test(probeText) || !Number.isFinite(duration) || duration < 4.4) {
  throw new Error(`MP4 output did not contain expected H.264/AAC streams or duration: ${probeText.slice(0, 1200)}`)
}

const frames = [
  { file: 'karaoke-active-line.png', time: '0.90' },
  { file: 'karaoke-countdown.png', time: '2.00' },
  { file: 'karaoke-next-line.png', time: '3.75' },
]
for (const frame of frames) {
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', frame.time, '-i', outputPath, '-frames:v', '1', path.join(outputDir, frame.file)], { stdio: 'pipe' })
}
const report = { output: outputPath, durationSeconds: Math.round(duration * 1000) / 1000, videoCodec: 'h264', audioCodec: 'aac', waveform: { width: 188, height: 48, output: path.join(outputDir, 'waveform-smoke.png') }, frames: frames.map((frame) => path.join(outputDir, frame.file)) }
await writeFile(path.join(outputDir, 'render-smoke-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
