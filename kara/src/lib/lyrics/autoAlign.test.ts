import { describe, expect, it } from 'vitest'
import { alignTranscriptToLyrics } from './autoAlign'

const transcript = (segments: Array<{ text: string; start: number; end: number; words: Array<{ text: string; start: number; end: number }> }>) => ({
  segments: segments.map((segment, index) => ({ ...segment, id: `segment-${index + 1}`, confidence: 0.9, words: segment.words.map((word, wordIndex) => ({ ...word, id: `word-${index + 1}-${wordIndex + 1}`, confidence: 0.9 })) })),
})

describe('alignTranscriptToLyrics', () => {
  it('keeps Vietnamese lyric display text and transfers word timing', () => {
    const result = alignTranscriptToLyrics([{ text: 'Một câu hát', start: 1, end: 3 }], transcript([{ text: 'Mot cau hat', start: 1.1, end: 2.8, words: [{ text: 'Mot', start: 1.1, end: 1.5 }, { text: 'cau', start: 1.6, end: 2 }, { text: 'hat', start: 2.1, end: 2.8 }] }]))
    expect(result[0].text).toBe('Một câu hát')
    expect(result[0].words.map((word) => word.text)).toEqual(['Một', 'câu', 'hát'])
    expect(result[0].words[1].start).toBe(1.6)
    expect(result[0].needsReview).toBe(false)
  })

  it('marks unmatched lyrics for review and interpolates safe word bounds', () => {
    const result = alignTranscriptToLyrics([{ text: 'Dòng không có trong audio' }], transcript([{ text: 'khác', start: 4, end: 5, words: [{ text: 'khác', start: 4, end: 5 }] }]))
    expect(result[0].needsReview).toBe(true)
    expect(result[0].words).toHaveLength(5)
    expect(result[0].words.every((word) => word.start >= result[0].start && word.end <= result[0].end)).toBe(true)
  })
})
