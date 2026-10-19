export type MediaKind = 'full' | 'beat' | 'lyrics' | 'background'
export type SpeakerRole = 'male' | 'female' | 'duet' | 'unknown'
export type ProviderKind = 'mock' | 'deepgram' | 'custom'
export type ExportFormat = 'srt' | 'ass'

export type TimedWord = {
  id: string
  text: string
  start: number
  end: number
  confidence?: number
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
}

export type MediaAsset = {
  id: string
  kind: MediaKind
  path: string
  displayName: string
  mimeType?: string
  duration?: number
  url?: string
}

export type SpeakerProfile = {
  id: string
  label: string
  role: SpeakerRole
  color: string
}

export type ProviderProfile = {
  kind: ProviderKind
  endpoint: string
  model: string
  language: string
  diarize: boolean
  customSegmentsPath?: string
  customWordsPath?: string
}

export type ExportOptions = {
  includeSpeakerPrefix: boolean
  includeKaraokeTags: boolean
  leadInMs: number
  leadOutMs: number
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
  schemaVersion: 1
  title: string
  createdAt: string
  updatedAt: string
  assets: MediaAsset[]
  segments: LyricSegment[]
  speakers: SpeakerProfile[]
  provider: ProviderProfile
  exportOptions: ExportOptions
  video?: VideoSettings
}

export type ProviderRequest = {
  audioPath: string
  lyricsText?: string
  language: string
  model: string
  diarize: boolean
  endpoint?: string
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
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  width: 1920,
  height: 1080,
  backgroundColor: '#10162a',
  lyricPosition: { x: 0.5, y: 0.78 },
}

export const DEFAULT_PROVIDER: ProviderProfile = {
  kind: 'mock',
  endpoint: 'https://api.deepgram.com/v1/listen',
  model: 'nova-3',
  language: 'vi',
  diarize: true,
  customSegmentsPath: 'results.channels[0].alternatives[0].paragraphs.paragraphs',
  customWordsPath: 'results.channels[0].alternatives[0].words',
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
