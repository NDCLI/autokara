import type { LyricSegment, NormalizedTranscript, SpeakerRole, TimedWord } from '../../../shared/contracts'
import { SPEAKER_COLORS } from '../../../shared/contracts'

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function transcriptToSegments(transcript: NormalizedTranscript): LyricSegment[] {
  return transcript.segments.map((segment) => ({
    id: segment.id || makeId(),
    text: segment.text,
    start: segment.start,
    end: Math.max(segment.start + 0.1, segment.end),
    speakerRole: roleForSpeaker(segment.speakerId),
    providerSpeakerId: segment.speakerId,
    words: segment.words,
    confidence: segment.confidence,
    needsReview: (segment.confidence ?? 1) < 0.68,
    origin: 'asr',
  }))
}

export function mockTranscriptFromLyrics(lines: Array<{ text: string; start?: number; end?: number }>): NormalizedTranscript {
  let cursor = 0
  const segments = lines.map((line, index) => {
    const start = line.start ?? cursor
    const duration = line.end ? line.end - start : Math.max(2.2, Math.min(5.2, line.text.split(/\s+/).length * 0.52))
    const end = Math.max(start + 0.5, line.end ?? start + duration)
    const tokens = line.text.split(/\s+/).filter(Boolean)
    const weights = tokens.map((word) => Math.max(1, word.replace(/[.,!?…]/g, '').length))
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1
    let wordCursor = start
    const words: TimedWord[] = tokens.map((text, wordIndex) => {
      const wordStart = wordCursor
      const wordEnd = wordIndex === tokens.length - 1 ? end : wordStart + (end - start) * weights[wordIndex] / totalWeight
      wordCursor = wordEnd
      return { id: makeId(), text, start: wordStart, end: wordEnd, confidence: 0.5 }
    })
    cursor = end + 0.28
    return { id: makeId(), text: line.text, start, end, speakerId: index % 2 === 0 ? 'speaker_0' : 'speaker_1', confidence: 0.5, words }
  })
  return { segments }
}

export function roleForSpeaker(_speakerId?: string): SpeakerRole {
  return 'unknown'
}

export function speakerColor(role: SpeakerRole): string {
  return SPEAKER_COLORS[role]
}
