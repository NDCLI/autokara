import { alignTranscriptToLyrics } from '../lib/lyrics/autoAlign'
import { alignTranscriptLegacy } from './legacyAlignment'
import type { LyricSegment, NormalizedTranscript } from '../../shared/contracts'
import type { ParsedLyric } from '../lib/lyrics/parse'

export type BenchmarkReferenceWord = { lineIndex: number; text: string; start: number; end: number }
export type BenchmarkSample = {
  id: string
  duration: number
  lines: ParsedLyric[]
  transcript: NormalizedTranscript
  referenceWords: BenchmarkReferenceWord[]
}

function normalize(value: string) {
  return value.toLocaleLowerCase('vi').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '')
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * ratio
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function summarize(values: number[]) {
  if (!values.length) return { count: 0, medianMs: null, p90Ms: null, within100ms: 0, within200ms: 0 }
  const median = percentile(values, 0.5)!
  const p90 = percentile(values, 0.9)!
  return {
    count: values.length,
    medianMs: Math.round(median * 1000),
    p90Ms: Math.round(p90 * 1000),
    within100ms: values.filter((value) => value <= 0.1).length,
    within200ms: values.filter((value) => value <= 0.2).length,
    within100Rate: Math.round(values.filter((value) => value <= 0.1).length / values.length * 1000) / 1000,
    within200Rate: Math.round(values.filter((value) => value <= 0.2).length / values.length * 1000) / 1000,
  }
}

export function validateBenchmarkDataset(value: unknown): asserts value is { name?: string; metadata?: Record<string, unknown>; samples: BenchmarkSample[] } {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { samples?: unknown }).samples) || !(value as { samples: unknown[] }).samples.length) {
    throw new Error('Benchmark cần object có mảng samples không rỗng.')
  }
  const sampleIds = new Set<string>()
  for (const [index, sample] of (value as { samples: unknown[] }).samples.entries()) {
    if (!sample || typeof sample !== 'object') throw new Error(`Sample ${index + 1} không hợp lệ.`)
    const item = sample as Partial<BenchmarkSample>
    if (typeof item.id !== 'string' || !item.id.trim() || sampleIds.has(item.id) || !Number.isFinite(item.duration) || item.duration! <= 0 || !Array.isArray(item.lines) || !item.lines.length || !Array.isArray(item.referenceWords) || !item.transcript || !Array.isArray(item.transcript.segments)) {
      throw new Error(`Sample ${index + 1} cần id, duration, lines, transcript.segments và referenceWords.`)
    }
    sampleIds.add(item.id)
    if (item.lines.some((line) => !line || typeof line.text !== 'string' || !line.text.trim())) throw new Error(`Sample ${item.id} có dòng lyric trống hoặc không hợp lệ.`)
    if (item.lines.some((line) => (line.start !== undefined && (!Number.isFinite(line.start) || line.start < 0 || line.start > item.duration!))
      || (line.end !== undefined && (!Number.isFinite(line.end) || line.end < 0 || line.end > item.duration!))
      || (line.start !== undefined && line.end !== undefined && line.end <= line.start))) {
      throw new Error(`Sample ${item.id} có mốc thời gian lyric không hợp lệ.`)
    }
    if (item.transcript.segments.some((segment) => !segment || typeof segment.text !== 'string' || !Array.isArray(segment.words)
      || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start
      || segment.end > item.duration! + 0.05
      || segment.words.some((word) => !word || typeof word.text !== 'string' || !word.text.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end)
        || word.start < 0 || word.end <= word.start || word.end > item.duration! + 0.05 || word.start < segment.start - 0.05 || word.end > segment.end + 0.05))) {
      throw new Error(`Sample ${item.id} có transcript segment/word không hợp lệ.`)
    }
    for (const [wordIndex, word] of item.referenceWords.entries()) {
      if (!word || !Number.isInteger(word.lineIndex) || word.lineIndex < 0 || word.lineIndex >= item.lines.length || typeof word.text !== 'string' || !word.text.trim()
        || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end <= word.start || word.end > item.duration! + 0.05) {
        throw new Error(`Reference word ${wordIndex + 1} trong sample ${item.id} không hợp lệ.`)
      }
    }
    const referencesPerLine = new Map<number, BenchmarkReferenceWord[]>()
    for (const word of item.referenceWords) {
      const words = referencesPerLine.get(word.lineIndex) ?? []
      words.push(word)
      referencesPerLine.set(word.lineIndex, words)
    }
    item.lines.forEach((line, lineIndex) => {
      const lyricTokens = line.text.trim().split(/\s+/).filter(Boolean)
      const references = referencesPerLine.get(lineIndex) ?? []
      if (references.length !== lyricTokens.length) throw new Error(`Sample ${item.id}, dòng ${lineIndex + 1}: cần nhãn timing cho đủ ${lyricTokens.length} tiếng.`)
      references.sort((a, b) => a.start - b.start)
      if (references.some((reference, tokenIndex) => normalize(reference.text) !== normalize(lyricTokens[tokenIndex]))) {
        throw new Error(`Sample ${item.id}, dòng ${lineIndex + 1}: referenceWords không cùng thứ tự/nội dung với lyric.`)
      }
    })
  }
}

