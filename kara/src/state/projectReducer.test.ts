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
