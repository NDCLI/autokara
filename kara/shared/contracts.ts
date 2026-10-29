export type MediaKind = 'full' | 'beat' | 'vocal' | 'lyrics' | 'background'
export type SpeakerRole = 'male' | 'female' | 'duet' | 'unknown'
export type ProviderKind = 'mock' | 'local'
export type AnalysisProviderKind = ProviderKind | 'legacy'
export type LocalSource = 'original' | 'vocal' | 'auto'
export type ExportFormat = 'srt' | 'ass'
export type TimingOrigin = 'manual' | 'asr' | 'aligned' | 'estimated'
export type ReviewReason = 'estimated-timing' | 'recognition-timing' | 'low-text-match' | 'empty-timing' | 'manual-edit' | 'explicit' | 'reviewed'

export type TimedWord = {
  id: string
  text: string
  start: number
  end: number
  confidence?: number
  origin?: TimingOrigin
  timingLocked?: boolean
}

export type LyricSegment = {
  id: string
  text: string
  start: number
  end: number
  speakerRole: SpeakerRole
  providerSpeakerId?: string
  words: TimedWord[]
  confidence?: number
  needsReview?: boolean
  reviewReason?: ReviewReason
  reviewStatus?: 'pending' | 'listened' | 'edited' | 'explicitly-accepted'
  origin?: TimingOrigin
  timingLocked?: boolean
}

export type MediaAsset = {
  id: string
  kind: MediaKind
  path: string
  displayName: string
  mimeType?: string
  duration?: number
  url?: string
  derivedFrom?: string
  derivedKind?: 'video-audio' | 'separation-vocal' | 'separation-instrumental'
  processing?: 'separating' | 'ready' | 'error'
}

export type SpeakerProfile = {
  id: string
  label: string
  role: SpeakerRole
  color: string
}

export type ProviderProfile = {
  kind: ProviderKind
  model: string
  language: string
  localModelPath?: string
  localPythonPath?: string
  localDevice?: 'auto' | 'cpu' | 'cuda'
  localSource?: LocalSource
  useVocalSeparation?: boolean
}

export type ExportOptions = {
  includeSpeakerPrefix: boolean
  includeKaraokeTags: boolean
  leadInMs: number
  leadOutMs: number
}

export type TimeAnchor = { sourceTime: number; timelineTime: number }

export type AssetTimeMapping = {
  assetId: string
  anchors: TimeAnchor[]
}

export type TrackTimeMapping = {
  analysisAssetId?: string
  playbackAssetId?: string
  renderAssetId?: string
  assetMappings: AssetTimeMapping[]
}

export type NormalizedPosition = { x: number; y: number }

export type VideoSettings = {
  width: number
  height: number
  backgroundColor: string
  lyricPosition: NormalizedPosition
}

export type RenderRequest = {
  jobId: string
  audioPath: string
  backgroundPath?: string
  assContent: string
  duration: number
  video: VideoSettings
}

export type RenderProgress = {
  jobId: string
  percent: number
  status: string
}

export type RenderResult = { path: string } | null

export type KaraProject = {
  lyricsDraft?: string
  schemaVersion: 3
  projectId: string
  revision: number
  title: string
  createdAt: string
  updatedAt: string
  assets: MediaAsset[]
  segments: LyricSegment[]
  speakers: SpeakerProfile[]
  provider: ProviderProfile
  exportOptions: ExportOptions
  trackTimeMapping: TrackTimeMapping
  analysisSnapshot?: AnalysisSnapshot
  video?: VideoSettings
}

export type AnalysisSnapshot = {
  transcript?: NormalizedTranscript
  transcriptCacheKey?: string
  sourceAssetId?: string
  sourcePath?: string
  sourceFingerprint?: string
  sourceSignature?: { size: number; modifiedAtMs: number }
  sourceTimeAnchors?: TimeAnchor[]
  mappingKey: string
  providerKind: AnalysisProviderKind
  capturedAt: string
}

export type NormalizedTranscript = {
  segments: Array<{
    id: string
    text: string
    start: number
    end: number
    speakerId?: string
    confidence?: number
    words: TimedWord[]
  }>
  duration?: number
  timingMethod?: 'asr' | 'direct-lyrics-alignment'
  device?: 'cpu' | 'cuda'
  deviceFallbackReason?: string
  cacheHit?: boolean
  audioFingerprint?: string
  audioSignature?: { size: number; modifiedAtMs: number }
  transcriptCacheKey?: string
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  width: 1920,
  height: 1080,
  backgroundColor: '#10162a',
  lyricPosition: { x: 0.5, y: 0.78 },
}

export const DEFAULT_PROVIDER: ProviderProfile = {
  kind: 'local',
  model: 'small',
  language: 'vi',
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeSpeakerPrefix: true,
  includeKaraokeTags: true,
  leadInMs: 0,
  leadOutMs: 120,
}

export const SPEAKER_COLORS: Record<SpeakerRole, string> = {
  male: '#6d8cff',
  female: '#f18bcb',
  duet: '#f5c76b',
  unknown: '#8f9bb8',
}
