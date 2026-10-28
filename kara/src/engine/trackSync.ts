import type { TimeAnchor } from '../../shared/contracts'

export type SyncEstimate = { offset: number; confidence: number; comparedSeconds: number; anchors?: TimeAnchor[]; driftPercent?: number }

function rmsEnvelope(buffer: AudioBuffer, frameSeconds: number): Float32Array {
  const frameSize = Math.max(1, Math.round(buffer.sampleRate * frameSeconds))
  const frames = Math.floor(buffer.length / frameSize)
  const envelope = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame += 1) {
    const from = frame * frameSize
    const to = from + frameSize
    let energy = 0
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel)
      for (let index = from; index < to; index += 1) energy += samples[index] * samples[index]
    }
    envelope[frame] = Math.sqrt(energy / (frameSize * buffer.numberOfChannels))
  }
  return envelope
}

function normalizedCorrelation(reference: Float32Array, candidate: Float32Array, offsetFrames: number): number | undefined {
  const startA = Math.max(0, -offsetFrames)
  const startB = Math.max(0, offsetFrames)
  const count = Math.min(reference.length - startA, candidate.length - startB)
  if (count < 40) return undefined
  let sumA = 0
  let sumB = 0
  let squareA = 0
  let squareB = 0
  let cross = 0
  for (let index = 0; index < count; index += 1) {
    const a = reference[startA + index]
    const b = candidate[startB + index]
    sumA += a
    sumB += b
    squareA += a * a
    squareB += b * b
    cross += a * b
  }
  const covariance = cross - sumA * sumB / count
  const varianceA = squareA - sumA * sumA / count
  const varianceB = squareB - sumB * sumB / count
  const denominator = Math.sqrt(varianceA * varianceB)
  return denominator > 1e-10 ? covariance / denominator : undefined
}

function windowCorrelation(reference: Float32Array, candidate: Float32Array, center: number, halfWindow: number, offsetFrames: number): number | undefined {
  const referenceStart = center - halfWindow
  const candidateStart = referenceStart + offsetFrames
  const count = halfWindow * 2
  if (referenceStart < 0 || candidateStart < 0 || referenceStart + count > reference.length || candidateStart + count > candidate.length) return undefined
  let sumA = 0
  let sumB = 0
  let squareA = 0
  let squareB = 0
  let cross = 0
  for (let index = 0; index < count; index += 1) {
    const a = reference[referenceStart + index]
    const b = candidate[candidateStart + index]
    sumA += a
    sumB += b
    squareA += a * a
    squareB += b * b
    cross += a * b
  }
  const covariance = cross - sumA * sumB / count
  const varianceA = squareA - sumA * sumA / count
  const varianceB = squareB - sumB * sumB / count
  const denominator = Math.sqrt(varianceA * varianceB)
  return denominator > 1e-10 ? covariance / denominator : undefined
}

function estimateDriftAnchors(reference: Float32Array, candidate: Float32Array, frameSeconds: number): { anchors: TimeAnchor[]; driftPercent: number; confidence: number } | undefined {
  const halfWindow = Math.min(200, Math.floor(Math.min(reference.length, candidate.length) / 8))
  if (halfWindow < 80) return undefined
  const commonEnd = Math.min(reference.length, candidate.length) - halfWindow
  const step = Math.max(400, Math.floor((commonEnd - halfWindow) / 8))
  const maxOffset = Math.min(200, Math.floor(Math.min(reference.length, candidate.length) * 0.15))
  const points: Array<{ timelineTime: number; offset: number; score: number }> = []
  for (let center = halfWindow; center <= commonEnd; center += step) {
    let bestOffset = 0
    let best = -Infinity
    let second = -Infinity
    for (let offset = -maxOffset; offset <= maxOffset; offset += 1) {
      const score = windowCorrelation(reference, candidate, center, halfWindow, offset)
      if (score === undefined) continue
      if (score > best) { second = best; best = score; bestOffset = offset }
      else if (Math.abs(offset - bestOffset) > 2 && score > second) second = score
    }
    if (best >= 0.4) {
      points.push({ timelineTime: center * frameSeconds, offset: bestOffset * frameSeconds, score: Math.max(0, best) })
    }
  }
  if (points.length < 5) return undefined

  const slopes: number[] = []
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const timeDelta = points[right].timelineTime - points[left].timelineTime
      if (timeDelta < 30) continue
      slopes.push((points[right].offset - points[left].offset) / timeDelta)
    }
  }
  if (!slopes.length) return undefined
  slopes.sort((a, b) => a - b)
  const driftRate = slopes[Math.floor(slopes.length / 2)]
  if (Math.abs(driftRate) < 0.001) return undefined
  const intercepts = points.map((point) => point.offset - driftRate * point.timelineTime).sort((a, b) => a - b)
  const intercept = intercepts[Math.floor(intercepts.length / 2)]
  const residuals = points.map((point) => Math.abs(point.offset - (intercept + driftRate * point.timelineTime))).sort((a, b) => a - b)
  if (residuals[Math.floor(residuals.length / 2)] > 0.3) return undefined

  const startTime = points[0].timelineTime
  const endTime = points.at(-1)!.timelineTime
  const anchors = [startTime, endTime].map((timelineTime) => ({
    timelineTime,
    sourceTime: timelineTime + intercept + driftRate * timelineTime,
  })).filter((anchor) => anchor.sourceTime >= 0 && Number.isFinite(anchor.sourceTime))
  if (anchors.length !== 2 || anchors[1].sourceTime <= anchors[0].sourceTime) return undefined
  const confidence = points.reduce((total, point) => total + point.score, 0) / points.length
  return { anchors, driftPercent: ((1 / (1 + driftRate)) - 1) * 100, confidence }
}

/** Positive offset means matching candidate content occurs later, so source time maps back to the reference timeline. */
export function estimateTrackOffset(referenceBuffer: AudioBuffer, candidateBuffer: AudioBuffer): SyncEstimate | undefined {
  const frameSeconds = 0.05
  const reference = rmsEnvelope(referenceBuffer, frameSeconds)
  const candidate = rmsEnvelope(candidateBuffer, frameSeconds)
  const maxOffset = Math.min(200, Math.floor(Math.min(reference.length, candidate.length) * 0.45))
  let bestOffset = 0
  let best = -Infinity
  let second = -Infinity
  for (let offset = -maxOffset; offset <= maxOffset; offset += 1) {
    const score = normalizedCorrelation(reference, candidate, offset)
    if (score === undefined) continue
    if (score > best) {
      second = best
      best = score
      bestOffset = offset
    } else if (Math.abs(offset - bestOffset) > 2 && score > second) second = score
  }
  if (!Number.isFinite(best)) return undefined
  const comparedSeconds = Math.min(reference.length - Math.max(0, -bestOffset), candidate.length - Math.max(0, bestOffset)) * frameSeconds
  const confidence = Math.max(0, Math.min(1, best * (0.7 + Math.min(0.3, Math.max(0, best - second) * 3))))
  const drift = estimateDriftAnchors(reference, candidate, frameSeconds)
  if (drift && drift.confidence >= 0.7) return { offset: bestOffset * frameSeconds, confidence: drift.confidence, comparedSeconds, anchors: drift.anchors, driftPercent: drift.driftPercent }
  if (best < 0.45 || comparedSeconds < 2) return { offset: bestOffset * frameSeconds, confidence, comparedSeconds }
  return { offset: bestOffset * frameSeconds, confidence, comparedSeconds }
}

export function offsetToAnchor(offset: number): TimeAnchor {
  return { sourceTime: Math.max(0, offset), timelineTime: Math.max(0, -offset) }
}
