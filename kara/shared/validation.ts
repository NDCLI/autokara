import { DEFAULT_PROVIDER, DEFAULT_VIDEO_SETTINGS, type AnalysisSnapshot, type KaraProject, type LyricSegment, type MediaAsset, type NormalizedTranscript, type ProviderProfile, type SpeakerProfile, type TrackTimeMapping, type VideoSettings } from './contracts'

export const CURRENT_SCHEMA_VERSION = 3
export const LEGACY_SCHEMA_VERSION = 1

function makeProjectId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function migrateProject(value: unknown): unknown {
  if (!value || typeof value !== 'object') throw new Error('Tệp project không phải JSON hợp lệ.')
  const project = value as Record<string, unknown>
  let migrated: Record<string, unknown>
  if (project.schemaVersion === LEGACY_SCHEMA_VERSION) {
    migrated = {
      ...project,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectId: makeProjectId(),
      revision: 0,
      trackTimeMapping: { assetMappings: [] },
      analysisSnapshot: undefined,
    }
  } else if (project.schemaVersion === 2) {
    migrated = { ...project, schemaVersion: CURRENT_SCHEMA_VERSION, analysisSnapshot: undefined }
  } else if (project.schemaVersion === CURRENT_SCHEMA_VERSION) {
    migrated = { ...project }
  } else {
    throw new Error(`Phiên bản project không được hỗ trợ: ${String(project.schemaVersion ?? 'không có')}.`)
  }
  const storedProvider = migrated.provider
  if (storedProvider && typeof storedProvider === 'object') {
    const provider = storedProvider as Record<string, unknown>
    const { endpoint: _endpoint, customSegmentsPath: _customSegmentsPath, customWordsPath: _customWordsPath, ...profile } = provider
    migrated.provider = profile.kind === 'local'
      ? { ...DEFAULT_PROVIDER, ...profile, kind: 'local' }
      : profile.kind === 'mock'
        ? { ...DEFAULT_PROVIDER, ...profile, kind: 'mock' }
        : { ...DEFAULT_PROVIDER, kind: 'mock' }
  }
  if (Array.isArray(migrated.assets)) {
    migrated.assets = migrated.assets.map((asset) => {
      if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return asset
      const { duration, ...rest } = asset as Record<string, unknown>
      return duration === undefined || (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0)
        ? asset
        : rest
    })
  }
  return migrated
}

export function assertProject(value: unknown): asserts value is KaraProject {
  if (!value || typeof value !== 'object') throw new Error('Tệp project không phải JSON hợp lệ.')
  const project = value as Partial<KaraProject>
  if (project.schemaVersion !== CURRENT_SCHEMA_VERSION || typeof project.projectId !== 'string' || !project.projectId || !Number.isInteger(project.revision) || project.revision! < 0) {
    throw new Error('Project thiếu phiên bản, ID hoặc revision hợp lệ.')
  }
  if (typeof project.title !== 'string' || !Array.isArray(project.assets) || !Array.isArray(project.segments)) {
    throw new Error('Project thiếu thông tin cơ bản (title, assets hoặc segments).')
  }
  if (!Array.isArray(project.speakers) || !project.provider || !project.exportOptions) {
    throw new Error('Project thiếu cấu hình speaker/provider/export.')
  }
  if (project.lyricsDraft !== undefined && typeof project.lyricsDraft !== 'string') throw new Error('Lời nháp không hợp lệ.')
  for (const asset of project.assets) validateAsset(asset)
  for (const segment of project.segments) validateSegment(segment)
  for (const speaker of project.speakers) validateSpeaker(speaker)
  validateProvider(project.provider)
  validateTrackTimeMapping(project.trackTimeMapping, project.assets)
  if (project.analysisSnapshot !== undefined) validateAnalysisSnapshot(project.analysisSnapshot, project.assets)
  if (project.video !== undefined) validateVideoSettings(project.video)
}

