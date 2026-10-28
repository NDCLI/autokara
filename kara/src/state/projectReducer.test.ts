import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_SETTINGS } from '../../shared/contracts'
import { createHistory, projectReducer } from './projectReducer'
import { createNewProject } from './projectFactory'
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_PROVIDER } from '../../shared/contracts'

describe('video position project history', () => {
  it('records lyric position changes for undo and redo', () => {
    const initial = createHistory(createNewProject({ provider: DEFAULT_PROVIDER, exportOptions: DEFAULT_EXPORT_OPTIONS }))
    const moved = projectReducer(initial, { type: 'set-video-settings', settings: { lyricPosition: { x: 0.3, y: 0.6 } } })
    expect(moved.present.video?.lyricPosition).toEqual({ x: 0.3, y: 0.6 })
    const undone = projectReducer(moved, { type: 'undo' })
    expect(undone.present.video?.lyricPosition).toEqual(DEFAULT_VIDEO_SETTINGS.lyricPosition)
    const redone = projectReducer(undone, { type: 'redo' })
    expect(redone.present.video?.lyricPosition).toEqual({ x: 0.3, y: 0.6 })
  })

  it('records output dimensions and background color for undo and redo', () => {
    const initial = createHistory(createNewProject({ provider: DEFAULT_PROVIDER, exportOptions: DEFAULT_EXPORT_OPTIONS }))
    const changed = projectReducer(initial, { type: 'set-video-settings', settings: { width: 1280, height: 720, backgroundColor: '#224466' } })
    expect(changed.present.video).toMatchObject({ width: 1280, height: 720, backgroundColor: '#224466' })
    const undone = projectReducer(changed, { type: 'undo' })
    expect(undone.present.video).toMatchObject(DEFAULT_VIDEO_SETTINGS)
    const redone = projectReducer(undone, { type: 'redo' })
    expect(redone.present.video).toMatchObject({ width: 1280, height: 720, backgroundColor: '#224466' })
  })

})

describe('project edit transactions', () => {
  it('commits recognized segments and their source transcript as one undo step', () => {
    const initial = createHistory(createNewProject({ provider: DEFAULT_PROVIDER, exportOptions: DEFAULT_EXPORT_OPTIONS }))
    const snapshot = { providerKind: 'mock' as const, capturedAt: new Date(0).toISOString(), mappingKey: JSON.stringify(initial.present.trackTimeMapping), transcript: { segments: [] } }
    const recognized = projectReducer(initial, { type: 'set-analysis-result', segments: [], snapshot })
    expect(recognized.present.analysisSnapshot).toEqual(snapshot)
    expect(recognized.past).toHaveLength(1)
    const undone = projectReducer(recognized, { type: 'undo' })
    expect(undone.present.analysisSnapshot).toBeUndefined()
    expect(undone.present.segments).toEqual(initial.present.segments)
  })

  it('keeps a saved transcript pointer when its source media is relinked with the same asset ID', () => {
    const project = createNewProject({ provider: DEFAULT_PROVIDER, exportOptions: DEFAULT_EXPORT_OPTIONS })
    const asset = { id: 'audio', kind: 'full' as const, path: 'old.wav', displayName: 'song.wav' }
    const initial = createHistory({ ...project, assets: [asset] })
    const snapshot = { providerKind: 'local' as const, sourceAssetId: asset.id, sourcePath: asset.path, sourceFingerprint: 'a'.repeat(64), capturedAt: new Date(0).toISOString(), mappingKey: JSON.stringify(initial.present.trackTimeMapping), transcript: { segments: [] } }
    const saved = projectReducer(initial, { type: 'set-analysis-result', segments: [], snapshot })
    const relinked = projectReducer(saved, { type: 'set-assets', assets: [{ ...asset, path: 'new.wav' }] })
    expect(relinked.present.analysisSnapshot).toEqual({ ...snapshot, sourcePath: 'new.wav' })
  })

  it('groups word recording updates into one undo and redo step', () => {
    const initial = createHistory(createNewProject({ provider: DEFAULT_PROVIDER, exportOptions: DEFAULT_EXPORT_OPTIONS }))
    const segment = initial.present.segments[0]
    let state = projectReducer(initial, { type: 'begin-transaction' })
    state = projectReducer(state, { type: 'update-segment', id: segment.id, patch: { words: [{ ...segment.words[0], start: 0.2, end: 0.6 }] } })
    state = projectReducer(state, { type: 'update-segment', id: segment.id, patch: { words: [{ ...segment.words[0], start: 0.3, end: 0.7 }] } })
    const revisionDuringTransaction = state.present.revision
    state = projectReducer(state, { type: 'end-transaction' })

    expect(state.past).toHaveLength(1)
    expect(state.present.revision).toBe(revisionDuringTransaction)
    expect(state.present.segments[0].words[0].start).toBe(0.3)
    const undone = projectReducer(state, { type: 'undo' })
    expect(undone.present.segments[0].words).toEqual(segment.words)
    const redone = projectReducer(undone, { type: 'redo' })
    expect(redone.present.segments[0].words[0].start).toBe(0.3)
  })

  it('cancels a transaction without leaving partial edits in history', () => {
    const initial = createHistory(createNewProject({ provider: DEFAULT_PROVIDER, exportOptions: DEFAULT_EXPORT_OPTIONS }))
    const segment = initial.present.segments[0]
    let state = projectReducer(initial, { type: 'begin-transaction' })
    state = projectReducer(state, { type: 'update-segment', id: segment.id, patch: { text: 'partial edit' } })
    state = projectReducer(state, { type: 'cancel-transaction' })
    expect(state.present.segments[0]).toEqual(segment)
    expect(state.past).toHaveLength(0)
    expect(state.transactionBase).toBeUndefined()
  })
})
