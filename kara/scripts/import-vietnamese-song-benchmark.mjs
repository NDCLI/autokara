#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
if (args.includes('--help') || args.length !== 5) {
  process.stdout.write('Usage: node scripts/import-vietnamese-song-benchmark.mjs <metadata.jsonl> <asr-snapshots.jsonl> <song-split.json> <tuning|heldout> <output.json>\n')
  process.stdout.write('No audio is downloaded. ASR snapshots must be local and contain { chunk_id, transcript: { segments } }; split assignments apply to whole song_id values.\n')
  process.exit(args.includes('--help') ? 0 : 2)
}

const [metadataArg, asrArg, splitArg, selectedSplit, outputArg] = args
if (!['tuning', 'heldout'].includes(selectedSplit)) throw new Error('Split must be tuning or heldout.')
const metadataPath = path.resolve(metadataArg)
const asrPath = path.resolve(asrArg)
const splitPath = path.resolve(splitArg)
const outputPath = path.resolve(outputArg)

function fail(message) { throw new Error(message) }

function normalizedWords(value) {
  return String(value).toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '')
}

async function readJsonl(filePath, label, onRecord) {
  const lines = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity })
  let lineNumber = 0
  for await (const line of lines) {
    lineNumber += 1
    if (!line.trim()) continue
    let record
    try { record = JSON.parse(line) }
    catch { fail(`${label} JSONL line ${lineNumber} is invalid JSON.`) }
    await onRecord(record, lineNumber)
  }
}

const splitAssignments = JSON.parse(await readFile(splitPath, 'utf8'))
if (!splitAssignments || typeof splitAssignments !== 'object' || Array.isArray(splitAssignments)) fail('Song split file must be a JSON object: { "song_id": "tuning" | "heldout" }.')
for (const [songId, split] of Object.entries(splitAssignments)) {
  if (!songId || !['tuning', 'heldout'].includes(split)) fail(`Invalid split assignment for song_id ${songId}.`)
}

const asrByChunk = new Map()
await readJsonl(asrPath, 'ASR snapshot', (record, lineNumber) => {
  if (!record || typeof record.chunk_id !== 'string' || !record.chunk_id.trim() || !record.transcript || !Array.isArray(record.transcript.segments)) {
    fail(`ASR snapshot line ${lineNumber} must contain chunk_id and a normalized transcript.segments array.`)
  }
  if (asrByChunk.has(record.chunk_id)) fail(`Duplicate ASR snapshot for ${record.chunk_id}.`)
  asrByChunk.set(record.chunk_id, record.transcript)
})

const samples = []
const songIds = new Set()
const matchedChunks = new Set()
const chunkToSong = new Map()
await readJsonl(metadataPath, 'Song metadata', (record, lineNumber) => {
  if (!record || typeof record.chunk_id !== 'string' || typeof record.song_id !== 'string') fail(`Song metadata line ${lineNumber} needs chunk_id and song_id.`)
  if (chunkToSong.has(record.chunk_id)) fail(`Duplicate song metadata chunk ${record.chunk_id}.`)
  chunkToSong.set(record.chunk_id, record.song_id)
  const assignedSplit = splitAssignments[record.song_id]
  if (assignedSplit === undefined) fail(`No tuning/heldout assignment for song_id ${record.song_id}.`)
  if (assignedSplit !== selectedSplit) return

  const transcript = asrByChunk.get(record.chunk_id)
  if (!transcript) fail(`No local ASR snapshot found for selected chunk ${record.chunk_id}.`)
  const chunkStartMs = Number(record.chunk_start_ms)
  const chunkEndMs = Number(record.chunk_end_ms)
  if (!Number.isFinite(chunkStartMs) || !Number.isFinite(chunkEndMs) || chunkEndMs <= chunkStartMs) fail(`Invalid chunk bounds for ${record.chunk_id}.`)
  if (typeof record.chunk_lyrics !== 'string' || !Array.isArray(record.chunk_word_timestamps)) fail(`Missing lyric/timing labels for ${record.chunk_id}.`)

  const lyricLines = record.chunk_lyrics.split(/\r?\n/).filter((line) => line.trim())
  if (lyricLines.length !== record.chunk_word_timestamps.length) fail(`Lyric line count does not match timing line count for ${record.chunk_id}.`)
  const lines = []
  const referenceWords = []
  for (let lineIndex = 0; lineIndex < lyricLines.length; lineIndex += 1) {
    const text = lyricLines[lineIndex].trim()
    const tokens = text.split(/\s+/)
    const timedWords = record.chunk_word_timestamps[lineIndex]
    if (!Array.isArray(timedWords) || timedWords.length !== tokens.length) fail(`Lyric token count does not match word labels for ${record.chunk_id}, line ${lineIndex + 1}.`)
    const converted = timedWords.map((word, wordIndex) => {
      const startMs = Number(word?.start)
      const endMs = Number(word?.end)
      if (typeof word?.word !== 'string' || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) fail(`Invalid word label for ${record.chunk_id}, line ${lineIndex + 1}, word ${wordIndex + 1}.`)
      if (normalizedWords(word.word) !== normalizedWords(tokens[wordIndex])) fail(`Word text does not match lyric for ${record.chunk_id}, line ${lineIndex + 1}, word ${wordIndex + 1}.`)
      return { lineIndex, text: word.word, start: (startMs - chunkStartMs) / 1000, end: (endMs - chunkStartMs) / 1000 }
    })
    const start = Math.min(...converted.map((word) => word.start))
    const end = Math.max(...converted.map((word) => word.end))
    if (start < 0 || end > (chunkEndMs - chunkStartMs) / 1000 + 0.05) fail(`Word label falls outside chunk bounds for ${record.chunk_id}, line ${lineIndex + 1}.`)
    lines.push({ text, start, end })
    referenceWords.push(...converted)
  }

  samples.push({
    id: record.chunk_id,
    duration: (chunkEndMs - chunkStartMs) / 1000,
    lines,
    transcript,
    referenceWords,
  })
  songIds.add(record.song_id)
  matchedChunks.add(record.chunk_id)
})

if (!samples.length) fail(`No chunks matched split "${selectedSplit}". Check the song split map and metadata JSONL.`)
for (const chunkId of asrByChunk.keys()) {
  const songId = chunkToSong.get(chunkId)
  if (!songId) fail(`ASR snapshot ${chunkId} is not present in the metadata JSONL.`)
  if (splitAssignments[songId] === selectedSplit && !matchedChunks.has(chunkId)) fail(`ASR snapshot ${chunkId} was not imported into the selected split.`)
}

const dataset = {
  name: `vietnamese-song-dataset-${selectedSplit}-external-unverified`,
  metadata: {
    source: 'sunbv56/song_dataset_chunked',
    split: selectedSplit,
    songCount: songIds.size,
    chunkCount: samples.length,
    referenceStatus: 'external-unverified',
    audioDownloaded: false,
    note: 'Word labels come from the source dataset and have not been manually checked against audio. Do not treat scores as a quality claim until references are reviewed.',
  },
  samples,
}

await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify({ split: selectedSplit, songs: songIds.size, chunks: samples.length, referenceStatus: dataset.metadata.referenceStatus, output: outputPath }, null, 2)}\n`)
