import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT_OPTIONS, type LyricSegment } from '../../../shared/contracts'
import { buildAss, buildSrt } from './subtitles'

const sample: LyricSegment[] = [{ id: '1', text: 'Xin chào em', start: 1, end: 2.6, speakerRole: 'female', words: [{ id: 'w1', text: 'Xin', start: 1, end: 1.4 }, { id: 'w2', text: 'chào', start: 1.4, end: 2 }, { id: 'w3', text: 'em', start: 2, end: 2.6 }] }]

describe('subtitle exporters', () => {
  it('builds an SRT cue with Vietnamese text and speaker prefix', () => {
    expect(buildSrt(sample, DEFAULT_EXPORT_OPTIONS)).toContain('00:00:01,000 --> 00:00:02,720\nNỮ: Xin chào em')
  })

  it('builds ASS karaoke tags and speaker styles', () => {
    const result = buildAss(sample, DEFAULT_EXPORT_OPTIONS)
    expect(result).toContain('Style: Female')
    expect(result).toContain('Dialogue: 0,0:00:01.00,0:00:02.72,Female')
    expect(result).toContain('{\\k40}Xin {\\k60}chào {\\k60}em')
  })

  it('escapes ASS control braces and line breaks', () => {
    const value = [{ ...sample[0], text: '{\u001bhello}\nworld', words: [] }]
    expect(buildAss(value, { ...DEFAULT_EXPORT_OPTIONS, includeSpeakerPrefix: false, includeKaraokeTags: false })).toContain('helloworld')
  })
})
