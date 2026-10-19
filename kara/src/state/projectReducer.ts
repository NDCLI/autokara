import type { KaraProject, LyricSegment, MediaAsset, ProviderProfile, ExportOptions } from '../../shared/contracts'

export type ProjectHistory = {
  present: KaraProject
  past: KaraProject[]
  future: KaraProject[]
}

export type ProjectAction =
  | { type: 'replace'; project: KaraProject }
  | { type: 'set-title'; title: string }
  | { type: 'set-assets'; assets: MediaAsset[] }
  | { type: 'set-segments'; segments: LyricSegment[] }
  | { type: 'update-segment'; id: string; patch: Partial<LyricSegment> }
  | { type: 'delete-segment'; id: string }
  | { type: 'set-provider'; provider: ProviderProfile }
  | { type: 'set-export-options'; options: Partial<ExportOptions> }
  | { type: 'undo' }
  | { type: 'redo' }

function stamp(project: KaraProject): KaraProject {
  return { ...project, updatedAt: new Date().toISOString() }
}

function commit(state: ProjectHistory, next: KaraProject): ProjectHistory {
  if (JSON.stringify(state.present) === JSON.stringify(next)) return state
  return { present: stamp(next), past: [...state.past, state.present].slice(-80), future: [] }
}

export function createHistory(project: KaraProject): ProjectHistory {
  return { present: project, past: [], future: [] }
}

export function projectReducer(state: ProjectHistory, action: ProjectAction): ProjectHistory {
  switch (action.type) {
    case 'replace':
      return createHistory(action.project)
    case 'set-title':
      return commit(state, { ...state.present, title: action.title })
    case 'set-assets':
      return commit(state, { ...state.present, assets: action.assets })
    case 'set-segments':
      return commit(state, { ...state.present, segments: action.segments })
    case 'update-segment':
      return commit(state, {
        ...state.present,
        segments: state.present.segments.map((segment) => segment.id === action.id ? { ...segment, ...action.patch } : segment),
      })
    case 'delete-segment':
      return commit(state, { ...state.present, segments: state.present.segments.filter((segment) => segment.id !== action.id) })
    case 'set-provider':
      return commit(state, { ...state.present, provider: action.provider })
    case 'set-export-options':
      return commit(state, { ...state.present, exportOptions: { ...state.present.exportOptions, ...action.options } })
    case 'undo': {
      const previous = state.past.at(-1)
      if (!previous) return state
      return { present: previous, past: state.past.slice(0, -1), future: [state.present, ...state.future] }
    }
    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return { present: next, past: [...state.past, state.present], future: state.future.slice(1) }
    }
    default:
      return state
  }
}
