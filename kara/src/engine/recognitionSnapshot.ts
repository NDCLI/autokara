import type { KaraProject, ProviderProfile } from '../../shared/contracts'

export type RecognitionSnapshot = {
  projectId: string
  revision: number
  provider: ProviderProfile
  lyrics: string
}

export function captureRecognitionSnapshot(project: KaraProject, provider: ProviderProfile, lyrics: string): RecognitionSnapshot {
  return { projectId: project.projectId, revision: project.revision, provider, lyrics }
}

export function isRecognitionSnapshotCurrent(snapshot: RecognitionSnapshot, project: KaraProject, provider: ProviderProfile, lyrics: string): boolean {
  return snapshot.projectId === project.projectId
    && snapshot.revision === project.revision
    && snapshot.provider === provider
    && snapshot.lyrics === lyrics
}
