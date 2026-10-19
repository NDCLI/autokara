export type MediaKind = 'full' | 'beat' | 'lyrics'
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
