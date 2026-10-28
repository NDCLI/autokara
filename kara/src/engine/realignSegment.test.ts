import { describe, expect, it } from 'vitest'
import { realignSegmentFromTranscript } from './realignSegment'
import type { LyricSegment, NormalizedTranscript } from '../../shared/contracts'

const segment: LyricSegment = {
  id: 'line-target', text: 'Xin chào', start: 10, end: 11, speakerRole: 'female',
  words: [{ id: 'old-xin', text: 'Xin', start: 10, end: 10.4 }, { id: 'old-chao', text: 'chào', start: 10.5, end: 11 }],
}

const transcript: NormalizedTranscript = { segments: [
  { id: 'far-repeat', text: 'Xin chào', start: 1, end: 2, words: [
    { id: 'far-xin', text: 'Xin', start: 1, end: 1.4 }, { id: 'far-chao', text: 'chào', start: 1.5, end: 2 },
  ] },
  { id: 'near-repeat', text: 'Xin chào', start: 10.1, end: 10.9, speakerId: 'singer-a', words: [
    { id: 'near-xin', text: 'Xin', start: 10.1, end: 10.4 }, { id: 'near-chao', text: 'chào', start: 10.5, end: 10.9 },
  ] },
] }

describe('local segment realignment', () => {
  it('uses only transcript evidence near the selected line and keeps its identity and role', () => {
    const result = realignSegmentFromTranscript(segment, transcript)
    expect(result?.id).toBe(segment.id)
    expect(result?.speakerRole).toBe('female')
    expect(result?.providerSpeakerId).toBe('singer-a')
    expect(result?.words.map((word) => [word.start, word.end])).toEqual([[10.1, 10.4], [10.5, 10.9]])
  })

  it('preserves locked words and refuses a locked line', () => {
    const lockedWordSegment = { ...segment, words: segment.words.map((word, index) => index === 0 ? { ...word, timingLocked: true as const } : word) }
    const result = realignSegmentFromTranscript(lockedWordSegment, transcript)
    expect(result?.words[0]).toMatchObject({ start: 10, end: 10.4, timingLocked: true })
    expect(realignSegmentFromTranscript({ ...segment, timingLocked: true }, transcript)).toBeUndefined()
  })

  it('returns no result if no transcript evidence lies in the local time window', () => {
    expect(realignSegmentFromTranscript(segment, { segments: [transcript.segments[0]] }, 6)).toBeUndefined()
  })
})
