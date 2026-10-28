import { describe, expect, it } from 'vitest'
import { estimateTrackOffset, offsetToAnchor } from './trackSync'

function audioBuffer(samples: Float32Array, sampleRate = 1000): AudioBuffer {
  return {
    sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as unknown as AudioBuffer
}

function pulsedEnvelope(offsetFrames: number, frameCount = 300): Float32Array {
  const samples = new Float32Array(frameCount * 50)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const pulse = Math.sin(frame * 0.19 + Math.sin(frame * 0.031) * 0.5) > 0.25 ? 0.7 : 0.04
    const target = frame + offsetFrames
    if (target < 0 || target >= frameCount) continue
    for (let sample = target * 50; sample < (target + 1) * 50; sample += 1) samples[sample] = pulse
  }
  return samples
}

function variableTempoBuffers(frameCount: number, rate: number, delayedFrames = 0): [Float32Array, Float32Array] {
  const reference = Array.from({ length: frameCount }, (_, frame) =>
    0.2 + 0.16 * Math.sin(frame * 0.037 + 0.45 * Math.sin(frame * 0.0021))
    + 0.12 * Math.sin(frame * 0.011 + 0.2 * Math.sin(frame * 0.0008))
    + 0.08 * Math.sin(frame * 0.093),
  )
  const referenceSamples = new Float32Array(frameCount * 50)
  reference.forEach((value, frame) => {
    for (let sample = frame * 50; sample < (frame + 1) * 50; sample += 1) referenceSamples[sample] = value
  })
  const candidateFrames = Math.ceil(frameCount * (1 + rate))
  const samples = new Float32Array(candidateFrames * 50)
  for (let frame = 0; frame < candidateFrames; frame += 1) {
    const originalFrame = Math.floor((frame - delayedFrames) / (1 + rate))
    const value = reference[originalFrame] ?? 0
    for (let sample = frame * 50; sample < (frame + 1) * 50; sample += 1) samples[sample] = value
  }
  return [referenceSamples, samples]
}
describe('automatic track offset estimation', () => {
  it('estimates a candidate that starts later than the reference', () => {
    const estimate = estimateTrackOffset(audioBuffer(pulsedEnvelope(0)), audioBuffer(pulsedEnvelope(12)))
    expect(estimate?.offset).toBeCloseTo(0.6, 1)
    expect(estimate?.confidence).toBeGreaterThan(0.7)
    expect(offsetToAnchor(estimate!.offset).sourceTime).toBeCloseTo(0.6, 5)
    expect(offsetToAnchor(estimate!.offset).timelineTime).toBe(0)
  })

  it('estimates a candidate that starts earlier and converts it to a valid zero anchor', () => {
    const estimate = estimateTrackOffset(audioBuffer(pulsedEnvelope(0)), audioBuffer(pulsedEnvelope(-8)))
    expect(estimate?.offset).toBeCloseTo(-0.4, 1)
    expect(offsetToAnchor(estimate!.offset)).toEqual({ sourceTime: 0, timelineTime: 0.4 })
  })

  it('refuses a silent or too-short comparison', () => {
    expect(estimateTrackOffset(audioBuffer(new Float32Array(20_000)), audioBuffer(new Float32Array(20_000)))).toBeUndefined()
  })

  it('suggests two monotonic anchors when offset drifts over a long track', () => {
    const [reference, candidate] = variableTempoBuffers(6000, 0.005)
    const estimate = estimateTrackOffset(audioBuffer(reference), audioBuffer(candidate))
    expect(estimate?.anchors).toHaveLength(2)
    expect(estimate!.anchors![0].sourceTime).toBeLessThan(estimate!.anchors![1].sourceTime)
    expect(estimate!.anchors![0].timelineTime).toBeLessThan(estimate!.anchors![1].timelineTime)
    expect(estimate?.driftPercent).toBeCloseTo(-0.5, 1)
  })
})
