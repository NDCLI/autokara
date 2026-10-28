const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { assertOutputDoesNotMatchInputs, buildFfmpegArgs, buildVideoPreviewArgs, escapeFilterPath, parseProgressLine, publishRenderOutput, supportsBrowserPreviewEncoders, supportsRequiredEncoders } = require('./render-utils.cjs')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

describe('FFmpeg render utilities', () => {
  it('accepts FFmpeg audio encoder flags with direct-rendering support', () => {
    assert.equal(supportsRequiredEncoders(' V....D libx264 H.264\n A....D aac AAC'), true)
    assert.equal(supportsRequiredEncoders(' V....D libx264 H.264\n A..... aac AAC'), true)
    assert.equal(supportsRequiredEncoders(' V....D libx264 H.264\n V....D aac AAC'), false)
    assert.equal(supportsRequiredEncoders(' A....D aac AAC'), false)
  })

  it('builds a broadly supported H.264/AAC MP4 proxy command for failed browser video decoding', () => {
    const args = buildVideoPreviewArgs({ sourcePath: 'D:\\Videos\\source.mp4', outputPath: 'D:\\Cache\\preview.mp4' })
    assert.ok(args.includes('libx264'))
    assert.ok(args.includes('aac'))
    assert.ok(args.includes('ultrafast'))
    assert.ok(args.includes('scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=20'))
    assert.ok(args.includes('+faststart'))
    assert.equal(supportsBrowserPreviewEncoders(' V....D libx264 H.264\n A....D aac AAC'), true)
    assert.equal(supportsBrowserPreviewEncoders(' V....D libx264 H.264'), false)
  })

  it('builds an argument array for a generated background and MP4', () => {
    const args = buildFfmpegArgs({
      audioPath: 'D:\\Songs\\track.wav',
      subtitlePath: 'D:\\Temp\\kara.ass',
      outputPath: 'D:\\Videos\\result.mp4',
      video: { width: 1920, height: 1080, backgroundColor: '#10162a' },
    })
    assert.ok(args.includes('color=c=0x10162a:s=1920x1080:r=30'))
    assert.ok(args.includes('libx264'))
    assert.ok(args.includes('aac'))
    assert.ok(args.includes('-shortest'))
    assert.ok(args.includes('D:\\Songs\\track.wav'))
    assert.ok(args.find((arg) => arg.startsWith('subtitles=')).includes('D\\:/Temp/kara.ass'))
  })

  it('escapes filter delimiters in Windows paths', () => {
    assert.equal(escapeFilterPath("C:\\My, Videos\\a'b.ass"), "C\\:/My\\, Videos/a\\'b.ass")
  })

  it('parses FFmpeg progress and caps active jobs below completion', () => {
    assert.deepEqual(parseProgressLine('out_time=00:00:05.000', 10), { percent: 50, status: 'Đang mã hóa · 50%' })
    assert.deepEqual(parseProgressLine('progress=end', 10), { percent: 100, status: 'Hoàn tất mã hóa…' })
    assert.equal(parseProgressLine('out_time=N/A', 10), null)
  })

  it('builds arguments for a looping video background with audio mapping and subtitles', () => {
    const args = buildFfmpegArgs({
      audioPath: 'D:\\Songs\\track.wav',
      backgroundPath: 'D:\\Videos\\background.mp4',
      subtitlePath: 'D:\\Temp\\kara.ass',
      outputPath: 'D:\\Videos\\result.mp4',
      video: { width: 1280, height: 720, backgroundColor: '#223344' },
    })
    assert.ok(args.includes('-stream_loop'))
    assert.ok(args.includes('-1'))
    assert.ok(args.includes('D:\\Videos\\background.mp4'))
    assert.ok(args.includes('-map'))
    assert.ok(args.includes('0:v:0'))
    assert.ok(args.includes('1:a:0'))
    assert.ok(args.find((arg) => arg.includes('scale=1280:720')).includes('color=0x223344'))
  })

  it('rejects output paths that collide with source media', () => {
    assert.throws(() => assertOutputDoesNotMatchInputs('C:\\Music\\song.mp4', 'C:\\Music\\song.mp4'), /không được trùng/)
    assert.throws(() => assertOutputDoesNotMatchInputs('C:\\Video\\OUT.mp4', 'c:\\video\\out.mp4'), /không được trùng/)
    assert.doesNotThrow(() => assertOutputDoesNotMatchInputs('C:\\Video\\out.mp4', 'C:\\Music\\song.mp4', 'C:\\Video\\bg.mp4'))
  })

  it('rejects odd and oversized dimensions before constructing FFmpeg arguments', () => {
    assert.throws(() => buildFfmpegArgs({ audioPath: 'a.wav', subtitlePath: 'a.ass', outputPath: 'a.mp4', video: { width: 1279, height: 720, backgroundColor: '#10162a' } }), /Kích thước/)
    assert.throws(() => buildFfmpegArgs({ audioPath: 'a.wav', subtitlePath: 'a.ass', outputPath: 'a.mp4', video: { width: 4000, height: 2160, backgroundColor: '#10162a' } }), /Kích thước/)
  })

  it('rejects an invalid background color before constructing FFmpeg arguments', () => {
    assert.throws(() => buildFfmpegArgs({ audioPath: 'a.wav', subtitlePath: 'a.ass', outputPath: 'a.mp4', video: { width: 1920, height: 1080, backgroundColor: 'red' } }), /Màu nền/)
  })

  it('preserves an existing output when the completed temporary file is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-render-'))
    const output = path.join(root, 'output.mp4')
    await fs.writeFile(output, 'original')
    await assert.rejects(publishRenderOutput(path.join(root, 'missing-temp.mp4'), output))
    assert.equal(await fs.readFile(output, 'utf8'), 'original')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('restores an existing output when cancellation arrives after the backup step', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-render-'))
    const output = path.join(root, 'output.mp4')
    const temp = path.join(root, 'temp.mp4')
    await fs.writeFile(output, 'original')
    await fs.writeFile(temp, 'new')
    let checks = 0
    assert.deepEqual(await publishRenderOutput(temp, output, { isCanceled: () => ++checks > 1 }), { status: 'canceled' })
    assert.equal(await fs.readFile(output, 'utf8'), 'original')
    assert.deepEqual(await fs.readdir(root), ['output.mp4', 'temp.mp4'])
    await fs.rm(root, { recursive: true, force: true })
  })
})
