import { describe, expect, it } from 'vitest'
import { activeLyricSegments, assignKaraokeLanes, countdownCues, countdownValueAtTime, karaokeLanePositionY } from './karaokePresentation'

const line = (id: string, start: number, end: number) => ({
  id, text: id, start, end, speakerRole: 'unknown' as const, words: [],
})

describe('karaoke presentation timeline', () => {
  it('uses the same lead-in and lead-out interval for active lyrics', () => {
    const segments = [line('a', 2, 3), line('b', 5, 6)]
    expect(activeLyricSegments(segments, 1.9, 200, 0).map((item) => item.id)).toEqual(['a'])
    expect(activeLyricSegments(segments, 3.1, 0, 200).map((item) => item.id)).toEqual(['a'])
    expect(activeLyricSegments(segments, 3.21, 0, 200)).toEqual([])
  })

  it('assigns stable separate lanes to overlapping duet lines and reuses a lane afterward', () => {
    const segments = [line('long', 1, 5), line('duet', 2, 3), line('later-overlap', 4, 4.5), line('solo', 6, 7)]
    const lanes = assignKaraokeLanes(segments)
    expect(lanes.get('long')).toEqual({ index: 0, count: 2 })
    expect(lanes.get('duet')).toEqual({ index: 1, count: 2 })
    expect(lanes.get('later-overlap')).toEqual({ index: 1, count: 2 })
    expect(lanes.get('solo')).toEqual({ index: 0, count: 1 })
    expect(karaokeLanePositionY(0.8, lanes.get('long'))).toBeCloseTo(0.77)
    expect(karaokeLanePositionY(0.8, lanes.get('duet'))).toBeCloseTo(0.83)
  })

  it('creates identical effective gap countdown cues for preview and ASS consumers', () => {
    const previous = line('previous', 1, 2)
    const next = line('next', 6, 7)
    const cues = countdownCues(previous, next, 200, 300)
    expect(cues).toEqual([
      { start: 2.8, end: 3.8, value: 3 },
      { start: 3.8, end: 4.8, value: 2 },
      { start: 4.8, end: 5.8, value: 1 },
    ])
    expect(countdownValueAtTime(previous, next, 5.3, 200, 300)).toBe(1)
    expect(countdownValueAtTime(previous, next, 5.8, 200, 300)).toBeUndefined()
    expect(countdownCues(previous, line('short-gap', 3.2, 4), 200, 300)).toEqual([])
  })
})
