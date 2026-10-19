import { describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDER, DEFAULT_VIDEO_SETTINGS, type KaraProject } from './contracts'
import { parseProjectJson, serializeProject } from './validation'

const project: KaraProject = {
  schemaVersion: 1,
  title: 'Test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  assets: [],
  segments: [],
  speakers: [],
  provider: DEFAULT_PROVIDER,
  exportOptions: { includeSpeakerPrefix: true, includeKaraokeTags: true, leadInMs: 0, leadOutMs: 120 },
}

describe('project JSON validation', () => {
  it('round-trips a valid project and adds the default video layout', () => {
    expect(parseProjectJson(serializeProject(project))).toEqual({ ...project, video: DEFAULT_VIDEO_SETTINGS })
  })

  it('normalizes legacy projects without video settings', () => {
    expect(parseProjectJson(JSON.stringify(project)).video).toEqual(DEFAULT_VIDEO_SETTINGS)
  })

  it('preserves a valid custom lyric position', () => {
    const custom = { ...project, video: { ...DEFAULT_VIDEO_SETTINGS, lyricPosition: { x: 0.34, y: 0.67 } } }
    expect(parseProjectJson(JSON.stringify(custom)).video?.lyricPosition).toEqual({ x: 0.34, y: 0.67 })
  })

  it('rejects positions outside the video frame', () => {
    const custom = { ...project, video: { ...DEFAULT_VIDEO_SETTINGS, lyricPosition: { x: 1.1, y: 0.5 } } }
    expect(() => parseProjectJson(JSON.stringify(custom))).toThrow('Vị trí lời bài hát')
  })

  it('rejects non-finite coordinates and invalid backgrounds', () => {
    const nonFinite = { ...project, video: { ...DEFAULT_VIDEO_SETTINGS, lyricPosition: { x: Number.NaN, y: 0.5 } } }
    expect(() => parseProjectJson(JSON.stringify(nonFinite))).toThrow('Vị trí lời bài hát')
    const invalidColor = { ...project, video: { ...DEFAULT_VIDEO_SETTINGS, backgroundColor: 'url(unsafe)' } }
    expect(() => parseProjectJson(JSON.stringify(invalidColor))).toThrow('Màu nền video')
  })

  it('rejects unsupported schema versions', () => {
    expect(() => parseProjectJson(JSON.stringify({ ...project, schemaVersion: 4 }))).toThrow('không được hỗ trợ')
  })

  it('rejects invalid segment timing', () => {
    expect(() => parseProjectJson(JSON.stringify({ ...project, segments: [{ id: 'x', text: 'Hi', start: 2, end: 1, words: [] }] }))).toThrow('Timing không hợp lệ')
  })
})
