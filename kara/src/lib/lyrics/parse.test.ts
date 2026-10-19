import { describe, expect, it } from 'vitest'
import { parseLyrics, lyricsToSegments, alignLyrics } from './parse'

describe('lyric import', () => {
  it('parses plain text without timing', () => {
    expect(parseLyrics('Dòng đầu\n\nDòng sau', 'lyrics.txt').map((line) => line.text)).toEqual(['Dòng đầu', 'Dòng sau'])
  })

  it('parses LRC timestamps and infers a line end', () => {
    const lines = parseLyrics('[00:01.20]Lời đầu\n[00:04.50]Lời sau', 'demo.lrc')
    expect(lines).toEqual([
      { text: 'Lời đầu', start: 1.2, end: 4.5 },
      { text: 'Lời sau', start: 4.5, end: 8 },
    ])
  })

  it('parses SRT and ASS cues', () => {
    expect(parseLyrics('1\n00:00:01,000 --> 00:00:02,500\nXin chào', 'a.srt')[0]).toMatchObject({ text: 'Xin chào', start: 1, end: 2.5 })
    expect(parseLyrics('[Events]\nDialogue: 0,0:00:01.20,0:00:02.40,Default,,0,0,0,,{\\k30}Xin chào', 'a.ass')[0]).toMatchObject({ text: 'Xin chào', start: 1.2, end: 2.4 })
  })

  it('creates editable lines and marks untimed lyrics for review', () => {
    const segments = lyricsToSegments([{ text: 'Xin chào' }])
    expect(segments[0].start).toBe(0)
    expect(segments[0].end).toBeGreaterThan(0)
    expect(segments[0].needsReview).toBe(true)
  })

  it('aligns lyrics to transcript timing and retains provider words', () => {
    const result = alignLyrics([{ text: 'Em ơi nghe câu hát' }], { segments: [{ id: '1', text: 'Em ơi nghe câu hát', start: 2, end: 5, speakerId: 'spk0', words: [{ id: 'w', text: 'Em', start: 2, end: 2.3 }] }] })
    expect(result[0]).toMatchObject({ start: 2, end: 5, providerSpeakerId: 'spk0' })
    expect(result[0].words).toHaveLength(1)
  })
})
