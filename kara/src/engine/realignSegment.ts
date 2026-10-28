import type { LyricSegment, NormalizedTranscript } from '../../shared/contracts'
import { alignTranscriptToLyrics } from '../lib/lyrics/autoAlign'
import { preserveLockedTimings } from './preserveLockedTimings'

export function realignSegmentFromTranscript(segment: LyricSegment, transcript: NormalizedTranscript, windowSeconds = 8): LyricSegment | undefined {
  if (segment.timingLocked || !Number.isFinite(windowSeconds) || windowSeconds < 0) return undefined
  const localSegments = transcript.segments.filter((item) => item.end >= segment.start - windowSeconds && item.start <= segment.end + windowSeconds)
  if (!localSegments.length) return undefined
  const candidate = alignTranscriptToLyrics([{ text: segment.text, start: segment.start, end: segment.end }], {
    ...transcript,
    segments: localSegments,
  })[0]
  if (!candidate) return undefined
  const preserved = preserveLockedTimings([segment], [candidate])[0] ?? candidate
  return {
    ...segment,
    ...preserved,
    id: segment.id,
    speakerRole: segment.speakerRole,
    providerSpeakerId: preserved.providerSpeakerId ?? segment.providerSpeakerId,
  }
}
