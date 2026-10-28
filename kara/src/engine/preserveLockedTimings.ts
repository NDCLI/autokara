import type { LyricSegment, TimedWord } from '../../shared/contracts'

function normalize(value: string) {
  return value.toLocaleLowerCase('vi').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '')
}

function tokens(value: string) {
  return value.trim().split(/\s+/).map(normalize).filter(Boolean)
}

function sameLyrics(left: string, right: string) {
  const a = tokens(left)
  const b = tokens(right)
  return a.length === b.length && a.every((token, index) => token === b[index])
}

function estimateWords(text: string, start: number, end: number, segmentId: string): TimedWord[] {
  const lyrics = text.trim().split(/\s+/).filter(Boolean)
  const span = Math.max(0.01, end - start) / Math.max(lyrics.length, 1)
  return lyrics.map((word, index) => ({
    id: `${segmentId}-locked-realign-${index + 1}`,
    text: word,
    start: start + span * index,
    end: index === lyrics.length - 1 ? end : start + span * (index + 1),
    confidence: 0.25,
    origin: 'estimated',
  }))
}

export function preserveLockedTimings(previous: LyricSegment[], incoming: LyricSegment[]): LyricSegment[] {
  const locked = previous.filter((segment) => segment.timingLocked || segment.words.some((word) => word.timingLocked))
  if (!locked.length) return incoming
  const used = new Set<string>()
  const preserved = incoming.map((candidate) => {
    const exactId = locked.find((segment) => segment.id === candidate.id && !used.has(segment.id))
    const match = exactId ?? locked
      .filter((segment) => !used.has(segment.id) && sameLyrics(segment.text, candidate.text))
      .sort((a, b) => Math.abs(a.start - candidate.start) - Math.abs(b.start - candidate.start))[0]
    if (!match) return candidate
    used.add(match.id)

    if (match.timingLocked) {
      const unchangedLyrics = sameLyrics(match.text, candidate.text)
      if (!unchangedLyrics) {
        const words = estimateWords(candidate.text, match.start, match.end, candidate.id)
        return { ...candidate, start: match.start, end: match.end, words, origin: 'estimated' as const, needsReview: true, timingLocked: true }
      }
      const words = candidate.words.map((word, index) => {
        const oldWord = match.words[index]
        return oldWord ? { ...word, start: oldWord.start, end: oldWord.end, origin: oldWord.origin ?? 'manual', timingLocked: true } : word
      })
      return { ...candidate, start: match.start, end: match.end, words, origin: match.origin, timingLocked: true, needsReview: match.needsReview }
    }

    const usedWordIds = new Set<string>()
    const words = candidate.words.map((word, wordIndex) => {
      const sameIndex = match.words[wordIndex]
      const indexedMatch = sameIndex?.timingLocked && !usedWordIds.has(sameIndex.id) && normalize(sameIndex.text) === normalize(word.text)
        ? sameIndex
        : undefined
      const preservedWord = indexedMatch ?? match.words.find((oldWord) => oldWord.timingLocked && !usedWordIds.has(oldWord.id) && normalize(oldWord.text) === normalize(word.text))
      if (!preservedWord) return word
      usedWordIds.add(preservedWord.id)
      return { ...word, start: preservedWord.start, end: preservedWord.end, origin: preservedWord.origin ?? 'manual', timingLocked: true }
    })
    const lockedWords = words.filter((word) => word.timingLocked)
    const start = Math.min(candidate.start, ...lockedWords.map((word) => word.start))
    const end = Math.max(candidate.end, ...lockedWords.map((word) => word.end))
    return { ...candidate, start, end, words, needsReview: candidate.needsReview || lockedWords.length > 0 }
  })
  for (const segment of locked) if (!used.has(segment.id)) preserved.push(segment)
  return preserved.sort((a, b) => a.start - b.start)
}
