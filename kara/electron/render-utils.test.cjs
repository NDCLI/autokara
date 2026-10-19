const { describe, expect, it } = require('vitest')
const { assertOutputDoesNotMatchInputs, buildFfmpegArgs, escapeFilterPath, parseProgressLine, publishRenderOutput } = require('./render-utils.cjs')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

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

  it('builds arguments for a looping video background with audio mapping and subtitles', () => {
    const args = buildFfmpegArgs({
      audioPath: 'D:\\Songs\\track.wav',
      backgroundPath: 'D:\\Videos\\background.mp4',
      subtitlePath: 'D:\\Temp\\kara.ass',
      outputPath: 'D:\\Videos\\result.mp4',
      video: { width: 1280, height: 720, backgroundColor: '#223344' },
    })
    expect(args).toContain('-stream_loop')
    expect(args).toContain('-1')
    expect(args).toContain('D:\\Videos\\background.mp4')
    expect(args).toContain('-map')
    expect(args).toContain('0:v:0')
    expect(args).toContain('1:a:0')
    expect(args.find((arg) => arg.includes('scale=1280:720'))).toContain('color=0x223344')
  })

  it('rejects output paths that collide with source media', () => {
    expect(() => assertOutputDoesNotMatchInputs('C:\\Music\\song.mp4', 'C:\\Music\\song.mp4')).toThrow('không được trùng')
    expect(() => assertOutputDoesNotMatchInputs('C:\\Video\\OUT.mp4', 'c:\\video\\out.mp4')).toThrow('không được trùng')
    expect(() => assertOutputDoesNotMatchInputs('C:\\Video\\out.mp4', 'C:\\Music\\song.mp4', 'C:\\Video\\bg.mp4')).not.toThrow()
  })

  it('rejects odd and oversized dimensions before constructing FFmpeg arguments', () => {
    expect(() => buildFfmpegArgs({ audioPath: 'a.wav', subtitlePath: 'a.ass', outputPath: 'a.mp4', video: { width: 1279, height: 720, backgroundColor: '#10162a' } })).toThrow('Kích thước')
    expect(() => buildFfmpegArgs({ audioPath: 'a.wav', subtitlePath: 'a.ass', outputPath: 'a.mp4', video: { width: 4000, height: 2160, backgroundColor: '#10162a' } })).toThrow('Kích thước')
  })

  it('rejects an invalid background color before constructing FFmpeg arguments', () => {
    expect(() => buildFfmpegArgs({ audioPath: 'a.wav', subtitlePath: 'a.ass', outputPath: 'a.mp4', video: { width: 1920, height: 1080, backgroundColor: 'red' } })).toThrow('Màu nền')
  })

  it('preserves an existing output when the completed temporary file is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-render-'))
    const output = path.join(root, 'output.mp4')
    await fs.writeFile(output, 'original')
    await expect(publishRenderOutput(path.join(root, 'missing-temp.mp4'), output)).rejects.toThrow()
    await expect(fs.readFile(output, 'utf8')).resolves.toBe('original')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('restores an existing output when cancellation arrives after the backup step', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-render-'))
    const output = path.join(root, 'output.mp4')
    const temp = path.join(root, 'temp.mp4')
    await fs.writeFile(output, 'original')
    await fs.writeFile(temp, 'new')
    let checks = 0
    await expect(publishRenderOutput(temp, output, { isCanceled: () => ++checks > 1 })).resolves.toEqual({ status: 'canceled' })
    await expect(fs.readFile(output, 'utf8')).resolves.toBe('original')
    await expect(fs.readdir(root)).resolves.toEqual(['output.mp4', 'temp.mp4'])
    await fs.rm(root, { recursive: true, force: true })
  })
})
