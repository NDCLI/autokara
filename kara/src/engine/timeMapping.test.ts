import { describe, expect, it } from 'vitest'
import { assetTimeToTimeline, mapTranscriptToTimeline, timelineToAssetTime } from './timeMapping'

const mapping = {
  assetMappings: [{ assetId: 'vocal', anchors: [
    { sourceTime: 2, timelineTime: 1 },
    { sourceTime: 12, timelineTime: 11 },
    { sourceTime: 22, timelineTime: 16 },
  ] }],
}

describe('track time mapping', () => {
  it('round-trips offset and piecewise tempo anchors', () => {
    for (const sourceTime of [2, 7, 12, 17, 22, 28]) {
      const timelineTime = assetTimeToTimeline(sourceTime, mapping, 'vocal')
      expect(timelineToAssetTime(timelineTime, mapping, 'vocal')).toBeCloseTo(sourceTime)
    }
    expect(assetTimeToTimeline(2, mapping, 'vocal')).toBe(1)
    expect(assetTimeToTimeline(17, mapping, 'vocal')).toBe(13.5)
  })

  it('leaves unmapped assets unchanged and clamps mapped time below zero', () => {
    expect(assetTimeToTimeline(4, mapping, 'other')).toBe(4)
    expect(timelineToAssetTime(0, mapping, 'vocal')).toBe(1)
    expect(assetTimeToTimeline(0, { assetMappings: [{ assetId: 'vocal', anchors: [{ sourceTime: 2, timelineTime: 0 }] }] }, 'vocal')).toBe(0)
  })

  it('maps transcript segments and words onto the project timeline', () => {
    const transcript = {
      timingMethod: 'asr' as const,
      segments: [{ id: 's', text: 'xin chào', start: 4, end: 6, confidence: 0.9, words: [
        { id: 'w1', text: 'xin', start: 4, end: 4.8 },
        { id: 'w2', text: 'chào', start: 5, end: 6 },
      ] }],
    }
    const result = mapTranscriptToTimeline(transcript, mapping, 'vocal')
    expect(result.segments[0].start).toBe(3)
    expect(result.segments[0].end).toBe(5)
    expect(result.segments[0].words.map(({ start, end }) => [start, end])).toEqual([[3, 3.8], [4, 5]])
  })
})
