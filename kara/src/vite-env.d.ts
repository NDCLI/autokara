/// <reference types="vite/client" />

import type { ExportFormat, KaraProject, MediaKind, NormalizedTranscript, ProviderProfile } from '../shared/contracts'

type PickedFile = { path: string; displayName: string; url?: string; mimeType?: string }
type ProjectOpenResult = { path: string; project: KaraProject } | null

declare global {
  interface Window {
    kara?: {
      isElectron: true
      pickFile(kind: MediaKind): Promise<PickedFile | null>
      getMediaUrl(path: string): Promise<string>
      readTextFile(path: string): Promise<string>
      openProject(): Promise<ProjectOpenResult>
      saveProject(project: KaraProject, currentPath?: string): Promise<{ path: string } | null>
      saveExport(format: ExportFormat, content: string, suggestedName: string): Promise<{ path: string } | null>
      loadProviderSettings(): Promise<{ profile: ProviderProfile; apiKeyPresent: boolean }>
      saveProviderSettings(profile: ProviderProfile, apiKey: string): Promise<void>
      transcribe(profile: ProviderProfile, audioPath: string, lyricsText?: string): Promise<NormalizedTranscript>
    }
  }
}

export {}
