import { describe, expect, it } from 'vitest'
import { benchmarkAlignment, validateBenchmarkDataset } from './alignmentBenchmark'

const sample = {
  id: 'clip-1',
  duration: 4,
  lines: [{ text: 'Xin chào', start: 1, end: 2 }],
  transcript: { segments: [{ id: 'asr', text: 'Xin chào', start: 1, end: 2, confidence: 0.9, words: [
    { id: 'w1', text: 'Xin', start: 1, end: 1.4, confidence: 0.9 },
    { id: 'w2', text: 'chào', start: 1.5, end: 2, confidence: 0.9 },
  ] }] },
  referenceWords: [
    { lineIndex: 0, text: 'Xin', start: 1.05, end: 1.45 },
    { lineIndex: 0, text: 'chào', start: 1.5, end: 2 },
  ],
}

describe('alignment benchmark', () => {
  it('reports onset/offset error, evidence coverage and processing ratio', () => {
    const report = benchmarkAlignment({ name: 'smoke', samples: [sample] })
    expect(report.aggregate.sampleCount).toBe(1)
    expect(report.aggregate.timingComparedWordCount).toBe(2)
    expect(report.aggregate.evidenceBackedCoverage).toBe(0)
    expect(report.aggregate.unverifiedTimingWordCount).toBe(2)
    expect(report.aggregate.onset.medianMs).toBe(25)
    expect(report.aggregate.offset.medianMs).toBe(25)
    expect(report.aggregate.onset.within200Rate).toBe(1)
    expect(report.aggregate.songMacroOnsetMedianMs.count).toBe(1)
    expect(report.samples[0].onset.medianMs).toBe(25)
    expect(report.samples[0].processingRatio).toBeGreaterThan(0)
  })

  it('reports equal-weight song medians alongside pooled word metrics', () => {
    const shifted = {
      ...sample,
      id: 'clip-2',
      referenceWords: [
        { lineIndex: 0, text: 'Xin', start: 1.5, end: 1.9 },
        { lineIndex: 0, text: 'chào', start: 2, end: 2.5 },
      ],
    }
    const report = benchmarkAlignment({ samples: [sample, shifted] })
    expect(report.aggregate.sampleCount).toBe(2)
    expect(report.aggregate.songMacroOnsetMedianMs.count).toBe(2)
    expect(report.aggregate.songMacroOnsetMedianMs.medianMs).not.toBe(report.aggregate.onset.medianMs)
    expect(report.samples[1].timingComparedWords).toBe(2)
  })

  it('compares the current matcher against the frozen legacy matcher on repeated-line anchors', () => {
    const repeated = {
      name: 'repeat-anchor',
      samples: [{
        id: 'repeat-clip',
        duration: 15,
        lines: [
          { text: 'Mở đầu', start: 1, end: 2 },
          { text: 'Điệp khúc', start: 8, end: 9 },
          { text: 'Điệp khúc', start: 11, end: 12 },
          { text: 'Kết thúc', start: 13, end: 14 },
        ],
        transcript: { segments: [
          { id: 'open', text: 'Mở đầu', start: 1, end: 2, words: [{ id: 'o1', text: 'Mở', start: 1, end: 1.4 }, { id: 'o2', text: 'đầu', start: 1.5, end: 2 }] },
          { id: 'chorus-1', text: 'Điệp khúc', start: 3, end: 4, words: [{ id: 'c1a', text: 'Điệp', start: 3, end: 3.4 }, { id: 'c1b', text: 'khúc', start: 3.5, end: 4 }] },
          { id: 'chorus-2', text: 'Điệp khúc', start: 8, end: 9, words: [{ id: 'c2a', text: 'Điệp', start: 8, end: 8.4 }, { id: 'c2b', text: 'khúc', start: 8.5, end: 9 }] },
          { id: 'chorus-3', text: 'Điệp khúc', start: 11, end: 12, words: [{ id: 'c3a', text: 'Điệp', start: 11, end: 11.4 }, { id: 'c3b', text: 'khúc', start: 11.5, end: 12 }] },
          { id: 'outro', text: 'Kết thúc', start: 13, end: 14, words: [{ id: 'e1', text: 'Kết', start: 13, end: 13.4 }, { id: 'e2', text: 'thúc', start: 13.5, end: 14 }] },
        ] },
        referenceWords: [
          { lineIndex: 0, text: 'Mở', start: 1, end: 1.4 }, { lineIndex: 0, text: 'đầu', start: 1.5, end: 2 },
          { lineIndex: 1, text: 'Điệp', start: 8, end: 8.4 }, { lineIndex: 1, text: 'khúc', start: 8.5, end: 9 },
          { lineIndex: 2, text: 'Điệp', start: 11, end: 11.4 }, { lineIndex: 2, text: 'khúc', start: 11.5, end: 12 },
          { lineIndex: 3, text: 'Kết', start: 13, end: 13.4 }, { lineIndex: 3, text: 'thúc', start: 13.5, end: 14 },
        ],
      }],
    }
    const report = benchmarkAlignment(repeated)
    expect(report.baseline.aggregate.repeatedLineOccurrenceMisses).toBe(2)
    expect(report.aggregate.repeatedLineOccurrenceMisses).toBe(0)
    expect(report.comparison.repeatedLineOccurrenceMissDelta).toBe(-2)
  })

  it('rejects annotations that fall outside the clip', () => {
    expect(() => validateBenchmarkDataset({ samples: [{ ...sample, referenceWords: [{ ...sample.referenceWords[0], end: 8 }] }] }))
      .toThrow(/Reference word/)
  })

  it('rejects invalid lyric anchors and transcript words outside their segment', () => {
    expect(() => validateBenchmarkDataset({ samples: [{ ...sample, lines: [{ text: 'Xin chào', start: 3, end: 2 }] }] }))
      .toThrow(/mốc thời gian lyric/)
    expect(() => validateBenchmarkDataset({ samples: [{ ...sample, transcript: { segments: [{ ...sample.transcript.segments[0], words: [{ ...sample.transcript.segments[0].words[0], start: 0.2 }, sample.transcript.segments[0].words[1]] }] } }] }))
      .toThrow(/transcript segment\/word/)
  })

  it('rejects duplicate sample ids to prevent accidental double weighting', () => {
    expect(() => validateBenchmarkDataset({ samples: [sample, sample] })).toThrow(/Sample 2/)
  })
})
