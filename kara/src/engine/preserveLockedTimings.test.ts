import { describe, expect, it } from 'vitest'
import { preserveLockedTimings } from './preserveLockedTimings'

describe('preserveLockedTimings', () => {
  it('keeps locked line bounds but never reuses words from a changed lyric line', () => {
    const previous = [{ id: 'segment-1', text: 'Câu cũ đây', start: 4, end: 7, speakerRole: 'unknown' as const, timingLocked: true, origin: 'manual' as const, words: [
      { id: 'old-1', text: 'Câu', start: 4, end: 4.8 },
      { id: 'old-2', text: 'cũ', start: 5, end: 5.7 },
      { id: 'old-3', text: 'đây', start: 6, end: 7 },
    ] }]
    const incoming = [{ id: 'segment-1', text: 'Lời mới hát', start: 10, end: 12, speakerRole: 'unknown' as const, words: [
      { id: 'new-1', text: 'Lời', start: 10, end: 10.5 },
      { id: 'new-2', text: 'mới', start: 10.6, end: 11 },
      { id: 'new-3', text: 'hát', start: 11.1, end: 12 },
    ] }]

    const [result] = preserveLockedTimings(previous, incoming)
    expect(result.text).toBe('Lời mới hát')
    expect([result.start, result.end, result.timingLocked]).toEqual([4, 7, true])
    expect(result.words.map((word) => word.text)).toEqual(['Lời', 'mới', 'hát'])
    expect(result.words.map((word) => [word.start, word.end])).toEqual([[4, 5], [5, 6], [6, 7]])
    expect(result.words.every((word) => word.origin === 'estimated')).toBe(true)
    expect(result.needsReview).toBe(true)
  })

  it('preserves individually locked words by normalized text after a lyric edit', () => {
    const previous = [{ id: 'segment-1', text: 'xin chào em', start: 0, end: 3, speakerRole: 'unknown' as const, words: [
      { id: 'old-xin', text: 'xin', start: 0.2, end: 0.7 },
      { id: 'old-chao', text: 'chào', start: 0.9, end: 1.5, timingLocked: true },
      { id: 'old-em', text: 'em', start: 2, end: 2.6 },
    ] }]
    const incoming = [{ id: 'segment-1', text: 'chao em', start: 5, end: 7, speakerRole: 'unknown' as const, words: [
      { id: 'new-chao', text: 'chao', start: 5, end: 5.8 },
      { id: 'new-em', text: 'em', start: 6, end: 7 },
    ] }]

    const [result] = preserveLockedTimings(previous, incoming)
    expect(result.words[0]).toMatchObject({ text: 'chao', start: 0.9, end: 1.5, timingLocked: true })
    expect(result.words[1]).toMatchObject({ text: 'em', start: 6, end: 7 })
    expect(result.start).toBe(0.9)
    expect(result.needsReview).toBe(true)
  })
})
