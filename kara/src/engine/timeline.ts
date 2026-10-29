import type { LyricSegment } from '../../shared/contracts'

export function shiftSegment(segment: LyricSegment, delta: number): LyricSegment {
  const shift = Math.max(-segment.start, delta)
  const lockedWords = segment.words.filter((word) => word.timingLocked)
  const shiftedStart = segment.start + shift
  const shiftedEnd = segment.end + shift
  return {
    ...segment,
    start: Math.min(shiftedStart, ...lockedWords.map((word) => word.start)),
    end: Math.max(shiftedEnd, ...lockedWords.map((word) => word.end)),
    words: segment.words.map((word) => word.timingLocked ? word : ({ ...word, start: word.start + shift, end: word.end + shift })),
  }
}

export function trimSegment(segment: LyricSegment, start: number, end: number): LyricSegment {
  const requestedStart = Math.max(0, start)
  const requestedEnd = Math.max(requestedStart + 0.05, end)
  const lockedWords = segment.words.filter((word) => word.timingLocked)
  const nextStart = Math.min(requestedStart, ...lockedWords.map((word) => word.start))
  const nextEnd = Math.max(requestedEnd, ...lockedWords.map((word) => word.end))
  const words = segment.words.flatMap((word) => {
    if (word.timingLocked) return [word]
    const wordStart = Math.max(nextStart, word.start)
    const wordEnd = Math.min(nextEnd, word.end)
    return wordEnd > wordStart ? [{ ...word, start: wordStart, end: wordEnd }] : []
  })
  return { ...segment, start: nextStart, end: nextEnd, words }
}

export function resizeSegment(segment: LyricSegment, start: number, end: number): LyricSegment {
  const nextStart = Math.max(0, start)
  const nextEnd = Math.max(nextStart + 0.05, end)
  const startDelta = nextStart - segment.start
  const endDelta = nextEnd - segment.end
  if (Math.abs(startDelta - endDelta) < 0.001) return shiftSegment(segment, startDelta)
  return trimSegment(segment, nextStart, nextEnd)
}

export function moveWord(segment: LyricSegment, wordId: string, delta: number): LyricSegment {
  const words = [...segment.words].sort((a, b) => a.start - b.start || a.end - b.end)
  const index = words.findIndex((word) => word.id === wordId)
  if (index < 0 || words[index].timingLocked || !Number.isFinite(delta)) return segment
  const word = words[index]
  const duration = word.end - word.start
  const lowerBound = Math.max(segment.start, words[index - 1]?.end ?? segment.start)
  const upperBound = Math.min(segment.end - duration, words[index + 1]?.start !== undefined ? words[index + 1].start - duration : segment.end - duration)
  if (lowerBound > upperBound) return segment
  const start = Math.max(lowerBound, Math.min(upperBound, word.start + delta))
  if (Math.abs(start - word.start) < 0.0001) return segment
  return {
    ...segment,
    words: words.map((item) => item.id === wordId ? { ...item, start, end: start + duration, origin: 'manual' } : item),
  }
}

export function resizeWord(segment: LyricSegment, wordId: string, edge: 'start' | 'end', value: number): LyricSegment {
  if (segment.timingLocked || !Number.isFinite(value)) return segment
  const index = segment.words.findIndex(word => word.id === wordId)
  const word = segment.words[index]
  if (!word || word.timingLocked) return segment
  const start = edge === 'start' ? Math.max(segment.start, segment.words[index - 1]?.end ?? segment.start, Math.min(word.end - .01, value)) : word.start
  const end = edge === 'end' ? Math.min(segment.end, segment.words[index + 1]?.start ?? segment.end, Math.max(word.start + .01, value)) : word.end
  if (end <= start) return segment
  return { ...segment, words: segment.words.map(item => item.id === wordId ? { ...item, start, end, origin: 'manual' } : item) }
}
