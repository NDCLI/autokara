import { DEFAULT_VIDEO_SETTINGS, type KaraProject, type LyricSegment, type MediaAsset, type ProviderProfile, type SpeakerProfile, type VideoSettings } from './contracts'

export const CURRENT_SCHEMA_VERSION = 1

export function assertProject(value: unknown): asserts value is KaraProject {
  if (!value || typeof value !== 'object') throw new Error('Tệp project không phải JSON hợp lệ.')
  const project = value as Partial<KaraProject>
  if (project.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Phiên bản project không được hỗ trợ: ${String(project.schemaVersion ?? 'không có')}.`)
  }
  if (typeof project.title !== 'string' || !Array.isArray(project.assets) || !Array.isArray(project.segments)) {
    throw new Error('Project thiếu thông tin cơ bản (title, assets hoặc segments).')
  }
  if (!Array.isArray(project.speakers) || !project.provider || !project.exportOptions) {
    throw new Error('Project thiếu cấu hình speaker/provider/export.')
  }
  for (const asset of project.assets) validateAsset(asset)
  for (const segment of project.segments) validateSegment(segment)
  for (const speaker of project.speakers) validateSpeaker(speaker)
  validateProvider(project.provider)
  if (project.video !== undefined) validateVideoSettings(project.video)
}

function validateAsset(asset: unknown): asserts asset is MediaAsset {
  if (!asset || typeof asset !== 'object') throw new Error('Asset không hợp lệ.')
  const item = asset as Partial<MediaAsset>
  if (!item.id || !item.path || !item.displayName || !['full', 'beat', 'lyrics', 'background'].includes(item.kind ?? '')) {
    throw new Error('Asset thiếu id, path, displayName hoặc kind hợp lệ.')
  }
}

function validateSegment(segment: unknown): asserts segment is LyricSegment {
  if (!segment || typeof segment !== 'object') throw new Error('Segment không hợp lệ.')
  const item = segment as Partial<LyricSegment>
  if (!item.id || typeof item.text !== 'string' || typeof item.start !== 'number' || typeof item.end !== 'number' || !Array.isArray(item.words)) {
    throw new Error('Segment thiếu id/text/start/end/words.')
  }
  if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end < item.start) {
    throw new Error(`Timing không hợp lệ ở segment ${item.id}.`)
  }
}

function validateSpeaker(speaker: unknown): asserts speaker is SpeakerProfile {
  if (!speaker || typeof speaker !== 'object') throw new Error('Speaker không hợp lệ.')
  const item = speaker as Partial<SpeakerProfile>
  if (!item.id || !item.label || !item.role || !item.color) throw new Error('Speaker thiếu thông tin.')
}

function validateProvider(provider: unknown): asserts provider is ProviderProfile {
  if (!provider || typeof provider !== 'object') throw new Error('Provider không hợp lệ.')
  const item = provider as Partial<ProviderProfile>
  if (!['mock', 'deepgram', 'custom'].includes(item.kind ?? '') || typeof item.endpoint !== 'string') {
    throw new Error('Cấu hình provider không hợp lệ.')
  }
}

function validateVideoSettings(value: unknown): asserts value is VideoSettings {
  if (!value || typeof value !== 'object') throw new Error('Cấu hình video không hợp lệ.')
  const video = value as Partial<VideoSettings>
  if (!Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width! < 16 || video.height! < 16 || video.width! > 3840 || video.height! > 2160 || video.width! % 2 !== 0 || video.height! % 2 !== 0) {
    throw new Error('Kích thước video không hợp lệ.')
  }
  if (typeof video.backgroundColor !== 'string' || !/^#[\da-f]{6}$/i.test(video.backgroundColor)) {
    throw new Error('Màu nền video không hợp lệ.')
  }
  const position = video.lyricPosition
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) {
    throw new Error('Vị trí lời bài hát phải nằm trong khung video (0–100%).')
  }
}

export function normalizeProject(project: KaraProject): KaraProject {
  assertProject(project)
  const video = project.video ?? DEFAULT_VIDEO_SETTINGS
  return { ...project, video: { ...video, lyricPosition: { ...video.lyricPosition } } }
}

export function parseProjectJson(text: string): KaraProject {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Không thể đọc project: JSON bị lỗi.')
  }
  assertProject(value)
  return normalizeProject(value)
}

export function serializeProject(project: KaraProject): string {
  return JSON.stringify(normalizeProject(project), null, 2)
}
