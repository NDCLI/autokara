import type { LyricSegment, NormalizedTranscript, TimedWord } from '../../shared/contracts'
import type { ParsedLyric } from '../lib/lyrics/parse'

function tokens(value: string): string[] {
  return value.trim().split(/\s+/).map((token) => token.toLocaleLowerCase('vi').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '')).filter(Boolean)
}

function scoreLine(lyric: string, words: TimedWord[]): number {
  const expected = tokens(lyric)
  const actual = words.flatMap((word) => tokens(word.text))
  if (!expected.length || !actual.length) return 0
  return expected.filter((token) => actual.includes(token)).length / Math.max(expected.length, actual.length)
}

function repairWords(words: TimedWord[], start: number, end: number, lyric: string, segmentId: string): TimedWord[] {
  const expected = lyric.trim().split(/\s+/).filter(Boolean)
  if (!expected.length) return []
  const boundedStart = Math.max(0, start)
  const boundedEnd = Math.max(boundedStart + 0.2, end)
  const result = expected.map((text, index) => {
    const source = words[index]
    const wordStart = source ? Math.max(boundedStart, Math.min(boundedEnd - 0.01, source.start)) : boundedStart + (boundedEnd - boundedStart) * index / expected.length
    const wordEnd = source ? Math.min(boundedEnd, Math.max(wordStart + 0.01, source.end)) : boundedStart + (boundedEnd - boundedStart) * (index + 1) / expected.length
    return { id: `${segmentId}-word-${index + 1}`, text, start: wordStart, end: Math.max(wordStart + 0.01, wordEnd), confidence: source?.confidence ?? 0.35 }
  })
  return result.map((word, index) => index ? { ...word, start: Math.max(word.start, result[index - 1].end) } : word)
}

/** Frozen pre-rewrite matcher, kept only as an A/B benchmark baseline. */
export function alignTranscriptLegacy(lines: ParsedLyric[], transcript: NormalizedTranscript, onMatch?: (match: { lineIndex: number; start: number; end: number }) => void): LyricSegment[] {
  if (!lines.length) return transcript.segments.map((item) => ({ ...item, speakerRole: 'unknown', providerSpeakerId: item.speakerId, needsReview: (item.confidence ?? 1) < 0.68 }))
  let cursor = 0
  return lines.map((line, index) => {
    let bestIndex = -1
    let bestScore = 0
    for (let candidate = cursor; candidate < transcript.segments.length; candidate += 1) {
      const candidateScore = scoreLine(line.text, transcript.segments[candidate].words)
      if (candidateScore > bestScore) { bestScore = candidateScore; bestIndex = candidate }
      if (candidateScore >= 0.99) break
    }
    const matched = bestIndex >= 0 && bestScore >= 0.24 ? transcript.segments[bestIndex] : undefined
    if (matched) onMatch?.({ lineIndex: index, start: matched.start, end: matched.end })
    if (matched) cursor = bestIndex + 1
    const start = line.start ?? matched?.start ?? transcript.segments[cursor - 1]?.end ?? 0
    const end = line.end ?? matched?.end ?? start + Math.max(1.7, Math.min(6.5, tokens(line.text).length * 0.48))
    const id = `segment-${index + 1}`
    const words = repairWords(matched?.words ?? line.words ?? [], start, end, line.text, id)
    return { id, text: line.text, start, end: Math.max(start + 0.2, end), speakerRole: 'unknown', providerSpeakerId: matched?.speakerId, words, confidence: matched?.confidence ?? (matched ? bestScore : 0.25), needsReview: !matched || bestScore < 0.68 || words.some((word) => (word.confidence ?? 1) < 0.5) }
  })
}
