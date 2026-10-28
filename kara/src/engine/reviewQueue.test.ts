import { describe, expect, it } from 'vitest'
import { acknowledgeSegment, editReviewState, markSegmentHeard } from './reviewQueue'
import type { LyricSegment } from '../../shared/contracts'

const segment: LyricSegment = {
  id: 'line-1', text: 'Xin chào', start: 1, end: 2, speakerRole: 'unknown', words: [], needsReview: true,
}

describe('review queue state', () => {
  it('marks a line heard once and does not duplicate it', () => {
    const first = markSegmentHeard({ heardSegmentIds: [] }, segment.id)
    expect(first.heardSegmentIds).toEqual([segment.id])
    expect(markSegmentHeard(first, segment.id)).toBe(first)
  })

  it('keeps acknowledgement separate from timing provenance', () => {
    expect(acknowledgeSegment(segment, true)).toEqual({ needsReview: false, reviewReason: 'reviewed', reviewStatus: 'listened' })
    expect(acknowledgeSegment(segment, false)).toEqual({ needsReview: false, reviewReason: 'reviewed', reviewStatus: 'explicitly-accepted' })
  })

  it('returns edited or empty timing to review', () => {
    expect(editReviewState()).toMatchObject({ needsReview: true, reviewReason: 'manual-edit', reviewStatus: 'pending' })
    expect(editReviewState('empty-timing')).toMatchObject({ needsReview: true, reviewReason: 'empty-timing', reviewStatus: 'pending' })
  })
})
