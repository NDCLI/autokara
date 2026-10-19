import { describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDER, type KaraProject } from './contracts'
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
  it('round-trips a valid project', () => {
    expect(parseProjectJson(serializeProject(project))).toEqual(project)
  })

  it('rejects unsupported schema versions', () => {
    expect(() => parseProjectJson(JSON.stringify({ ...project, schemaVersion: 4 }))).toThrow('không được hỗ trợ')
  })

  it('rejects invalid segment timing', () => {
    expect(() => parseProjectJson(JSON.stringify({ ...project, segments: [{ id: 'x', text: 'Hi', start: 2, end: 1, words: [] }] }))).toThrow('Timing không hợp lệ')
  })
})
