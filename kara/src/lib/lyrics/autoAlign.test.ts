import { describe, expect, it } from 'vitest'
import { alignTranscriptToLyrics } from './autoAlign'

const transcript = (segments: Array<{ text: string; start: number; end: number; words: Array<{ text: string; start: number; end: number }> }>) => ({
  segments: segments.map((segment, index) => ({ ...segment, id: `segment-${index + 1}`, confidence: 0.9, words: segment.words.map((word, wordIndex) => ({ ...word, id: `word-${index + 1}-${wordIndex + 1}`, confidence: 0.9 })) })),
})

describe('alignTranscriptToLyrics', () => {
  it('keeps Vietnamese lyric display text and transfers word timing', () => {
    const result = alignTranscriptToLyrics([{ text: 'Một câu hát', start: 1, end: 3 }], transcript([{ text: 'Mot cau hat', start: 1.1, end: 2.8, words: [{ text: 'Mot', start: 1.1, end: 1.5 }, { text: 'cau', start: 1.6, end: 2 }, { text: 'hat', start: 2.1, end: 2.8 }] }]))
    expect(result[0].text).toBe('Một câu hát')
    expect(result[0].words.map((word) => word.text)).toEqual(['Một', 'câu', 'hát'])
    expect(result[0].words[1].start).toBe(1.6)
    expect(result[0].needsReview).toBe(true)
    expect(result[0].reviewReason).toBe('recognition-timing')
  })

  it('splits one shared ASR word interval across multiple syllables and marks estimates for review', () => {
    const result = alignTranscriptToLyrics([{ text: 'xin chào', start: 1, end: 2 }], transcript([{ text: 'xin chào', start: 1, end: 2, words: [
      { text: 'xin chào', start: 1, end: 2 },
    ] }]))
    expect(result[0].words.map(({ start, end }) => [start, end])).toEqual([[1, 1.5], [1.5, 2]])
    expect(result[0].words.map((word) => word.origin)).toEqual(['estimated', 'estimated'])
    expect(result[0].needsReview).toBe(true)
    expect(result[0].reviewReason).toBe('estimated-timing')
  })

  it('downgrades clipped overlapping ASR word timings and keeps word order inside the line', () => {
    const result = alignTranscriptToLyrics([{ text: 'xin chào', start: 1, end: 2 }], transcript([{ text: 'xin chào', start: 1, end: 2, words: [
      { text: 'xin', start: 1, end: 1.8 }, { text: 'chào', start: 1.5, end: 2 },
    ] }]))
    expect(result[0].words[0].end).toBeLessThanOrEqual(result[0].words[1].start)
    expect(result[0].words.every((word) => word.start >= 1 && word.end <= 2 && word.origin === 'estimated')).toBe(true)
    expect(result[0].needsReview).toBe(true)
    expect(result[0].reviewReason).toBe('estimated-timing')
  })

  it('requires listening confirmation when lyric text matches but timing is only ASR', () => {
    const result = alignTranscriptToLyrics([{ text: 'Xin chào' }], transcript([{ text: 'Xin chào', start: 2, end: 3, words: [
      { text: 'Xin', start: 2, end: 2.4 }, { text: 'chào', start: 2.5, end: 3 },
    ] }]))
    expect(result[0].confidence).toBeCloseTo(0.9)
    expect(result[0].needsReview).toBe(true)
    expect(result[0].reviewReason).toBe('recognition-timing')
  })

  it('keeps experimental aligned timing in review even with a high model score', () => {
    const result = alignTranscriptToLyrics([{ text: 'Xin chào' }], {
      timingMethod: 'forced-alignment',
      segments: [{ id: 'aligned', text: 'Xin chào', start: 2, end: 3, words: [
        { id: 'a1', text: 'Xin', start: 2, end: 2.4, confidence: 0.98, origin: 'aligned' },
        { id: 'a2', text: 'chào', start: 2.5, end: 3, confidence: 0.98, origin: 'aligned' },
      ] }],
    })
    expect(result[0].needsReview).toBe(true)
    expect(result[0].reviewReason).toBe('recognition-timing')
  })

  it('re-estimates a line when overlapping anchors cannot form a monotonic word sequence', () => {
    const result = alignTranscriptToLyrics([{ text: 'xin chào em', start: 1, end: 3 }], transcript([{ text: 'xin chào em', start: 1, end: 3, words: [
      { text: 'xin', start: 1, end: 2.5 }, { text: 'chào', start: 1.5, end: 2 }, { text: 'em', start: 1.7, end: 2.2 },
    ] }]))
    expect(result[0].words[0].start).toBe(1)
    expect(result[0].words[0].end).toBeCloseTo(1 + 2 / 3)
    expect(result[0].words[1].start).toBeCloseTo(result[0].words[0].end)
    expect(result[0].words[2].end).toBe(3)
    expect(result[0].words.every((word) => word.origin === 'estimated')).toBe(true)
    expect(result[0].needsReview).toBe(true)
  })

  it('marks unmatched lyrics for review and interpolates safe word bounds', () => {
    const result = alignTranscriptToLyrics([{ text: 'Dòng không có trong audio' }], transcript([{ text: 'khác', start: 4, end: 5, words: [{ text: 'khác', start: 4, end: 5 }] }]))
    expect(result[0].needsReview).toBe(true)
    expect(result[0].words).toHaveLength(5)
    expect(result[0].words.every((word) => word.start >= result[0].start && word.end <= result[0].end)).toBe(true)
  })

  it('keeps timing for a clearly similar ASR token but marks the replacement for review', () => {
    const result = alignTranscriptToLyrics([{ text: 'beautiful day' }], transcript([{ text: 'beautifal day', start: 2, end: 3, words: [
      { text: 'beautifal', start: 2, end: 2.55 }, { text: 'day', start: 2.65, end: 3 },
    ] }]))
    expect(result[0].words[0].start).toBe(2)
    expect(result[0].words[0].end).toBe(2.55)
    expect(result[0].words[0].text).toBe('beautiful')
    expect(result[0].words[0].origin).toBe('estimated')
    expect(result[0].words[0].confidence).toBeLessThanOrEqual(0.35)
    expect(result[0].words[1].origin).toBe('asr')
    expect(result[0].needsReview).toBe(true)
  })

  it('uses the full lyric anchor interval to select the correct repeated chorus occurrence', () => {
    const chorus = [{ text: 'Ta cùng hát', start: 10, end: 12 }]
    const repeated = transcript([
      { text: 'Ta cùng hát', start: 1, end: 2, words: [
        { text: 'Ta', start: 1, end: 1.2 }, { text: 'cùng', start: 1.3, end: 1.6 }, { text: 'hát', start: 1.7, end: 2 },
      ] },
      { text: 'Ta cùng hát', start: 10, end: 11, words: [
        { text: 'Ta', start: 10, end: 10.2 }, { text: 'cùng', start: 10.3, end: 10.6 }, { text: 'hát', start: 10.7, end: 11 },
      ] },
    ])
    const result = alignTranscriptToLyrics(chorus, repeated)
    expect(result[0].words[0].start).toBe(10)
    expect(result[0].words.at(-1)?.end).toBe(11)
  })

  it('keeps repeated lyric occurrences in transcript order when the later anchor is absent', () => {
    const repeatedLyrics = [{ text: 'Ta cùng hát' }, { text: 'Ta cùng hát' }]
    const audio = transcript([
      { text: 'Ta cùng hát', start: 1, end: 2, words: [
        { text: 'Ta', start: 1, end: 1.2 }, { text: 'cùng', start: 1.3, end: 1.6 }, { text: 'hát', start: 1.7, end: 2 },
      ] },
      { text: 'Ta cùng hát', start: 10, end: 11, words: [
        { text: 'Ta', start: 10, end: 10.2 }, { text: 'cùng', start: 10.3, end: 10.6 }, { text: 'hát', start: 10.7, end: 11 },
      ] },
    ])
    const result = alignTranscriptToLyrics(repeatedLyrics, audio)
    expect(result[0].words[0].start).toBe(1)
    expect(result[1].words[0].start).toBe(10)
  })

  it('aligns an unanchored repeated stanza globally when the first chorus has noisier recognition', () => {
    const lyrics = [
      { text: 'Mở đầu câu hát' },
      { text: 'Trái tim này yêu em' },
      { text: 'Mãi mãi bên nhau' },
      { text: 'Trái tim này yêu em' },
      { text: 'Mãi mãi bên nhau' },
      { text: 'Kết thúc bài ca' },
    ]
    const audio = transcript([
      { text: 'Mở đầu câu hát', start: 1, end: 3, words: [
        { text: 'Mở', start: 1, end: 1.3 }, { text: 'đầu', start: 1.4, end: 1.7 }, { text: 'câu', start: 1.8, end: 2.2 }, { text: 'hát', start: 2.3, end: 3 },
      ] },
      { text: 'Trái tim này yêu em', start: 4, end: 6, words: [
        { text: 'Trái', start: 4, end: 4.3 }, { text: 'tinh', start: 4.4, end: 4.7 }, { text: 'này', start: 4.8, end: 5.1 }, { text: 'yêu', start: 5.2, end: 5.5 }, { text: 'em', start: 5.6, end: 6 },
      ] },
      { text: 'Mãi mãi bên nhau', start: 7, end: 9, words: [
        { text: 'Mãi', start: 7, end: 7.4 }, { text: 'mãi', start: 7.5, end: 7.9 }, { text: 'bên', start: 8, end: 8.4 }, { text: 'nhau', start: 8.5, end: 9 },
      ] },
      { text: 'Trái tim này yêu em', start: 12, end: 14, words: [
        { text: 'Trái', start: 12, end: 12.3 }, { text: 'tim', start: 12.4, end: 12.7 }, { text: 'này', start: 12.8, end: 13.1 }, { text: 'yêu', start: 13.2, end: 13.5 }, { text: 'em', start: 13.6, end: 14 },
      ] },
      { text: 'Mãi mãi bên nhau', start: 15, end: 17, words: [
        { text: 'Mãi', start: 15, end: 15.4 }, { text: 'mãi', start: 15.5, end: 15.9 }, { text: 'bên', start: 16, end: 16.4 }, { text: 'nhau', start: 16.5, end: 17 },
      ] },
      { text: 'Kết thúc bài ca', start: 18, end: 20, words: [
        { text: 'Kết', start: 18, end: 18.4 }, { text: 'thúc', start: 18.5, end: 18.9 }, { text: 'bài', start: 19, end: 19.4 }, { text: 'ca', start: 19.5, end: 20 },
      ] },
    ])

    const result = alignTranscriptToLyrics(lyrics, audio)

    expect(result[1].start).toBe(4)
    expect(result[2].start).toBe(7)
    expect(result[3].start).toBe(12)
    expect(result[4].start).toBe(15)
    expect(result[5].start).toBe(18)
    expect(result.every((line, index) => index === 0 || line.start >= result[index - 1].end)).toBe(true)
  })

  it('reserves the only repeated occurrence for a later line with a matching anchor', () => {
    const repeatedLyrics = [{ text: 'Ta cùng hát' }, { text: 'Ta cùng hát', start: 10, end: 11 }]
    const audio = transcript([
      { text: 'Ta cùng hát', start: 10, end: 11, words: [
        { text: 'Ta', start: 10, end: 10.2 }, { text: 'cùng', start: 10.3, end: 10.6 }, { text: 'hát', start: 10.7, end: 11 },
      ] },
    ])

    const result = alignTranscriptToLyrics(repeatedLyrics, audio)

    expect(result[0].needsReview).toBe(true)
    expect(result[0].words.every((word) => word.origin === 'estimated')).toBe(true)
    expect(result[1].words[0].start).toBe(10)
    expect(result[1].needsReview).toBe(true)
    expect(result[1].reviewReason).toBe('recognition-timing')
  })

  it('keeps an earlier unanchored occurrence when a later repeated occurrence is reserved', () => {
    const repeatedLyrics = [{ text: 'Ta cùng hát' }, { text: 'Ta cùng hát', start: 10, end: 11 }]
    const audio = transcript([
      { text: 'Ta cùng hát', start: 1, end: 2, words: [
        { text: 'Ta', start: 1, end: 1.2 }, { text: 'cùng', start: 1.3, end: 1.6 }, { text: 'hát', start: 1.7, end: 2 },
      ] },
      { text: 'Ta cùng hát', start: 10, end: 11, words: [
        { text: 'Ta', start: 10, end: 10.2 }, { text: 'cùng', start: 10.3, end: 10.6 }, { text: 'hát', start: 10.7, end: 11 },
      ] },
    ])

    const result = alignTranscriptToLyrics(repeatedLyrics, audio)

    expect(result[0].words[0].start).toBe(1)
    expect(result[1].words[0].start).toBe(10)
  })

  it('aligns long anchored lyric sheets in monotonic time windows', () => {
    const lines = Array.from({ length: 240 }, (_, index) => ({ text: `mot cau ${index}`, start: index * 2, end: index * 2 + 1.5 }))
    const words = lines.flatMap((line, index) => line.text.split(' ').map((text, wordIndex) => ({ text, start: index * 2 + wordIndex * 0.2, end: index * 2 + wordIndex * 0.2 + 0.12 })))
    const result = alignTranscriptToLyrics(lines, transcript([{ text: lines.map((line) => line.text).join(' '), start: 0, end: 480, words }]))

    expect(result).toHaveLength(lines.length)
    expect(result[0].words[0].start).toBe(0)
    expect(result[119].words[0].start).toBe(238)
    expect(result.at(-1)?.words[0].start).toBe(478)
    expect(result.every((line) => line.needsReview && line.reviewReason === 'recognition-timing')).toBe(true)
  })
})
