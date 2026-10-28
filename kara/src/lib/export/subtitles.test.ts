import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_VIDEO_SETTINGS, type LyricSegment } from '../../../shared/contracts'
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
    expect(result).toContain('{\\an5\\pos(960,842)}NỮ: {\\kf40}Xin {\\kf60}chào {\\kf60}em')
    expect(result).toContain('{\\kf40}Xin {\\kf60}chào {\\kf60}em')
  })

  it('uses the configured normalized position and keeps edge positions within the frame', () => {
    const custom = buildAss(sample, { ...DEFAULT_EXPORT_OPTIONS, includeSpeakerPrefix: false }, { ...DEFAULT_VIDEO_SETTINGS, lyricPosition: { x: 0.25, y: 0.6 } })
    expect(custom).toContain('{\\an5\\pos(480,648)}')
    const edge = buildAss(sample, DEFAULT_EXPORT_OPTIONS, { ...DEFAULT_VIDEO_SETTINGS, lyricPosition: { x: 0, y: 1 } })
    expect(edge).toContain('{\\an5\\pos(0,1080)}')
  })

  it('preserves leading and inter-word gaps in ASS karaoke timing', () => {
    const spaced = [{ ...sample[0], start: 1, end: 4, words: [
      { id: 'w1', text: 'Xin', start: 1.5, end: 1.9 },
      { id: 'w2', text: 'chào', start: 2.6, end: 3.2 },
    ] }]
    const result = buildAss(spaced, { ...DEFAULT_EXPORT_OPTIONS, includeSpeakerPrefix: false })
    expect(result).toContain('{\\k50} {\\kf40}Xin{\\k70} {\\kf60}chào')
  })

  it('sorts word timings and prevents overlap from advancing karaoke early', () => {
    const unordered = [{ ...sample[0], words: [
      { id: 'w2', text: 'chào', start: 1.3, end: 2 },
      { id: 'w1', text: 'Xin', start: 1, end: 1.5 },
    ] }]
    const result = buildAss(unordered, { ...DEFAULT_EXPORT_OPTIONS, includeSpeakerPrefix: false })
    expect(result).toContain('{\\kf50}Xin {\\kf50}chào')
    expect(result.indexOf('Xin')).toBeLessThan(result.indexOf('chào'))
  })

  it('escapes ASS control braces and line breaks', () => {
    const value = [{ ...sample[0], text: '{\u001bhello}\nworld', words: [] }]
    expect(buildAss(value, { ...DEFAULT_EXPORT_OPTIONS, includeSpeakerPrefix: false, includeKaraokeTags: false })).toContain('helloworld')
  })

  it('adds a secondary upcoming lyric and a three-step countdown in long music gaps', () => {
    const cues: LyricSegment[] = [
      { id: 'a', text: 'Câu đầu', start: 1, end: 2, speakerRole: 'female', words: [] },
      { id: 'b', text: 'Câu tiếp', start: 6, end: 7, speakerRole: 'male', words: [] },
    ]
    const result = buildAss(cues, { ...DEFAULT_EXPORT_OPTIONS, leadOutMs: 0 })
    expect(result).toContain('Dialogue: 1,0:00:01.00,0:00:02.00,Male')
    expect(result).toContain('\\alpha&H50&}NAM: Câu tiếp')
    expect(result).toContain('Dialogue: 2,0:00:03.00,0:00:04.00,Male')
    expect(result).toContain('Dialogue: 2,0:00:04.00,0:00:05.00,Male')
    expect(result).toContain('Dialogue: 2,0:00:05.00,0:00:06.00,Male')
  })

  it('renders current lyrics, upcoming lyrics, and countdown through the bundled libass', () => {
    if (!ffmpegPath) throw new Error('Bundled FFmpeg executable is unavailable.')
    const outputDir = process.env.KARA_VISUAL_QA_DIR || mkdtempSync(path.join(tmpdir(), 'kara-visual-qa-'))
    mkdirSync(outputDir, { recursive: true })
    const assPath = path.join(outputDir, 'karaoke-visual-qa.ass')
    const cues: LyricSegment[] = [
      { id: 'a', text: 'Câu đầu', start: 1, end: 2, speakerRole: 'female', words: [] },
      { id: 'b', text: 'Câu tiếp', start: 6, end: 7, speakerRole: 'male', words: [] },
    ]
    writeFileSync(assPath, buildAss(cues, { ...DEFAULT_EXPORT_OPTIONS, leadInMs: 0, leadOutMs: 0 }), 'utf8')
    for (const [name, seek] of [['current-and-teaser', '1.50'], ['countdown', '3.50']] as const) {
      const framePath = path.join(outputDir, `${name}.png`)
      execFileSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=0x10162a:s=640x360:r=25:d=7',
        '-vf', `subtitles=${path.basename(assPath)}`,
        '-ss', seek, '-frames:v', '1', framePath,
      ], { cwd: outputDir, stdio: 'pipe' })
      expect(statSync(framePath).size).toBeGreaterThan(1000)
    }
    console.info(`libass visual QA frames: ${outputDir}`)
  })
})
