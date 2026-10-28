import { describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDER, DEFAULT_VIDEO_SETTINGS, type KaraProject } from './contracts'
import { parseProjectJson, serializeProject } from './validation'

const project: KaraProject = {
  schemaVersion: 3,
  projectId: 'project-test',
  revision: 0,
  title: 'Test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  assets: [],
  segments: [],
  speakers: [],
  provider: DEFAULT_PROVIDER,
  exportOptions: { includeSpeakerPrefix: true, includeKaraokeTags: true, leadInMs: 0, leadOutMs: 120 },
  trackTimeMapping: { assetMappings: [] },
}

describe('project JSON validation', () => {
  it('round-trips a valid project and adds the default video layout', () => {
    expect(parseProjectJson(serializeProject(project))).toEqual({ ...project, video: DEFAULT_VIDEO_SETTINGS })
  })

  it('normalizes legacy projects without video settings', () => {
    expect(parseProjectJson(JSON.stringify(project)).video).toEqual(DEFAULT_VIDEO_SETTINGS)
  })

  it('migrates schema v1 and v2 while leaving old transcript state empty', () => {
    const v2 = parseProjectJson(JSON.stringify({ ...project, schemaVersion: 2 }))
    expect(v2.schemaVersion).toBe(3)
    expect(v2.analysisSnapshot).toBeUndefined()
    const v1 = parseProjectJson(JSON.stringify({ ...project, schemaVersion: 1, trackTimeMapping: undefined }))
    expect(v1.schemaVersion).toBe(3)
    expect(v1.trackTimeMapping).toEqual({ assetMappings: [] })
  })

  it('round-trips a validated analysis transcript snapshot', () => {
    const snapshot = {
      providerKind: 'mock' as const,
      capturedAt: '2026-10-28T00:00:00.000Z',
      mappingKey: JSON.stringify(project.trackTimeMapping),
      transcript: { segments: [{ id: 'asr-1', text: 'Xin chào', start: 1, end: 2, words: [
        { id: 'asr-w1', text: 'Xin', start: 1, end: 1.4 }, { id: 'asr-w2', text: 'chào', start: 1.5, end: 2 },
      ] }] },
    }
    expect(parseProjectJson(serializeProject({ ...project, analysisSnapshot: snapshot })).analysisSnapshot).toEqual(snapshot)
    const invalid = { ...project, analysisSnapshot: { ...snapshot, transcript: { segments: [{ id: 'x', text: 'x', start: 2, end: 1, words: [] }] } } }
    expect(() => parseProjectJson(JSON.stringify(invalid))).toThrow('Timing word/segment')
  })

  it('accepts a compact disk-cache pointer for recognized audio', () => {
    const asset = { id: 'full-1', kind: 'full' as const, path: 'C:/audio/song.wav', displayName: 'song.wav' }
    const snapshot = {
      providerKind: 'local' as const,
      sourceAssetId: asset.id,
      sourcePath: asset.path,
      sourceFingerprint: 'a'.repeat(64),
      sourceSignature: { size: 1024, modifiedAtMs: 1_700_000_000_000 },
      sourceTimeAnchors: [],
      transcriptCacheKey: 'b'.repeat(64),
      mappingKey: JSON.stringify(project.trackTimeMapping),
      capturedAt: '2026-10-28T00:00:00.000Z',
    }
    const parsed = parseProjectJson(serializeProject({ ...project, assets: [asset], analysisSnapshot: snapshot }))
    expect(parsed.analysisSnapshot).toEqual(snapshot)
    const invalid = { ...project, assets: [asset], analysisSnapshot: { ...snapshot, sourceFingerprint: undefined } }
    expect(() => parseProjectJson(JSON.stringify(invalid))).toThrow('cần có audio nguồn và fingerprint')
  })

  it('preserves a valid custom lyric position', () => {
    const custom = { ...project, video: { ...DEFAULT_VIDEO_SETTINGS, lyricPosition: { x: 0.34, y: 0.67 } } }
    expect(parseProjectJson(JSON.stringify(custom)).video?.lyricPosition).toEqual({ x: 0.34, y: 0.67 })
  })

  it('preserves valid custom video output settings and rejects invalid dimensions', () => {
    const custom = { ...project, video: { ...DEFAULT_VIDEO_SETTINGS, width: 1280, height: 720, backgroundColor: '#224466' } }
    expect(parseProjectJson(JSON.stringify(custom)).video).toMatchObject(custom.video)
    for (const [width, height] of [[15, 1080], [4000, 1080], [1920, 1081], [1920, 2200]]) {
      const invalid = { ...project, video: { ...DEFAULT_VIDEO_SETTINGS, width, height } }
      expect(() => parseProjectJson(JSON.stringify(invalid))).toThrow('Kích thước video')
    }
  })

  it('validates separated stem metadata while accepting legacy derived audio', () => {
    const source = { id: 'full', kind: 'full' as const, path: 'song.wav', displayName: 'song.wav' }
    const vocal = { id: 'vocal', kind: 'vocal' as const, path: 'vocal.wav', displayName: 'Vocal', derivedFrom: 'full', derivedKind: 'separation-vocal' as const }
    expect(parseProjectJson(JSON.stringify({ ...project, assets: [source, vocal] })).assets[1]).toMatchObject(vocal)
    const invalid = { ...project, assets: [source, { ...vocal, kind: 'beat' }] }
    expect(() => parseProjectJson(JSON.stringify(invalid))).toThrow('Quan hệ media dẫn xuất')
  })

  it('migrates retired endpoint providers to offline demo and removes endpoint fields', () => {
    const legacy = { ...project, provider: { kind: 'custom', endpoint: 'https://example.invalid/transcribe', model: 'x', language: 'vi', customSegmentsPath: 'data.segments' } }
    const migrated = parseProjectJson(JSON.stringify(legacy))
    expect(migrated.provider).toMatchObject({ kind: 'mock', model: 'small', language: 'vi' })
    expect(migrated.provider).not.toHaveProperty('endpoint')
    expect(migrated.provider).not.toHaveProperty('customSegmentsPath')
  })

  it('keeps old recognition snapshots readable without retaining retired provider names', () => {
    const legacy = { ...project, assets: [{ id: 'full', kind: 'full', path: 'song.wav', displayName: 'song.wav' }], analysisSnapshot: { providerKind: 'deepgram', mappingKey: '{}', capturedAt: new Date(0).toISOString(), transcript: { segments: [] }, sourceAssetId: 'full', sourcePath: 'song.wav', sourceFingerprint: 'a'.repeat(64), sourceSignature: { size: 100, modifiedAtMs: 1 } } }
    expect(parseProjectJson(JSON.stringify(legacy)).analysisSnapshot?.providerKind).toBe('legacy')
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

  it('persists supported review reasons and rejects unknown values', () => {
    const segment = { id: 'x', text: 'Xin', start: 0, end: 1, speakerRole: 'unknown', words: [], needsReview: true, reviewReason: 'empty-timing' }
    expect(parseProjectJson(JSON.stringify({ ...project, segments: [segment] })).segments[0].reviewReason).toBe('empty-timing')
    expect(() => parseProjectJson(JSON.stringify({ ...project, segments: [{ ...segment, reviewReason: 'made-up' }] }))).toThrow('Lý do cần rà soát')
  })

  it('round-trips an explicit local Python executable and rejects a non-string path', () => {
    const local = { ...project, provider: { ...DEFAULT_PROVIDER, kind: 'local' as const, localPythonPath: 'C:/venv/Scripts/python.exe' } }
    expect(parseProjectJson(JSON.stringify(local)).provider.localPythonPath).toBe('C:/venv/Scripts/python.exe')
    const invalid = { ...local, provider: { ...local.provider, localPythonPath: 12 } }
    expect(() => parseProjectJson(JSON.stringify(invalid))).toThrow('Đường dẫn Python runtime')
  })
})
