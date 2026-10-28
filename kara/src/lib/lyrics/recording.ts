import type { LyricSegment, TimedWord } from '../../../shared/contracts'

export type WordRecordingSession = {
  segmentId: string
  segmentStart: number
  segmentEnd: number
  words: TimedWord[]
  nextIndex: number
  activeStart?: number
  spaceHeld: boolean
  lastWordClosedByHold?: boolean
}

function makeManualId(segmentId: string, index: number): string {
  return `manual-${segmentId}-${index + 1}`
}

export function wordsForRecording(segment: LyricSegment): TimedWord[] {
  const tokens = segment.text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === segment.words.length && tokens.every((text, index) => text === segment.words[index].text)) {
    return segment.words.map((word) => ({ ...word }))
  }
  const span = Math.max(0.1, (segment.end - segment.start) / Math.max(tokens.length, 1))
  return tokens.map((text, index) => ({
    id: (segment.words[index]?.text === text ? segment.words[index].id : undefined) ?? makeManualId(segment.id, index),
    text,
    start: segment.words[index]?.text === text ? segment.words[index].start : segment.start + index * span,
    end: segment.words[index]?.text === text ? segment.words[index].end : segment.start + (index + 1) * span,
    confidence: segment.words[index]?.text === text ? segment.words[index].confidence : undefined,
    origin: segment.words[index]?.text === text ? segment.words[index].origin : 'estimated',
  }))
}

export function startWordRecording(segment: LyricSegment): WordRecordingSession {
  return {
    segmentId: segment.id,
    segmentStart: segment.start,
    segmentEnd: segment.end,
    words: wordsForRecording(segment),
    nextIndex: 0,
    spaceHeld: false,
  }
}

export function beginHeldWord(session: WordRecordingSession, time: number): WordRecordingSession | null {
  if (session.spaceHeld || !Number.isFinite(time) || session.nextIndex >= session.words.length) return null
  const now = Math.max(session.segmentStart, Math.min(session.segmentEnd, time))
  const previous = session.words[session.nextIndex - 1]
  if (previous && now < previous.end) return null
  return { ...session, activeStart: now, spaceHeld: true }
}

export function endHeldWord(session: WordRecordingSession, time: number): WordRecordingSession | null {
  if (!session.spaceHeld || session.activeStart === undefined || !Number.isFinite(time)) return null
  const now = Math.max(session.activeStart + 0.01, Math.min(session.segmentEnd, time))
  const index = session.nextIndex
  const words = session.words.map((word, wordIndex) => wordIndex === index ? { ...word, start: session.activeStart!, end: now, origin: 'manual' as const } : word)
  return { ...session, words, nextIndex: index + 1, activeStart: undefined, spaceHeld: false, lastWordClosedByHold: true }
}

export function markWord(session: WordRecordingSession, time: number): WordRecordingSession | null {
  if (!Number.isFinite(time) || session.nextIndex >= session.words.length) return null
  const now = Math.max(session.segmentStart, Math.min(session.segmentEnd, time))
  const previous = session.words[session.nextIndex - 1]
  if (previous && now <= previous.start) return null
  const words = session.words.map((word, index) => index === session.nextIndex
    ? { ...word, start: now, end: session.segmentEnd, origin: 'manual' as const }
    : index === session.nextIndex - 1
      ? { ...word, end: now, origin: 'manual' as const }
      : word)
  return { ...session, words, nextIndex: session.nextIndex + 1, lastWordClosedByHold: false }
}


export function finishWordRecording(session: WordRecordingSession): TimedWord[] {
  if (!session.words.length) return []
  const words = session.words.map((word, index) => index < session.nextIndex ? { ...word } : { ...word, start: word.start, end: word.end })
  const lastMarked = session.nextIndex - 1
  if (lastMarked >= 0 && !session.lastWordClosedByHold) words[lastMarked] = { ...words[lastMarked], end: session.segmentEnd }
  return words
}
