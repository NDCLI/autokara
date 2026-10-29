import type { AnalysisSnapshot, KaraProject, LyricSegment, MediaAsset, ProviderProfile, ExportOptions, NormalizedPosition, TrackTimeMapping, VideoSettings } from '../../shared/contracts'

export type ProjectHistory = {
  present: KaraProject
  past: KaraProject[]
  future: KaraProject[]
  transactionBase?: KaraProject
}

export type ProjectAction =
  | { type: 'replace'; project: KaraProject }
  | { type: 'set-title'; title: string }
  | { type: 'set-lyrics'; text: string }
  | { type: 'set-assets'; assets: MediaAsset[] }
  | { type: 'set-segments'; segments: LyricSegment[] }
  | { type: 'set-analysis-result'; segments: LyricSegment[]; snapshot?: AnalysisSnapshot }
  | { type: 'update-segment'; id: string; patch: Partial<LyricSegment> }
  | { type: 'delete-segment'; id: string }
  | { type: 'set-provider'; provider: ProviderProfile }
  | { type: 'set-track-time-mapping'; mapping: TrackTimeMapping }
  | { type: 'set-export-options'; options: Partial<ExportOptions> }
  | { type: 'set-video-settings'; settings: Partial<Omit<VideoSettings, 'lyricPosition'>> & { lyricPosition?: Partial<NormalizedPosition> } }
  | { type: 'begin-transaction' }
  | { type: 'end-transaction' }
  | { type: 'cancel-transaction' }
  | { type: 'undo' }
  | { type: 'redo' }

function stamp(project: KaraProject, revision: number): KaraProject {
  return { ...project, revision, updatedAt: new Date().toISOString() }
}

function commit(state: ProjectHistory, next: KaraProject): ProjectHistory {
  if (JSON.stringify(state.present) === JSON.stringify(next)) return state
  if (state.transactionBase) return { ...state, present: stamp(next, state.present.revision + 1) }
  return { present: stamp(next, state.present.revision + 1), past: [...state.past, state.present].slice(-80), future: [] }
}

export function createHistory(project: KaraProject): ProjectHistory {
  return { present: project, past: [], future: [] }
}

export function projectReducer(state: ProjectHistory, action: ProjectAction): ProjectHistory {
  switch (action.type) {
    case 'replace':
      return createHistory(action.project)
    case 'set-lyrics':
      return commit(state, { ...state.present, lyricsDraft: action.text })
    case 'set-title':
      return commit(state, { ...state.present, title: action.title })
    case 'set-assets': {
      const mapping = state.present.trackTimeMapping
      const analysisSnapshot = state.present.analysisSnapshot
      const sourceAsset = analysisSnapshot?.sourceAssetId ? action.assets.find((asset) => asset.id === analysisSnapshot.sourceAssetId && ['full', 'vocal', 'beat'].includes(asset.kind)) : undefined
      const sourceStillMatches = !analysisSnapshot?.sourceAssetId || Boolean(sourceAsset)
      const nextAnalysisSnapshot = sourceStillMatches && analysisSnapshot?.sourceAssetId && sourceAsset
        ? { ...analysisSnapshot, sourcePath: sourceAsset.path }
        : sourceStillMatches ? analysisSnapshot : undefined
      return commit(state, {
        ...state.present,
        assets: action.assets,
        analysisSnapshot: nextAnalysisSnapshot,
        trackTimeMapping: {
          ...mapping,
          analysisAssetId: action.assets.some((asset) => asset.id === mapping.analysisAssetId) ? mapping.analysisAssetId : undefined,
          playbackAssetId: action.assets.some((asset) => asset.id === mapping.playbackAssetId) ? mapping.playbackAssetId : undefined,
          renderAssetId: action.assets.some((asset) => asset.id === mapping.renderAssetId) ? mapping.renderAssetId : undefined,
          assetMappings: mapping.assetMappings.filter((item) => action.assets.some((asset) => asset.id === item.assetId)),
        },
      })
    }
    case 'set-segments':
      return commit(state, { ...state.present, segments: action.segments })
    case 'set-analysis-result':
      return commit(state, { ...state.present, segments: action.segments, analysisSnapshot: action.snapshot })
    case 'update-segment':
      return commit(state, {
        ...state.present,
        segments: state.present.segments.map((segment) => segment.id === action.id ? { ...segment, ...action.patch } : segment),
      })
    case 'delete-segment':
      return commit(state, { ...state.present, segments: state.present.segments.filter((segment) => segment.id !== action.id) })
    case 'set-provider':
      return commit(state, { ...state.present, provider: action.provider })
    case 'set-track-time-mapping':
      return commit(state, { ...state.present, trackTimeMapping: action.mapping })
    case 'set-export-options':
      return commit(state, { ...state.present, exportOptions: { ...state.present.exportOptions, ...action.options } })
    case 'set-video-settings': {
      const video = state.present.video
      return commit(state, {
        ...state.present,
        video: {
          width: action.settings.width ?? video?.width ?? 1920,
          height: action.settings.height ?? video?.height ?? 1080,
          backgroundColor: action.settings.backgroundColor ?? video?.backgroundColor ?? '#10162a',
          lyricPosition: {
            x: action.settings.lyricPosition?.x ?? video?.lyricPosition.x ?? 0.5,
            y: action.settings.lyricPosition?.y ?? video?.lyricPosition.y ?? 0.78,
          },
        },
      })
    }
    case 'begin-transaction':
      return state.transactionBase ? state : { ...state, transactionBase: state.present }
    case 'end-transaction': {
      if (!state.transactionBase) return state
      const base = state.transactionBase
      const changed = JSON.stringify({ ...base, revision: 0, updatedAt: '' }) !== JSON.stringify({ ...state.present, revision: 0, updatedAt: '' })
      return changed
        ? { present: state.present, past: [...state.past, base].slice(-80), future: [], transactionBase: undefined }
        : { ...state, transactionBase: undefined }
    }
    case 'cancel-transaction':
      return state.transactionBase
        ? { ...state, present: stamp(state.transactionBase, state.present.revision + 1), transactionBase: undefined }
        : state
    case 'undo': {
      if (state.transactionBase) return state
      const previous = state.past.at(-1)
      if (!previous) return state
      return { present: stamp(previous, state.present.revision + 1), past: state.past.slice(0, -1), future: [state.present, ...state.future] }
    }
    case 'redo': {
      if (state.transactionBase) return state
      const next = state.future[0]
      if (!next) return state
      return { present: stamp(next, state.present.revision + 1), past: [...state.past, state.present], future: state.future.slice(1) }
    }
    default:
      return state
  }
}
