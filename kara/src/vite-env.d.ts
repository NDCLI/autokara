/// <reference types="vite/client" />

import type { ExportFormat, KaraProject, MediaKind, NormalizedTranscript, ProviderProfile, RenderProgress, RenderRequest, RenderResult } from '../shared/contracts'

type PickedFile = { path: string; displayName: string; url?: string; mimeType?: string }
type ProjectOpenResult = { path: string; project: KaraProject } | null

declare global {
  interface Window {
    kara?: {
      isElectron: true
      pickFile(kind: MediaKind): Promise<PickedFile | null>
      getMediaUrl(path: string): Promise<string>
      getWaveform(path: string): Promise<string>
      extractVideoAudio(path: string): Promise<PickedFile>
      prepareVideoPreview(path: string): Promise<string>
      getMediaFingerprint(path: string): Promise<string>
      getMediaSignature(path: string): Promise<{ size: number; modifiedAtMs: number }>
      loadCachedTranscript(key: string): Promise<NormalizedTranscript | null>
      readTextFile(path: string): Promise<string>
      openProject(): Promise<ProjectOpenResult>
      saveProject(project: KaraProject, currentPath?: string): Promise<{ path: string } | null>
      loadRecoveryProject(): Promise<string | null>
      saveRecoveryProject(project: KaraProject): Promise<void>
      clearRecoveryProject(): Promise<void>
      saveExport(format: ExportFormat, content: string, suggestedName: string): Promise<{ path: string } | null>
      loadProviderSettings(): Promise<{ profile: ProviderProfile }>
      saveProviderSettings(profile: ProviderProfile): Promise<void>
      pickRuntimePath(kind: 'python' | 'model'): Promise<string | null>
      checkLocalRuntime(profile: ProviderProfile): Promise<{ pythonExecutable?: string; pythonVersion: string; pythonSupported?: boolean; runtimeReady?: boolean; manifestLoaded?: boolean; manifest?: { manifestVersion: number; runtime?: { python?: { supported?: string[] }; packages?: Record<string, { versionPolicy?: string; testedVersion?: string }> } } | null; fasterWhisper: { available: boolean; version?: string | null }; av?: { available: boolean; version?: string | null }; ctranslate2?: { available: boolean; version?: string | null }; stableWhisper?: { available: boolean; version?: string | null; error?: string | null }; demucs?: { available: boolean; version?: string | null; error?: string | null }; cudaDeviceCount: number }>
      separateVocals(jobId: string, audioPath: string, pythonPath?: string): Promise<{ vocalsPath: string; instrumentalPath: string; vocalsUrl: string; instrumentalUrl: string; cacheHit: boolean }>
      cancelSeparation(jobId: string): Promise<void>
      transcribe(jobId: string, profile: ProviderProfile, audioPath: string, lyricsText?: string): Promise<NormalizedTranscript>
      cancelTranscribe(jobId: string): Promise<void>
      onTranscribeProgress(listener: (progress: { jobId: string; phase?: string; status?: string; percent?: number }) => void): () => void
      startRender(request: RenderRequest): Promise<RenderResult>
      onRenderProgress(listener: (progress: RenderProgress) => void): () => void
      cancelRender(jobId: string): Promise<void>
    }
  }
}

export {}
