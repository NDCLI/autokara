import type { LyricSegment } from '../../shared/contracts'

export type ReviewQueueState = {
  heardSegmentIds: string[]
}

export function markSegmentHeard(state: ReviewQueueState, segmentId: string): ReviewQueueState {
  return state.heardSegmentIds.includes(segmentId)
    ? state
    : { heardSegmentIds: [...state.heardSegmentIds, segmentId] }
}

export function acknowledgeSegment(_segment: LyricSegment, heard: boolean): Partial<LyricSegment> {
  return {
    needsReview: false,
    reviewReason: 'reviewed',
    reviewStatus: heard ? 'listened' : 'explicitly-accepted',
  }
}

export function editReviewState(reason: 'empty-timing' | 'manual-edit' = 'manual-edit'): Partial<LyricSegment> {
  return {
    needsReview: true,
    reviewReason: reason,
    reviewStatus: 'pending',
  }
}