function validateAnalysisSnapshot(value: unknown, assets: MediaAsset[]): asserts value is AnalysisSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Transcript lưu trong project không hợp lệ.')
  const snapshot = value as Partial<AnalysisSnapshot>
  const historicalProviderKind = (snapshot as { providerKind?: string }).providerKind
  if (historicalProviderKind === 'deepgram' || historicalProviderKind === 'custom') snapshot.providerKind = 'legacy'
  if (typeof snapshot.mappingKey !== 'string' || snapshot.mappingKey.length > 200_000
    || !['mock', 'local', 'legacy'].includes(snapshot.providerKind ?? '')
    || typeof snapshot.capturedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.capturedAt))) {
    throw new Error('Metadata transcript lưu trong project không hợp lệ.')
  }
  if (snapshot.sourceAssetId !== undefined && (!assets.some((asset) => asset.id === snapshot.sourceAssetId && ['full', 'vocal', 'beat'].includes(asset.kind)) || typeof snapshot.sourcePath !== 'string' || !snapshot.sourcePath)) {
    throw new Error('Nguồn audio của transcript lưu không còn trong project.')
  }
  if (snapshot.sourceFingerprint !== undefined && !/^[a-f\d]{64}$/i.test(snapshot.sourceFingerprint)) throw new Error('Fingerprint audio của transcript không hợp lệ.')
  if (snapshot.transcriptCacheKey !== undefined && !/^[a-f\d]{64}$/i.test(snapshot.transcriptCacheKey)) throw new Error('Khóa cache transcript không hợp lệ.')
  if (snapshot.sourceSignature !== undefined && (!Number.isFinite(snapshot.sourceSignature.size) || snapshot.sourceSignature.size < 0 || !Number.isFinite(snapshot.sourceSignature.modifiedAtMs) || snapshot.sourceSignature.modifiedAtMs < 0)) {
    throw new Error('Chữ ký file audio của transcript không hợp lệ.')
  }
  if (snapshot.transcript) validateNormalizedTranscript(snapshot.transcript)
  if (snapshot.sourceTimeAnchors !== undefined) validateTrackTimeMapping({ assetMappings: [{ assetId: snapshot.sourceAssetId, anchors: snapshot.sourceTimeAnchors }] }, assets)
  if (!snapshot.transcript && !snapshot.transcriptCacheKey) throw new Error('Snapshot transcript thiếu dữ liệu hoặc khóa cache.')
  if (snapshot.providerKind !== 'mock' && (!snapshot.sourceAssetId || !snapshot.sourcePath || !snapshot.sourceFingerprint || !snapshot.sourceSignature)) {
    throw new Error('Transcript nhận dạng cần có audio nguồn và fingerprint để xác minh khi căn lại.')
  }
  if (snapshot.sourceFingerprint && snapshot.transcript?.audioFingerprint && snapshot.transcript.audioFingerprint !== snapshot.sourceFingerprint) throw new Error('Fingerprint snapshot không khớp transcript.')
}

function validateNormalizedTranscript(value: unknown): asserts value is NormalizedTranscript {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Partial<NormalizedTranscript>).segments)) throw new Error('Transcript lưu trong project thiếu segments.')
  const transcript = value as NormalizedTranscript
  if (transcript.duration !== undefined && (!Number.isFinite(transcript.duration) || transcript.duration < 0)) throw new Error('Duration transcript không hợp lệ.')
  if (transcript.timingMethod !== undefined && !['asr', 'direct-lyrics-alignment'].includes(transcript.timingMethod)) throw new Error('Phương thức timing transcript không hợp lệ.')
  if (transcript.device !== undefined && !['cpu', 'cuda'].includes(transcript.device)) throw new Error('Thiết bị transcript không hợp lệ.')
  if (transcript.audioFingerprint !== undefined && !/^[a-f\d]{64}$/i.test(transcript.audioFingerprint)) throw new Error('Fingerprint transcript không hợp lệ.')
  if (transcript.transcriptCacheKey !== undefined && !/^[a-f\d]{64}$/i.test(transcript.transcriptCacheKey)) throw new Error('Khóa cache transcript không hợp lệ.')
  if (transcript.audioSignature !== undefined && (!Number.isFinite(transcript.audioSignature.size) || transcript.audioSignature.size < 0 || !Number.isFinite(transcript.audioSignature.modifiedAtMs) || transcript.audioSignature.modifiedAtMs < 0)) throw new Error('Chữ ký file audio không hợp lệ.')
  if (transcript.segments.length > 200_000 || transcript.segments.some((segment) => !segment || typeof segment.id !== 'string' || typeof segment.text !== 'string'
    || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start || !Array.isArray(segment.words)
    || segment.words.some((word) => !word || typeof word.id !== 'string' || typeof word.text !== 'string' || !word.text.trim()
      || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end <= word.start
      || word.start < segment.start - 0.1 || word.end > segment.end + 0.1
      || (word.confidence !== undefined && (!Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 1))))) {
    throw new Error('Timing word/segment trong transcript lưu không hợp lệ.')
  }
}