type AlignmentMatch = { lineIndex: number; start: number; end: number }
type BenchmarkAligner = (lines: ParsedLyric[], transcript: NormalizedTranscript, onMatch?: (match: AlignmentMatch) => void) => LyricSegment[]

function benchmarkWithAligner(dataset: { name?: string; metadata?: Record<string, unknown>; samples: BenchmarkSample[] }, aligner: BenchmarkAligner) {
  const onsetErrors: number[] = []
  const offsetErrors: number[] = []
  let expectedWordCount = 0
  let evidenceBackedWordCount = 0
  let textMismatchCount = 0
  let estimatedWordCount = 0
  const sampleReports = dataset.samples.map((sample) => {
    const startedAt = performance.now()
    const selectedMatches = new Map<number, AlignmentMatch>()
    const aligned = aligner(sample.lines, sample.transcript, (match) => selectedMatches.set(match.lineIndex, match))
    const processingSeconds = (performance.now() - startedAt) / 1000
    const refsByLine = sample.referenceWords.reduce((groups, reference) => {
      const list = groups.get(reference.lineIndex) ?? []
      list.push(reference)
      groups.set(reference.lineIndex, list)
      return groups
    }, new Map<number, BenchmarkReferenceWord[]>())
    let sampleEvidence = 0
    let sampleMismatches = 0
    let sampleEstimated = 0
    let repeatedLineMisses = 0
    const sampleOnsetErrors: number[] = []
    const sampleOffsetErrors: number[] = []
    const normalizedCounts = new Map<string, number>()
    for (const line of sample.lines) {
      const key = normalize(line.text)
      normalizedCounts.set(key, (normalizedCounts.get(key) ?? 0) + 1)
    }

    for (const [lineIndex, references] of refsByLine) {
      const prediction = aligned[lineIndex]
      const predictedWords = prediction?.words ?? []
      references.sort((a, b) => a.start - b.start)
      const lineTokens = sample.lines[lineIndex].text.trim().split(/\s+/).filter(Boolean)
      const selected = selectedMatches.get(lineIndex)
      if (normalizedCounts.get(normalize(sample.lines[lineIndex].text))! > 1
        && (!selected || Math.abs(selected.start - references[0].start) > 2)) repeatedLineMisses += 1
      references.forEach((reference, index) => {
        expectedWordCount += 1
        const word = predictedWords[index]
        if (!word) return
        if (normalize(word.text) !== normalize(reference.text) || normalize(word.text) !== normalize(lineTokens[index] ?? '')) {
          textMismatchCount += 1
          sampleMismatches += 1
          return
        }
        const onsetError = Math.abs(word.start - reference.start)
        const offsetError = Math.abs(word.end - reference.end)
        onsetErrors.push(onsetError)
        offsetErrors.push(offsetError)
        sampleOnsetErrors.push(onsetError)
        sampleOffsetErrors.push(offsetError)
        if (word.origin === 'manual' || word.origin === 'aligned') {
          evidenceBackedWordCount += 1
          sampleEvidence += 1
        }
        if (word.origin === 'estimated' || word.origin === 'asr') {
          estimatedWordCount += 1
          sampleEstimated += 1
        }
      })
    }
    return {
      id: sample.id,
      durationSeconds: sample.duration,
      processingSeconds: Math.round(processingSeconds * 1000) / 1000,
      processingRatio: Math.round(processingSeconds / sample.duration * 1_000_000) / 1_000_000,
      referenceWords: sample.referenceWords.length,
      evidenceBackedWords: sampleEvidence,
      timingComparedWords: sampleOnsetErrors.length,
      onset: summarize(sampleOnsetErrors),
      offset: summarize(sampleOffsetErrors),
      textMismatches: sampleMismatches,
      unverifiedTimingWords: sampleEstimated,
      repeatedLineOccurrenceMisses: repeatedLineMisses,
    }
  })

  return {
    dataset: dataset.name ?? 'unnamed',
    metadata: dataset.metadata ?? null,
    generatedAt: new Date().toISOString(),
    samples: sampleReports,
    aggregate: {
      sampleCount: sampleReports.length,
      referenceWordCount: expectedWordCount,
      timingComparedWordCount: onsetErrors.length,
      evidenceBackedCoverage: expectedWordCount ? Math.round(evidenceBackedWordCount / expectedWordCount * 1000) / 1000 : 0,
      unverifiedTimingWordCount: estimatedWordCount,
      textMismatchCount,
      repeatedLineOccurrenceMisses: sampleReports.reduce((sum, sample) => sum + sample.repeatedLineOccurrenceMisses, 0),
      repeatedLineOccurrenceMissToleranceMs: 2000,
      onset: summarize(onsetErrors),
      offset: summarize(offsetErrors),
      songMacroOnsetMedianMs: summarize(sampleReports.flatMap((sample) => sample.onset.medianMs === null ? [] : [sample.onset.medianMs / 1000])),
      songMacroOffsetMedianMs: summarize(sampleReports.flatMap((sample) => sample.offset.medianMs === null ? [] : [sample.offset.medianMs / 1000])),
      thresholdNote: 'within100ms/within200ms gồm số đếm và tỷ lệ. onset/offset là pooled theo tiếng; songMacroOnsetMedianMs/songMacroOffsetMedianMs lấy median và P90 của median từng sample, mỗi sample có trọng số ngang nhau.',
    },
  }
}

export function benchmarkAlignment(dataset: { name?: string; metadata?: Record<string, unknown>; samples: BenchmarkSample[] }) {
  const current = benchmarkWithAligner(dataset, alignTranscriptToLyrics)
  const baseline = benchmarkWithAligner(dataset, alignTranscriptLegacy)
  const delta = (value: number | null, base: number | null) => value === null || base === null ? null : value - base
  return {
    ...current,
    baseline: { samples: baseline.samples, aggregate: baseline.aggregate },
    comparison: {
      onsetMedianDeltaMs: delta(current.aggregate.onset.medianMs, baseline.aggregate.onset.medianMs),
      offsetMedianDeltaMs: delta(current.aggregate.offset.medianMs, baseline.aggregate.offset.medianMs),
      evidenceBackedCoverageDelta: current.aggregate.evidenceBackedCoverage - baseline.aggregate.evidenceBackedCoverage,
      textMismatchDelta: current.aggregate.textMismatchCount - baseline.aggregate.textMismatchCount,
      repeatedLineOccurrenceMissDelta: current.aggregate.repeatedLineOccurrenceMisses - baseline.aggregate.repeatedLineOccurrenceMisses,
    },
  }
}
