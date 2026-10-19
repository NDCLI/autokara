import { describe, expect, it } from 'vitest'
import { formatTimecode, parseAssTimecode, parseTimecode } from './timecode'

describe('timecode helpers', () => {
  it('formats and parses subtitle timestamps with millisecond precision', () => {
    expect(formatTimecode(62.375)).toBe('00:01:02,375')
    expect(parseTimecode('00:01:02,375')).toBe(62.375)
    expect(parseTimecode('00:01:02.375')).toBe(62.375)
  })

  it('parses ASS centisecond timestamps', () => {
    expect(parseAssTimecode('1:02:03.45')).toBe(3723.45)
  })

  it('rejects malformed input', () => {
    expect(parseTimecode('1:02')).toBeNull()
  })
})
