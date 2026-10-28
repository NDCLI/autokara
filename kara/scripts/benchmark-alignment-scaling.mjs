#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lineCounts = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : [100, 300, 600, 1000]
if (lineCounts.some((count) => !Number.isInteger(count) || count < 1 || count > 5000)) {
  process.stderr.write('Số dòng cần là số nguyên trong khoảng 1–5000.\n')
  process.exit(2)
}

function makeDataset(lineCount) {
  const vocabulary = ['mình', 'cùng', 'hát', 'vang']
  const wordsPerLine = vocabulary.length
  const lineDuration = 1.5
  const lines = []
  const transcriptWords = []
  const referenceWords = []
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const start = lineIndex * lineDuration
    const text = vocabulary.join(' ')
    lines.push({ text, start, end: start + 1 })
    for (let wordIndex = 0; wordIndex < wordsPerLine; wordIndex += 1) {
      const wordStart = start + wordIndex * 0.2
      const wordEnd = wordStart + 0.15
      transcriptWords.push({
        id: `w-${lineIndex}-${wordIndex}`,
        text: vocabulary[wordIndex],
        start: wordStart,
        end: wordEnd,
        confidence: 0.95,
      })
      referenceWords.push({ lineIndex, text: vocabulary[wordIndex], start: wordStart, end: wordEnd })
    }
  }
  const duration = lineCount * lineDuration
  return {
    name: `synthetic-scaling-${lineCount}-lines`,
    samples: [{
      id: `synthetic-${lineCount}`,
      duration,
      lines,
      transcript: {
        segments: [{
          id: 'synthetic-asr',
          text: lines.map((line) => line.text).join(' '),
          start: 0,
          end: duration,
          confidence: 0.95,
          words: transcriptWords,
        }],
      },
      referenceWords,
    }],
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

let server
try {
  server = await createServer({ configFile: false, root, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' })
  const { benchmarkAlignment } = await server.ssrLoadModule('/src/engine/alignmentBenchmark.ts')
  const results = []
  for (const lineCount of lineCounts) {
    const dataset = makeDataset(lineCount)
    benchmarkAlignment(dataset) // warm Vite SSR and JS execution before collecting timings
    const currentRuns = []
    const legacyRuns = []
    for (let run = 0; run < 3; run += 1) {
      const report = benchmarkAlignment(dataset)
      currentRuns.push(report.samples[0].processingSeconds)
      legacyRuns.push(report.baseline.samples[0].processingSeconds)
    }
    const currentSeconds = median(currentRuns)
    const legacySeconds = median(legacyRuns)
    results.push({
      lines: lineCount,
      transcriptWords: lineCount * 4,
      durationSeconds: lineCount * 1.5,
      runs: currentRuns.length,
      currentMedianSeconds: currentSeconds,
      legacyMedianSeconds: legacySeconds,
      currentMedianRatio: Math.round(currentSeconds / (lineCount * 1.5) * 1_000_000) / 1_000_000,
      legacyMedianRatio: Math.round(legacySeconds / (lineCount * 1.5) * 1_000_000) / 1_000_000,
    })
  }
  process.stdout.write(`${JSON.stringify({
    kind: 'synthetic-scaling-only',
    note: 'Performance fixture only; repeated identical lines are not a quality benchmark and are not evidence of real-song accuracy.',
    results,
  }, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await server?.close()
}
