import { describe, expect, it } from 'vitest'
import type { KaraProject, ProviderProfile } from '../../shared/contracts'
import { captureRecognitionSnapshot, isRecognitionSnapshotCurrent } from './recognitionSnapshot'

const project = { projectId: 'project-a', revision: 3 } as KaraProject
const provider = { kind: 'mock' } as ProviderProfile

describe('recognition job snapshot', () => {
  it('accepts results only for the same project revision, provider, and lyrics', () => {
    const snapshot = captureRecognitionSnapshot(project, provider, 'lời gốc')
    expect(isRecognitionSnapshotCurrent(snapshot, project, provider, 'lời gốc')).toBe(true)
    expect(isRecognitionSnapshotCurrent(snapshot, { ...project, revision: 4 }, provider, 'lời gốc')).toBe(false)
    expect(isRecognitionSnapshotCurrent(snapshot, { ...project, projectId: 'project-b' }, provider, 'lời gốc')).toBe(false)
    expect(isRecognitionSnapshotCurrent(snapshot, project, { ...provider }, 'lời gốc')).toBe(false)
    expect(isRecognitionSnapshotCurrent(snapshot, project, provider, 'lời đã sửa')).toBe(false)
  })
})