function validateTrackTimeMapping(value: unknown, assets: MediaAsset[]): asserts value is TrackTimeMapping {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Partial<TrackTimeMapping>).assetMappings)) {
    throw new Error('Cấu hình đồng bộ track không hợp lệ.')
  }
  const mapping = value as TrackTimeMapping
  for (const key of ['analysisAssetId', 'playbackAssetId', 'renderAssetId'] as const) {
    const id = mapping[key]
    if (id !== undefined && !assets.some((asset) => asset.id === id)) throw new Error(`Track ${key} không tồn tại trong project.`)
  }
  const mappedAssets = new Set<string>()
  for (const item of mapping.assetMappings) {
    if (!item || !assets.some((asset) => asset.id === item.assetId) || mappedAssets.has(item.assetId) || !Array.isArray(item.anchors)) {
      throw new Error('Track được đồng bộ không hợp lệ hoặc bị lặp.')
    }
    mappedAssets.add(item.assetId)
    let previousSource = -Infinity
    let previousTimeline = -Infinity
    for (const anchor of item.anchors) {
      if (!anchor || !Number.isFinite(anchor.sourceTime) || !Number.isFinite(anchor.timelineTime) || anchor.sourceTime < 0 || anchor.timelineTime < 0 || anchor.sourceTime <= previousSource || anchor.timelineTime <= previousTimeline) {
        throw new Error('Mốc đồng bộ track phải tăng dần và không âm.')
      }
      previousSource = anchor.sourceTime
      previousTimeline = anchor.timelineTime
    }
  }
}

function validateAsset(asset: unknown): asserts asset is MediaAsset {
  if (!asset || typeof asset !== 'object') throw new Error('Asset không hợp lệ.')
  const item = asset as Partial<MediaAsset>
  if (!item.id || !item.path || !item.displayName || !['full', 'beat', 'vocal', 'lyrics', 'background'].includes(item.kind ?? '')) {
    throw new Error('Asset thiếu id, path, displayName hoặc kind hợp lệ.')
  }
  if (item.derivedKind !== undefined && !['video-audio', 'separation-vocal', 'separation-instrumental'].includes(item.derivedKind)) throw new Error('Loại media dẫn xuất không hợp lệ.')
  if (item.derivedKind !== undefined && (!item.derivedFrom || (item.derivedKind === 'separation-vocal' && item.kind !== 'vocal') || (item.derivedKind === 'separation-instrumental' && item.kind !== 'beat'))) throw new Error('Quan hệ media dẫn xuất không khớp loại track.')
  if (item.duration !== undefined && (!Number.isFinite(item.duration) || item.duration < 0)) throw new Error('Duration media không hợp lệ.')
}

function validateSegment(segment: unknown): asserts segment is LyricSegment {
  if (!segment || typeof segment !== 'object') throw new Error('Segment không hợp lệ.')
  const item = segment as Partial<LyricSegment>
  if (!item.id || typeof item.text !== 'string' || typeof item.start !== 'number' || typeof item.end !== 'number' || !Array.isArray(item.words)) {
    throw new Error('Segment thiếu id/text/start/end/words.')
  }
  if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start) {
    throw new Error(`Timing không hợp lệ ở segment ${item.id}.`)
  }
  if (!['male', 'female', 'duet', 'unknown'].includes(item.speakerRole ?? '')) throw new Error(`Vai hát không hợp lệ ở segment ${item.id}.`)
  if (item.origin !== undefined && !['manual', 'asr', 'aligned', 'estimated'].includes(item.origin)) throw new Error(`Nguồn timing không hợp lệ ở segment ${item.id}.`)
  if (item.reviewReason !== undefined && !['estimated-timing', 'recognition-timing', 'low-text-match', 'empty-timing', 'manual-edit', 'explicit', 'reviewed'].includes(item.reviewReason)) throw new Error(`Lý do cần rà soát không hợp lệ ở segment ${item.id}.`)
  if (item.reviewStatus !== undefined && !['pending', 'listened', 'edited', 'explicitly-accepted'].includes(item.reviewStatus)) throw new Error(`Trạng thái rà soát không hợp lệ ở segment ${item.id}.`)
  if (item.timingLocked !== undefined && typeof item.timingLocked !== 'boolean') throw new Error(`Trạng thái khóa timing không hợp lệ ở segment ${item.id}.`)
  if (item.confidence !== undefined && (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) {
    throw new Error(`Confidence không hợp lệ ở segment ${item.id}.`)
  }
  for (const word of item.words) validateWord(word, item)
}

