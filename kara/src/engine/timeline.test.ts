import { describe, expect, it } from 'vitest'
import { moveWord, shiftSegment, trimSegment } from './timeline'

describe('moveWord', () => {
  const segment = { id: 's', text: 'xin chào em', start: 0, end: 3, speakerRole: 'unknown' as const, words: [
    { id: 'a', text: 'xin', start: 0, end: 0.5 },
    { id: 'b', text: 'chào', start: 0.7, end: 1.2 },
    { id: 'c', text: 'em', start: 1.5, end: 2, timingLocked: true },
  ] }

  it('moves within neighboring word boundaries and preserves duration', () => {
    const moved = moveWord(segment, 'b', 2)
    expect(moved.words[1].start).toBeCloseTo(1)
    expect(moved.words[1].end).toBeCloseTo(1.5)
    expect(moveWord(moved, 'b', -5).words[1].start).toBeCloseTo(0.5)
  })

  it('does not move a locked word', () => {
    expect(moveWord(segment, 'c', -0.4)).toBe(segment)
  })
})

describe('locked word timing', () => {
  const segment = { id: 'locked', text: 'xin chào em', start: 0, end: 4, speakerRole: 'unknown' as const, words: [
    { id: 'a', text: 'xin', start: 0.3, end: 0.8 },
    { id: 'b', text: 'chào', start: 1.5, end: 2, timingLocked: true },
    { id: 'c', text: 'em', start: 2.4, end: 3 },
  ] }

  it('keeps absolute locked timing when shifting a segment', () => {
    const shifted = shiftSegment(segment, 3)
    expect(shifted.words[0].start).toBeCloseTo(3.3)
    expect(shifted.words[1]).toMatchObject({ start: 1.5, end: 2, timingLocked: true })
    expect(shifted.start).toBe(1.5)
    expect(shifted.end).toBe(7)
  })

  it('expands a trim to contain locked timing and clips unlocked words', () => {
    const trimmed = trimSegment(segment, 2, 2.5)
    expect(trimmed.start).toBe(1.5)
    expect(trimmed.end).toBe(2.5)
    expect(trimmed.words).toEqual([
      { id: 'b', text: 'chào', start: 1.5, end: 2, timingLocked: true },
      { id: 'c', text: 'em', start: 2.4, end: 2.5 },
    ])
  })
})
