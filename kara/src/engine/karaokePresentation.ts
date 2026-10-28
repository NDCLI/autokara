import type { LyricSegment } from '../../shared/contracts'

export type KaraokeLane = { index: number; count: number }
export type CountdownCue = { start: number; end: number; value: number }

const COUNTDOWN_MIN_GAP_SECONDS = 1.1
const COUNTDOWN_MAX_SECONDS = 3

export function activeLyricSegments(segments: LyricSegment[], time: number, leadInMs = 0, leadOutMs = 0): LyricSegment[] {
  const leadIn = Math.max(0, leadInMs) / 1000
  const leadOut = Math.max(0, leadOutMs) / 1000
  return segments
    .filter((segment) => time >= segment.start - leadIn && time < segment.end + leadOut)
    .sort((a, b) => a.start - b.start || a.end - b.end)
}

export function assignKaraokeLanes(segments: LyricSegment[], leadInMs = 0, leadOutMs = 0): Map<string, KaraokeLane> {
  const leadIn = Math.max(0, leadInMs) / 1000
  const leadOut = Math.max(0, leadOutMs) / 1000
  const ordered = segments
    .map((segment) => ({ segment, start: segment.start - leadIn, end: segment.end + leadOut }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const lanesBySegment = new Map<string, KaraokeLane>()
  let cluster: typeof ordered = []
  let clusterEnd = Number.NEGATIVE_INFINITY

  function flushCluster() {
    if (!cluster.length) return
    const laneEnds: number[] = []
    const assignments: Array<{ id: string; index: number }> = []
    for (const entry of cluster) {
      let index = laneEnds.findIndex((end) => end <= entry.start)
      if (index < 0) index = laneEnds.length
      laneEnds[index] = entry.end
      assignments.push({ id: entry.segment.id, index })
    }
    const count = laneEnds.length
    for (const assignment of assignments) lanesBySegment.set(assignment.id, { index: assignment.index, count })
    cluster = []
    clusterEnd = Number.NEGATIVE_INFINITY
  }

  for (const entry of ordered) {
    if (cluster.length && entry.start >= clusterEnd) flushCluster()
    cluster.push(entry)
    clusterEnd = Math.max(clusterEnd, entry.end)
  }
  flushCluster()
  return lanesBySegment
}

export function karaokeLanePositionY(baseY: number, lane: KaraokeLane | undefined): number {
  if (!lane || lane.count < 2) return Math.max(0.04, Math.min(0.96, baseY))
  const offset = (lane.index - (lane.count - 1) / 2) * 0.06
  return Math.max(0.04, Math.min(0.96, baseY + offset))
}

export function countdownCues(previous: LyricSegment, next: LyricSegment, leadInMs = 0, leadOutMs = 0): CountdownCue[] {
  const start = previous.end
  const end = next.start - Math.max(0, leadInMs) / 1000
  const duration = end - start
  if (duration < COUNTDOWN_MIN_GAP_SECONDS) return []
  const cues: CountdownCue[] = []
  for (let value = Math.min(COUNTDOWN_MAX_SECONDS, Math.ceil(duration)); value >= 1; value -= 1) {
    const cueStart = Math.max(start, end - value)
    const cueEnd = Math.min(end, end - value + 1)
    if (cueEnd - cueStart >= 0.1) cues.push({ start: cueStart, end: cueEnd, value })
  }
  return cues
}

export function countdownValueAtTime(previous: LyricSegment | undefined, next: LyricSegment | undefined, time: number, leadInMs = 0, leadOutMs = 0): number | undefined {
  if (!previous || !next) return undefined
  const cues = countdownCues(previous, next, leadInMs, leadOutMs)
  return cues.find((cue) => time >= cue.start && time < cue.end)?.value
}
