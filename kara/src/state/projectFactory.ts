import type { DEFAULT_EXPORT_OPTIONS, DEFAULT_PROVIDER, KaraProject, LyricSegment, MediaAsset, SpeakerProfile } from '../../shared/contracts'
import { DEFAULT_VIDEO_SETTINGS, SPEAKER_COLORS } from '../../shared/contracts'

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const DEMO_LINES = [
  { text: 'Đêm nay mình hát cho bình minh thức giấc', start: 0.8, end: 4.7 },
  { text: 'Nhịp tim rơi theo từng phím đàn', start: 5.1, end: 8.3 },
  { text: 'Nếu em lên tiếng, anh sẽ hòa cùng', start: 8.8, end: 12.4 },
  { text: 'Một câu ca giữ chúng ta lại', start: 12.8, end: 16.1 },
]

export function createDemoSegments(): LyricSegment[] {
  return DEMO_LINES.map((line, index) => ({
    id: `demo-${index + 1}`,
    text: line.text,
    start: line.start,
    end: line.end,
    speakerRole: index % 2 ? 'female' : 'male',
    providerSpeakerId: index % 2 ? 'speaker_1' : 'speaker_0',
    confidence: 0.92,
    words: line.text.split(/\s+/).map((text, wordIndex, words) => {
      const span = (line.end - line.start) / words.length
      return {
        id: `demo-${index + 1}-word-${wordIndex}`,
        text,
        start: line.start + wordIndex * span,
        end: line.start + (wordIndex + 1) * span,
        confidence: 0.92,
      }
    }),
  }))
}

export function createNewProject(defaults: {
  provider: typeof DEFAULT_PROVIDER
  exportOptions: typeof DEFAULT_EXPORT_OPTIONS
}): KaraProject {
  const now = new Date().toISOString()
  const speakers: SpeakerProfile[] = [
    { id: 'speaker_0', label: 'Nam', role: 'male', color: SPEAKER_COLORS.male },
    { id: 'speaker_1', label: 'Nữ', role: 'female', color: SPEAKER_COLORS.female },
  ]
  return {
    schemaVersion: 3,
    projectId: makeId(),
    revision: 0,
    title: 'Bản nháp mới',
    createdAt: now,
    updatedAt: now,
    assets: [],
    segments: createDemoSegments(),
    speakers,
    provider: { ...defaults.provider },
    exportOptions: { ...defaults.exportOptions },
    trackTimeMapping: { assetMappings: [] },
    video: { ...DEFAULT_VIDEO_SETTINGS, lyricPosition: { ...DEFAULT_VIDEO_SETTINGS.lyricPosition } },
  }
}

export function assetFromFile(kind: MediaAsset['kind'], file: { path: string; displayName: string; mimeType?: string; url?: string }): MediaAsset {
  return { id: makeId(), kind, path: file.path, displayName: file.displayName, mimeType: file.mimeType, url: file.url }
}
