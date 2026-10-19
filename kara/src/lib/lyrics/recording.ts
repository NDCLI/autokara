import type { LyricSegment, TimedWord } from '../../../shared/contracts'

export type WordRecordingSession = {
  segmentId: string
  segmentStart: number
  segmentEnd: number
  words: TimedWord[]
  nextIndex: number
  originalWords: TimedWord[]
  originalStart: number
  originalEnd: number
  originalNeedsReview?: boolean
}

function makeManualId(segmentId: string, index: number): string {
  return `manual-${segmentId}-${index + 1}`
}

export function wordsForRecording(segment: LyricSegment): TimedWord[] {
  const tokens = segment.text.trim().split(/\s+/).filter(Boolean)
  const matchesExisting = segment.words.length === tokens.length && segment.words.every((word, index) => word.text === tokens[index])
  if (matchesExisting) return segment.words.map((word) => ({ ...word }))
  const span = Math.max(0.1, (segment.end - segment.start) / Math.max(tokens.length, 1))
  return tokens.map((text, index) => ({
    id: makeManualId(segment.id, index),
    text,
    start: segment.start + index * span,
    end: segment.start + (index + 1) * span,
  }))
}

export function startWordRecording(segment: LyricSegment): WordRecordingSession {
  return {
    segmentId: segment.id,
    segmentStart: segment.start,
    segmentEnd: segment.end,
    words: wordsForRecording(segment),
    nextIndex: 0,
    originalWords: segment.words.map((word) => ({ ...word })),
    originalStart: segment.start,
    originalEnd: segment.end,
    originalNeedsReview: segment.needsReview,
  }
}

export function markWord(session: WordRecordingSession, time: number): WordRecordingSession | null {
  if (!Number.isFinite(time) || session.nextIndex >= session.words.length) return null
  const now = Math.max(session.segmentStart, Math.min(session.segmentEnd, time))
  const previous = session.words[session.nextIndex - 1]
  if (previous && now <= previous.start) return null
  const words = session.words.map((word, index) => index === session.nextIndex
    ? { ...word, start: now, end: session.segmentEnd }
    : index === session.nextIndex - 1
      ? { ...word, end: now }
      : word)
  return { ...session, words, nextIndex: session.nextIndex + 1 }
}

export function finishWordRecording(session: WordRecordingSession): TimedWord[] {
  if (!session.words.length) return []
  const words = session.words.map((word, index) => index < session.nextIndex ? { ...word } : { ...word, start: word.start, end: word.end })
  const lastMarked = session.nextIndex - 1
  if (lastMarked >= 0) words[lastMarked] = { ...words[lastMarked], end: session.segmentEnd }
  return words
}
