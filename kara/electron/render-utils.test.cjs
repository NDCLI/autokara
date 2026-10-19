const { describe, expect, it } = require('vitest')
const { buildFfmpegArgs, escapeFilterPath, parseProgressLine } = require('./render-utils.cjs')

describe('FFmpeg render utilities', () => {
  it('builds an argument array for a generated background and MP4', () => {
    const args = buildFfmpegArgs({
      audioPath: 'D:\\Songs\\track.wav',
      subtitlePath: 'D:\\Temp\\kara.ass',
      outputPath: 'D:\\Videos\\result.mp4',
      video: { width: 1920, height: 1080, backgroundColor: '#10162a' },
    })
    expect(args).toContain('color=c=0x10162a:s=1920x1080:r=30')
    expect(args).toContain('libx264')
    expect(args).toContain('aac')
    expect(args).toContain('-shortest')
    expect(args).toContain('D:\\Songs\\track.wav')
    expect(args.find((arg) => arg.startsWith('subtitles='))).toContain('D\\:/Temp/kara.ass')
  })

  it('escapes filter delimiters in Windows paths', () => {
    expect(escapeFilterPath("C:\\My, Videos\\a'b.ass")).toBe("C\\:/My\\, Videos/a\\'b.ass")
  })

  it('parses FFmpeg progress and caps active jobs below completion', () => {
    expect(parseProgressLine('out_time=00:00:05.000', 10)).toEqual({ percent: 50, status: 'Đang mã hóa · 50%' })
    expect(parseProgressLine('progress=end', 10)).toEqual({ percent: 100, status: 'Hoàn tất mã hóa…' })
    expect(parseProgressLine('out_time=N/A', 10)).toBeNull()
  })

  it('rejects an untrusted invalid background before constructing arguments', () => {
    expect(() => buildFfmpegArgs({ audioPath: 'a.wav', subtitlePath: 'a.ass', outputPath: 'a.mp4', video: { width: 1920, height: 1080, backgroundColor: 'red' } })).toThrow('Màu nền')
  })
})