function validateWord(value: unknown, segment: Partial<LyricSegment>): asserts value is LyricSegment['words'][number] {
  if (!value || typeof value !== 'object') throw new Error(`Word không hợp lệ ở segment ${segment.id}.`)
  const word = value as Partial<LyricSegment['words'][number]>
  if (!word.id || typeof word.text !== 'string' || !word.text.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start! < 0 || word.end! <= word.start!) {
    throw new Error(`Timing hoặc nội dung word không hợp lệ ở segment ${segment.id}.`)
  }
  if (word.start! < segment.start! - 0.02 || word.end! > segment.end! + 0.02) {
    throw new Error(`Word nằm ngoài thời gian segment ${segment.id}.`)
  }
  if (word.confidence !== undefined && (!Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 1)) {
    throw new Error(`Confidence word không hợp lệ ở segment ${segment.id}.`)
  }
  if (word.origin !== undefined && !['manual', 'asr', 'aligned', 'estimated'].includes(word.origin)) throw new Error(`Nguồn timing word không hợp lệ ở segment ${segment.id}.`)
  if (word.timingLocked !== undefined && typeof word.timingLocked !== 'boolean') throw new Error(`Trạng thái khóa timing word không hợp lệ ở segment ${segment.id}.`)
}

function validateSpeaker(speaker: unknown): asserts speaker is SpeakerProfile {
  if (!speaker || typeof speaker !== 'object') throw new Error('Speaker không hợp lệ.')
  const item = speaker as Partial<SpeakerProfile>
  if (!item.id || !item.label || !item.role || !item.color) throw new Error('Speaker thiếu thông tin.')
}

function validateProvider(provider: unknown): asserts provider is ProviderProfile {
  if (!provider || typeof provider !== 'object') throw new Error('Provider không hợp lệ.')
  const item = provider as Partial<ProviderProfile>
  if (!['mock', 'local'].includes(item.kind ?? '')) {
    throw new Error('Cấu hình provider không hợp lệ.')
  }
  if (item.kind === 'local') {
    if (item.localPythonPath !== undefined && typeof item.localPythonPath !== 'string') throw new Error('Đường dẫn Python runtime không hợp lệ.')
    if (item.localSource !== undefined && !['original', 'vocal', 'auto'].includes(item.localSource)) throw new Error('Nguồn timestamp local không hợp lệ.')
    if (item.localDevice !== undefined && !['auto', 'cpu', 'cuda'].includes(item.localDevice)) throw new Error('Thiết bị local không hợp lệ.')
  }
}

function validateVideoSettings(value: unknown): asserts value is VideoSettings {
  if (!value || typeof value !== 'object') throw new Error('Cấu hình video không hợp lệ.')
  const video = value as Partial<VideoSettings>
  if (!Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width! < 16 || video.height! < 16 || video.width! > 3840 || video.height! > 2160 || video.width! % 2 !== 0 || video.height! % 2 !== 0) {
    throw new Error('Kích thước video không hợp lệ (chiều rộng/cao phải là số chẵn trong giới hạn hỗ trợ).')
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
  const { previewScale: _previewScale, ...videoSettings } = video as VideoSettings & { previewScale?: number }
  return { ...project, video: { ...videoSettings, lyricPosition: { ...video.lyricPosition } } }
}

export function parseProjectJson(text: string): KaraProject {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Không thể đọc project: JSON bị lỗi.')
  }
  const migrated = migrateProject(value)
  assertProject(migrated)
  return normalizeProject(migrated)
}

export function serializeProject(project: KaraProject): string {
  return JSON.stringify(normalizeProject(project), null, 2)
}
