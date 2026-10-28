import type { KaraProject, LyricSegment, NormalizedTranscript, TimeAnchor, TrackTimeMapping } from '../../shared/contracts'

function anchorsFor(mapping: TrackTimeMapping, assetId: string): TimeAnchor[] {
  return mapping.assetMappings.find((item) => item.assetId === assetId)?.anchors ?? []
}

function mapTime(value: number, anchors: TimeAnchor[], inverse: boolean): number {
  if (!anchors.length) return value
  const points = inverse
    ? anchors.map(({ sourceTime, timelineTime }) => ({ source: timelineTime, target: sourceTime }))
    : anchors.map(({ sourceTime, timelineTime }) => ({ source: sourceTime, target: timelineTime }))
  if (points.length === 1) return value + points[0].target - points[0].source
  let left = points[0]
  let right = points[1]
  if (value >= points.at(-1)!.source) {
    left = points.at(-2)!
    right = points.at(-1)!
  } else {
    for (let index = 1; index < points.length; index += 1) {
      if (value <= points[index].source) {
        left = points[index - 1]
        right = points[index]
        break
      }
    }
  }
  const ratio = (value - left.source) / (right.source - left.source)
  return left.target + ratio * (right.target - left.target)
}

export function assetTimeToTimeline(value: number, mapping: TrackTimeMapping, assetId?: string): number {
  if (!assetId) return value
  return Math.max(0, mapTime(value, anchorsFor(mapping, assetId), false))
}

export function timelineToAssetTime(value: number, mapping: TrackTimeMapping, assetId?: string): number {
  if (!assetId) return value
  return Math.max(0, mapTime(value, anchorsFor(mapping, assetId), true))
}

export function mapSegmentToAssetTime(segment: LyricSegment, mapping: TrackTimeMapping, assetId: string): LyricSegment {
  const map = (time: number) => timelineToAssetTime(time, mapping, assetId)
  return {
    ...segment,
    start: map(segment.start),
    end: map(segment.end),
    words: segment.words.map((word) => ({ ...word, start: map(word.start), end: map(word.end) })),
  }
}

export function mapSegmentsToAssetTime(segments: LyricSegment[], mapping: TrackTimeMapping, assetId: string): LyricSegment[] {
  return segments.map((segment) => mapSegmentToAssetTime(segment, mapping, assetId))
}

export function mapTranscriptToTimeline(transcript: NormalizedTranscript, mapping: TrackTimeMapping, assetId: string): NormalizedTranscript {
  const map = (time: number) => assetTimeToTimeline(time, mapping, assetId)
  return {
    ...transcript,
    segments: transcript.segments.map((segment) => ({
      ...segment,
      start: map(segment.start),
      end: map(segment.end),
      words: segment.words.map((word) => ({ ...word, start: map(word.start), end: map(word.end) })),
    })),
  }
}

export function getMappedAsset(project: KaraProject, assetId?: string) {
  return assetId ? project.assets.find((asset) => asset.id === assetId) : undefined
}
