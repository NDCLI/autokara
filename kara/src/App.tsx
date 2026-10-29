import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_PROVIDER, DEFAULT_VIDEO_SETTINGS, SPEAKER_COLORS, type ExportFormat, type KaraProject, type LyricSegment, type MediaAsset, type MediaKind, type NormalizedPosition, type NormalizedTranscript, type ProviderKind, type ProviderProfile, type RenderProgress, type RenderRequest, type SpeakerRole, type TrackTimeMapping } from '../shared/contracts'
import { parseProjectJson } from '../shared/validation'
import { lyricsToSegments, parseLyrics } from './lib/lyrics/parse'
import { alignTranscriptToLyrics } from './lib/lyrics/autoAlign'
import { moveWord, resizeSegment, resizeWord } from './engine/timeline'
import { preserveLockedTimings } from './engine/preserveLockedTimings'
import { realignSegmentFromTranscript } from './engine/realignSegment'
import { captureRecognitionSnapshot, isRecognitionSnapshotCurrent } from './engine/recognitionSnapshot'
import { assetTimeToTimeline, mapSegmentsToAssetTime, mapTranscriptToTimeline, timelineToAssetTime } from './engine/timeMapping'
import { buildAss, buildSrt } from './lib/export/subtitles'
import { formatClock, formatTimecode, parseTimecode } from './lib/timecode'
import { createHistory, projectReducer } from './state/projectReducer'
import { createDemoSegments, createNewProject } from './state/projectFactory'
import { finishWordRecording, beginHeldWord, endHeldWord, markWord, startWordRecording as createWordRecordingSession, type WordRecordingSession } from './lib/lyrics/recording'
import VideoPreview from './components/VideoPreview'
import WordTimingLane from './components/WordTimingLane'
import { WorkspaceResizeHandle } from './components/WorkspaceResizeHandle'
import { estimateTrackOffset, offsetToAnchor, type SyncEstimate } from './engine/trackSync'
import { acknowledgeSegment, editReviewState, markSegmentHeard } from './engine/reviewQueue'

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const roleLabels: Record<SpeakerRole, string> = { male: 'Nam', female: 'Nữ', duet: 'Đối đáp', unknown: 'Chưa gán' }
const roleShort: Record<SpeakerRole, string> = { male: 'NAM', female: 'NỮ', duet: 'ĐÔI', unknown: '—' }

function pruneTrackMapping(mapping: TrackTimeMapping, assets: MediaAsset[]): TrackTimeMapping {
  const exists = (id?: string) => id && assets.some((asset) => asset.id === id) ? id : undefined
  return {
    analysisAssetId: exists(mapping.analysisAssetId),
    playbackAssetId: exists(mapping.playbackAssetId),
    renderAssetId: exists(mapping.renderAssetId),
    assetMappings: mapping.assetMappings.filter((item) => assets.some((asset) => asset.id === item.assetId)),
  }
}

function finiteMediaDuration(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function createProject(): KaraProject {
  return { ...createNewProject({ provider: DEFAULT_PROVIDER, exportOptions: DEFAULT_EXPORT_OPTIONS }), segments: [] }
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  const paths: Record<string, React.ReactNode> = {
    play: <path d="m8 5 12 7-12 7V5Z" fill="currentColor" stroke="none" />,
    pause: <><path d="M8 5h3v14H8z" fill="currentColor" stroke="none" /><path d="M15 5h3v14h-3z" fill="currentColor" stroke="none" /></>,
    back: <><path d="M5 5v14" /><path d="m19 6-10 6 10 6V6Z" fill="currentColor" stroke="none" /></>,
    forward: <><path d="M19 5v14" /><path d="m5 6 10 6-10 6V6Z" fill="currentColor" stroke="none" /></>,
    folder: <><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10Z" /><path d="M3 10h18" /></>,
    save: <><path d="M5 3h12l4 4v14H3V3h2Z" /><path d="M7 3v6h10V3M7 21v-8h10v8" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" /></>,
    export: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 15v5h14v-5" /></>,
    undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h9a6 6 0 0 1 0 12h-2" /></>,
    redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9h-9a6 6 0 0 0 0 12h2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
    mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8" /></>,
    lyrics: <><path d="M4 5h16M4 10h16M4 15h10" /><path d="M18 14v6m-3-3h6" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    warning: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4m0 3h.01" /></>,
    split: <><path d="M12 3v8m0 0-5-5m5 5 5-5M5 15v6m14-6v6" /></>,
    merge: <><path d="M5 3v6c0 3 3 3 7 3s7 0 7 3v6M5 3l-3 3m3-3 3 3m11 15-3-3m3 3 3-3" /></>,
    trash: <><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3Z" /></>,
  }
  return <svg {...common}>{paths[name] ?? <circle cx="12" cy="12" r="8" />}</svg>
}

type DragState = { id: string; edge: 'start' | 'end'; startX: number; originalStart: number; originalEnd: number; previewStart?: number; previewEnd?: number }

type WorkspaceWidths = { source: number; inspector: number }
const WORKSPACE_WIDTHS_KEY = 'kara-studio.workspace-widths'
const DEFAULT_WORKSPACE_WIDTHS: WorkspaceWidths = { source: 198, inspector: 252 }

function readWorkspaceWidths(): WorkspaceWidths {
  try {
    const saved = JSON.parse(window.localStorage.getItem(WORKSPACE_WIDTHS_KEY) || '{}') as Partial<WorkspaceWidths>
    return {
      source: Number.isFinite(saved.source) ? Math.max(150, Math.min(320, saved.source!)) : DEFAULT_WORKSPACE_WIDTHS.source,
      inspector: Number.isFinite(saved.inspector) ? Math.max(210, Math.min(400, saved.inspector!)) : DEFAULT_WORKSPACE_WIDTHS.inspector,
    }
  } catch { return DEFAULT_WORKSPACE_WIDTHS }
}

type RenderState = {
  jobId: string
  status: 'idle' | 'running' | 'canceling' | 'done' | 'error' | 'canceled'
  percent: number
  message: string
  error?: string
  outputPath?: string
  outputUrl?: string
}

function App() {
  const [history, dispatch] = useReducer(projectReducer, undefined, () => createHistory(createProject()))
  const project = history.present
  const currentProjectRef = useRef(project)
  currentProjectRef.current = project
  const [recoveryCandidate, setRecoveryCandidate] = useState<KaraProject | null>(() => {
    if (window.kara) return null
    try {
      const saved = window.localStorage.getItem('kara-last-project')
      return saved ? parseProjectJson(saved) : null
    } catch { return null }
  })
  const [recoveryChecked, setRecoveryChecked] = useState(() => !window.kara)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [currentPath, setCurrentPath] = useState<string | undefined>()
  const [activeKind, setActiveKind] = useState<'full' | 'beat' | 'vocal'>('full')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [workspaceWidths, setWorkspaceWidths] = useState<WorkspaceWidths>(readWorkspaceWidths)
  const [workflowStep, setWorkflowStep] = useState<'ingest' | 'recognize' | 'sync' | 'preview' | 'export'>('ingest')
  const sourceRailRef = useRef<HTMLElement | null>(null)
  const editorColumnRef = useRef<HTMLElement | null>(null)
  const recognitionActionRef = useRef<HTMLButtonElement | null>(null)
  const syncSectionRef = useRef<HTMLDivElement | null>(null)
  const previewSectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    try { window.localStorage.setItem(WORKSPACE_WIDTHS_KEY, JSON.stringify(workspaceWidths)) } catch { /* Storage is optional. */ }
  }, [workspaceWidths])

  const [selectedId, setSelectedId] = useState(project.segments[0]?.id ?? '')
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loopSegmentId, setLoopSegmentId] = useState('')
  const [slowPlayback, setSlowPlayback] = useState(false)
  const [reviewQueueOpen, setReviewQueueOpen] = useState(false)
  const [reviewedAudioIds, setReviewedAudioIds] = useState<string[]>([])
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({})
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([])
  const [waveformImage, setWaveformImage] = useState<string | null>(null)
  const [waveformLoading, setWaveformLoading] = useState(false)
  const [backgroundUrl, setBackgroundUrl] = useState<string | undefined>()
  const videoPreviewFallbackRef = useRef(new Set<string>())
  const [busy, setBusy] = useState(false)
  const [recognitionProgress, setRecognitionProgress] = useState(0)
  const [recognitionJobId, setRecognitionJobId] = useState('')
  const [realignmentBusy, setRealignmentBusy] = useState(false)
  const [modal, setModal] = useState<'provider' | 'export' | 'render' | null>(null)
  const [toast, setToast] = useState('')
  const [providerProfile, setProviderProfile] = useState<ProviderProfile>(DEFAULT_PROVIDER)
  const [runtimeCheck, setRuntimeCheck] = useState<{ busy: boolean; message: string; ok?: boolean }>({ busy: false, message: '' })
  const [exportFormat, setExportFormat] = useState<ExportFormat>('ass')
  const [exportPreview, setExportPreview] = useState('')
  const [drag, setDrag] = useState<DragState | null>(null)
  const lyricsRaw = project.lyricsDraft ?? ''
  const setLyricsRaw = (text: string) => dispatch({ type: 'set-lyrics', text })
  const providerProfileRef = useRef(providerProfile)
  providerProfileRef.current = providerProfile
  const lyricsRawRef = useRef(lyricsRaw)
  lyricsRawRef.current = lyricsRaw
  const [audioError, setAudioError] = useState('')
  const [browserImportKind, setBrowserImportKind] = useState<MediaKind>('full')
  const [mappingAssetId, setMappingAssetId] = useState('')
  const [mappingSourceTime, setMappingSourceTime] = useState('0')
  const [mappingTimelineTime, setMappingTimelineTime] = useState('0')
  const [syncEstimate, setSyncEstimate] = useState<SyncEstimate | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [renderState, setRenderState] = useState<RenderState>({ jobId: '', status: 'idle', percent: 0, message: '' })
  const [separationJobId, setSeparationJobId] = useState('')
  const [wordRecording, setWordRecording] = useState<WordRecordingSession | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const cancelRenderRef = useRef(false)
  const wordRecordingRef = useRef<WordRecordingSession | null>(null)
  const wordRecordingGenerationRef = useRef(0)
  const wordRecordingSeekCleanupRef = useRef<(() => void) | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const videoAudioRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const autosaveRef = useRef<number | null>(null)
  const verifiedMediaRef = useRef(new Map<string, string>())

  const fullAsset = project.assets.find((asset) => asset.kind === 'full')
  const beatAsset = project.assets.find((asset) => asset.kind === 'beat')
  const vocalAsset = project.assets.find((asset) => asset.kind === 'vocal')
  const backgroundAsset = project.assets.find((asset) => asset.kind === 'background')
  const lyricsAsset = project.assets.find((asset) => asset.kind === 'lyrics')
  const mappableAssets = project.assets.filter((asset) => ['full', 'beat', 'vocal'].includes(asset.kind))
  const selectedMappingAsset = mappableAssets.find((asset) => asset.id === mappingAssetId) ?? mappableAssets[0]
  const previewBackgroundUrl = backgroundUrl ?? backgroundAsset?.url
  const mappedPlaybackAsset = project.assets.find((asset) => asset.id === project.trackTimeMapping.playbackAssetId)
  const activeAsset = mappedPlaybackAsset && mappedPlaybackAsset.kind !== 'background' && mappedPlaybackAsset.kind !== 'lyrics'
    ? mappedPlaybackAsset
    : activeKind === 'full' ? fullAsset : activeKind === 'vocal' ? vocalAsset : beatAsset
  const videoProvidesAudio = !fullAsset && !beatAsset && !vocalAsset && Boolean(previewBackgroundUrl)
  const mappedRenderAsset = project.assets.find((asset) => asset.id === project.trackTimeMapping.renderAssetId)
  const renderAsset = mappedRenderAsset && mappedRenderAsset.kind !== 'background' && mappedRenderAsset.kind !== 'lyrics' ? mappedRenderAsset : beatAsset ?? fullAsset ?? vocalAsset
  const mappedAnalysisAsset = project.assets.find((asset) => asset.id === project.trackTimeMapping.analysisAssetId)
  const analysisAsset = mappedAnalysisAsset && mappedAnalysisAsset.kind !== 'background' && mappedAnalysisAsset.kind !== 'lyrics'
    ? mappedAnalysisAsset
    : providerProfile.kind === 'local'
      ? providerProfile.localSource === 'vocal' ? vocalAsset : providerProfile.localSource === 'auto' ? vocalAsset ?? fullAsset : fullAsset
      : fullAsset ?? vocalAsset
  const renderAudioPath = renderAsset?.path ?? (videoProvidesAudio ? backgroundAsset?.path : undefined)
  const renderAudioDuration = renderAsset?.duration ?? assetDurations[renderAsset?.id ?? ''] ?? (backgroundAsset ? assetDurations[backgroundAsset.id] : undefined)
  const selected = project.segments.find((segment) => segment.id === selectedId) ?? project.segments[0]
  const analysisSnapshot = project.analysisSnapshot
  const recentTranscriptMatches = Boolean(analysisSnapshot
    && analysisSnapshot.mappingKey === JSON.stringify(project.trackTimeMapping)
    && (analysisSnapshot.sourceAssetId === undefined
      ? analysisSnapshot.providerKind === 'mock' && providerProfile.kind === 'mock'
      : analysisSnapshot.sourceAssetId === analysisAsset?.id))
  const videoSettings = project.video ?? DEFAULT_VIDEO_SETTINGS
  const maxTime = Math.max(Number.isFinite(duration) && duration > 0 ? duration : 0, ...project.segments.map((segment) => Number.isFinite(segment.end) ? segment.end : 0), 20)
  const sortedSegments = useMemo(() => [...project.segments].sort((a, b) => a.start - b.start), [project.segments])
  const completedCount = project.segments.filter((segment) => !segment.needsReview).length
  const reviewCount = project.segments.filter((segment) => segment.needsReview).length

  useEffect(() => {
    if (!selectedMappingAsset) return
    if (mappingAssetId !== selectedMappingAsset.id) setMappingAssetId(selectedMappingAsset.id)
  }, [mappingAssetId, selectedMappingAsset])

  useEffect(() => {
    wordRecordingRef.current = wordRecording
  }, [wordRecording])

  useEffect(() => {
    if (!window.kara) return
    void window.kara.loadProviderSettings().then(({ profile }) => {
      setProviderProfile(profile)
      dispatch({ type: 'set-provider', provider: profile })
    }).catch(() => setToast('Không tải được cấu hình nhận dạng đã lưu.'))
  }, [])

  useEffect(() => {
    if (!window.kara) return
    void window.kara.loadRecoveryProject().then((saved) => {
      if (!saved) return
      try {
        const recovered = parseProjectJson(saved)
        if (recovered.assets.length || recovered.segments.length) setRecoveryCandidate(recovered)
      } catch {
        setToast('Bản tự khôi phục bị lỗi và không thể mở.')
      }
    }).catch(() => setToast('Không đọc được bản tự khôi phục.')).finally(() => setRecoveryChecked(true))
  }, [])

  useEffect(() => {
    if (!wordRecording) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.code !== 'Space' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      event.preventDefault()
      beginHeldWordAtCurrentTime()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      event.preventDefault()
      endHeldWordAtCurrentTime()
    }
    const onBlur = () => { if (wordRecordingRef.current?.spaceHeld) endHeldWordAtCurrentTime() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [wordRecording])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!window.kara?.onTranscribeProgress) return
    return window.kara.onTranscribeProgress((progress) => setRecognitionProgress(progress.percent ?? 0))
  }, [])

  useEffect(() => {
    if (!window.kara) return
    return window.kara.onRenderProgress((progress) => {
      setRenderState((current) => current.jobId === progress.jobId
        ? { ...current, percent: progress.percent, message: progress.status }
        : current)
    })
  }, [])

  useEffect(() => {
    if (!videoProvidesAudio) return
    const video = videoAudioRef.current
    if (!video) return
    if (playing && video.paused) void video.play().catch(() => setAudioError('Trình duyệt không thể phát audio trong video này.'))
    if (!playing && !video.paused) video.pause()
  }, [playing, videoProvidesAudio])

  useEffect(() => {
    const source = activeAsset?.url
    if (!source) {
      setWaveformPeaks([])
      setWaveformImage(null)
      setWaveformLoading(false)
      return
    }
    let canceled = false
    let context: AudioContext | undefined
    const controller = new AbortController()
    setWaveformPeaks([])
    setWaveformImage(null)
    setWaveformLoading(true)
    void (async () => {
      try {
        if (window.kara && activeAsset?.path) {
          const image = await window.kara.getWaveform(activeAsset.path)
          if (!canceled) setWaveformImage(image)
          return
        }
        const response = await fetch(source, { signal: controller.signal })
        if (!response.ok) throw new Error('Không đọc được audio để tạo waveform.')
        const bytes = await response.arrayBuffer()
        if (canceled) return
        context = new AudioContext()
        const decoded = await context.decodeAudioData(bytes)
        if (canceled) return
        const bucketCount = 188
        const peaks: number[] = []
        for (let index = 0; index < bucketCount; index += 1) {
          const start = Math.floor(index * decoded.length / bucketCount)
          const end = Math.max(start + 1, Math.floor((index + 1) * decoded.length / bucketCount))
          let peak = 0
          for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
            const data = decoded.getChannelData(channel)
            for (let sample = start; sample < end && sample < data.length; sample += 1) peak = Math.max(peak, Math.abs(data[sample]))
          }
          peaks.push(peak)
          if (index % 4 === 3) {
            await new Promise((resolve) => window.setTimeout(resolve, 0))
            if (canceled) return
          }
        }
        setWaveformPeaks(peaks)
      } catch {
        if (!canceled) { setWaveformPeaks([]); setWaveformImage(null) }
      } finally {
        await context?.close().catch(() => undefined)
        if (!canceled) setWaveformLoading(false)
      }
    })()
    return () => { canceled = true; controller.abort(); void context?.close().catch(() => undefined) }
  }, [activeAsset?.id, activeAsset?.url, activeAsset?.path])

  useEffect(() => {
    if (!videoProvidesAudio || !videoAudioRef.current) return
    const video = videoAudioRef.current
    const onMetadata = () => {
      const nextDuration = Number.isFinite(video.duration) ? video.duration : 0
      setDuration(assetTimeToTimeline(nextDuration, project.trackTimeMapping, backgroundAsset?.id))
      if (backgroundAsset) setAssetDurations((current) => ({ ...current, [backgroundAsset.id]: nextDuration }))
    }
    video.addEventListener('loadedmetadata', onMetadata)
    return () => video.removeEventListener('loadedmetadata', onMetadata)
  }, [backgroundAsset, project.trackTimeMapping, videoProvidesAudio])

  useEffect(() => {
    if (!playing) return
    const media = activeAsset ? audioRef.current : videoProvidesAudio ? videoAudioRef.current : null
    if (!media) return
    let frame = 0
    let lastUpdate = 0
    const update = (now: number) => {
      if (now - lastUpdate >= 33) {
        const sourceAsset = activeAsset ?? backgroundAsset
        const timelineTime = assetTimeToTimeline(media.currentTime, project.trackTimeMapping, sourceAsset?.id)
        const loopSegment = project.segments.find((segment) => segment.id === loopSegmentId)
        if (loopSegment && timelineTime >= loopSegment.end) {
          if (loopSegment.needsReview) {
            setReviewedAudioIds((ids) => markSegmentHeard({ heardSegmentIds: ids }, loopSegment.id).heardSegmentIds)
          }
          media.currentTime = Math.max(0, timelineToAssetTime(loopSegment.start, project.trackTimeMapping, sourceAsset?.id))
          setPosition(loopSegment.start)
        } else setPosition(timelineTime)
        lastUpdate = now
      }
      if (!media.paused && !media.ended) frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [activeAsset?.id, backgroundAsset?.id, loopSegmentId, playing, project.segments, project.trackTimeMapping, videoProvidesAudio])

  useEffect(() => {
    const media = activeAsset ? audioRef.current : videoProvidesAudio ? videoAudioRef.current : null
    if (!media) return
    media.playbackRate = slowPlayback ? 0.7 : 1
    if ('preservesPitch' in media) media.preservesPitch = true
    return () => { media.playbackRate = 1 }
  }, [activeAsset?.id, slowPlayback, videoProvidesAudio])

  useEffect(() => {
    if (!drag) return
    const onMove = (event: PointerEvent) => {
      const width = rulerRef.current?.getBoundingClientRect().width ?? 0
      if (!width) return
      const delta = (event.clientX - drag.startX) / width * maxTime
      if (drag.edge === 'start') {
        const start = Math.max(0, Math.min(drag.originalEnd - 0.12, drag.originalStart + delta))
        setDrag((current) => current?.id === drag.id ? { ...current, previewStart: start } : current)
      } else {
        const end = Math.max(drag.originalStart + 0.12, drag.originalEnd + delta)
        setDrag((current) => current?.id === drag.id ? { ...current, previewEnd: end } : current)
      }
    }
    const onUp = () => {
      const segment = project.segments.find((item) => item.id === drag.id)
      if (segment) {
        const start = drag.previewStart ?? drag.originalStart
        const end = drag.previewEnd ?? drag.originalEnd
        changeSegment(drag.id, { start, end })
      }
      setDrag(null)
    }
    const onCancel = () => setDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('pointercancel', onCancel, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [drag, maxTime, project.segments])

  useEffect(() => {
    if (!recoveryChecked || recoveryCandidate) return
    if (autosaveRef.current) window.clearTimeout(autosaveRef.current)
    autosaveRef.current = window.setTimeout(() => {
      if (window.kara) {
        void window.kara.saveRecoveryProject(project).catch(() => setToast('Không lưu được bản tự khôi phục.'))
      } else {
        try { window.localStorage.setItem('kara-last-project', JSON.stringify(project)) } catch { /* storage is optional */ }
      }
    }, 800)
    return () => { if (autosaveRef.current) window.clearTimeout(autosaveRef.current) }
  }, [project, recoveryChecked, recoveryCandidate])

  function notify(message: string) {
    setToast(message)
  }

  async function loadMedia(kind: MediaKind) {
    setBrowserImportKind(kind)
    try {
      const file = await window.kara?.pickFile(kind)
      if (!file) {
        if (!window.kara) inputRef.current?.click()
        return
      }
      const priorAsset = project.assets.find((item) => item.kind === kind)
      const isRelink = priorAsset?.processing === 'error'
      const asset: MediaAsset = { id: isRelink ? priorAsset.id : makeId(), kind, ...file, processing: kind === 'lyrics' ? undefined : 'ready' }
      if (isRelink) setAssetDurations((current) => { const next = { ...current }; delete next[asset.id]; return next })
      const assets = [...project.assets.filter((item) => item.kind !== kind), asset]
      dispatch({ type: 'set-assets', assets })
      if (kind === 'lyrics') {
        const text = await window.kara!.readTextFile(file.path)
        setLyricsRaw(text)
        const parsed = parseLyrics(text, file.displayName)
        dispatch({ type: 'set-segments', segments: lyricsToSegments(parsed) })
        setSelectedId(project.segments[0]?.id ?? '')
        notify(`${parsed.length} dòng lời đã nhập.`)
      } else if (kind === 'background') {
        setBackgroundUrl(file.url)
        notify('Video nền đã sẵn sàng.')
      } else {
        if (kind === 'full') setActiveKind('full')
        if (kind === 'vocal') setActiveKind('vocal')
        if (kind === 'beat') setActiveKind('beat')
        dispatch({ type: 'set-track-time-mapping', mapping: { ...pruneTrackMapping(currentProjectRef.current.trackTimeMapping, assets), playbackAssetId: asset.id } })
        setAudioError('')
        notify(`${kind === 'full' ? 'Bản đầy đủ' : kind === 'vocal' ? 'Vocal stem' : 'Beat'} đã sẵn sàng.`)
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thể nhập file.')
    }
  }

  async function extractVideoAudio() {
    if (!window.kara || !backgroundAsset) return
    try {
      const file = await window.kara.extractVideoAudio(backgroundAsset.path)
      const asset: MediaAsset = { id: makeId(), kind: 'full', ...file, derivedFrom: backgroundAsset.id, derivedKind: 'video-audio', processing: 'ready' }
      const assets = [...project.assets.filter((item) => item.kind !== 'full'), asset]
      dispatch({ type: 'set-assets', assets })
      dispatch({ type: 'set-track-time-mapping', mapping: { ...pruneTrackMapping(currentProjectRef.current.trackTimeMapping, assets), playbackAssetId: asset.id } })
      setActiveKind('full')
      setAudioError('')
      notify('Đã trích audio từ video thành track riêng.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không trích được audio từ video.')
    }
  }

  async function prepareCompatibleVideoPreview(message: string) {
    const source = backgroundAsset
    const key = source ? `${source.id}:${source.path}` : ''
    if (!window.kara || !source?.path || !key || videoPreviewFallbackRef.current.has(key)) {
      setAudioError(message)
      return
    }
    videoPreviewFallbackRef.current.add(key)
    setAudioError('Đang tạo bản xem trước tương thích để phát video này…')
    try {
      const url = await window.kara.prepareVideoPreview(source.path)
      const current = currentProjectRef.current.assets.find((asset) => asset.kind === 'background')
      if (!current || `${current.id}:${current.path}` !== key) return
      setBackgroundUrl(url)
      setAudioError('')
      notify('Đã tạo bản xem trước tương thích; file gốc vẫn được dùng khi render.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Không tạo được bản xem trước tương thích.'
      setAudioError(`${message} ${detail}`)
    }
  }

  async function separateCurrentVocals() {
    if (!window.kara || !fullAsset || separationJobId) return
    const jobId = makeId()
    setSeparationJobId(jobId)
    try {
      const result = await window.kara.separateVocals(jobId, fullAsset.path, providerProfile.localPythonPath)
      const [vocalUrl, beatUrl] = await Promise.all([window.kara.getMediaUrl(result.vocalsPath), window.kara.getMediaUrl(result.instrumentalPath)])
      const vocal: MediaAsset = { id: makeId(), kind: 'vocal', path: result.vocalsPath, displayName: `${fullAsset.displayName} · vocal`, mimeType: 'audio/wav', url: vocalUrl, derivedFrom: fullAsset.id, derivedKind: 'separation-vocal', processing: 'ready' }
      const beat: MediaAsset = { id: makeId(), kind: 'beat', path: result.instrumentalPath, displayName: `${fullAsset.displayName} · instrumental`, mimeType: 'audio/wav', url: beatUrl, derivedFrom: fullAsset.id, derivedKind: 'separation-instrumental', processing: 'ready' }
      const assets = [...project.assets.filter((asset) => asset.kind !== 'vocal' && asset.kind !== 'beat'), vocal, beat]
      dispatch({ type: 'set-assets', assets })
      const currentMapping = currentProjectRef.current.trackTimeMapping
      dispatch({ type: 'set-track-time-mapping', mapping: {
        ...pruneTrackMapping(currentMapping, assets),
        analysisAssetId: vocal.id,
        renderAssetId: beat.id,
        playbackAssetId: currentMapping.playbackAssetId || beat.id,
      } })
      notify(result.cacheHit ? 'Đã nạp vocal/beat từ cache.' : 'Đã tách xong vocal và beat; vocal được chọn để phân tích, beat để render.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không tách được vocal.')
    } finally {
      setSeparationJobId('')
    }
  }

  async function importBrowserFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const lyricExtensions = ['txt', 'lrc', 'srt', 'ass', 'ssa']
    const videoExtensions = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v']
    const kind: MediaKind = lyricExtensions.includes(ext)
      ? 'lyrics'
      : browserImportKind === 'background' || videoExtensions.includes(ext)
        ? 'background'
        : browserImportKind === 'vocal'
          ? 'vocal'
          : browserImportKind === 'beat'
            ? 'beat'
            : 'full'
    const url = URL.createObjectURL(file)
    const priorAsset = project.assets.find((item) => item.kind === kind)
    const isRelink = priorAsset?.processing === 'error'
    const asset: MediaAsset = { id: isRelink ? priorAsset.id : makeId(), kind, path: file.name, displayName: file.name, mimeType: file.type, url, processing: kind === 'lyrics' ? undefined : 'ready' }
    if (isRelink) setAssetDurations((current) => { const next = { ...current }; delete next[asset.id]; return next })
    const assets = [...project.assets.filter((item) => item.kind !== kind), asset]
    dispatch({ type: 'set-assets', assets })
    if (kind === 'lyrics') {
      const text = await file.text()
      setLyricsRaw(text)
      const parsed = parseLyrics(text, file.name)
      dispatch({ type: 'set-segments', segments: lyricsToSegments(parsed) })
      notify(`${parsed.length} dòng lời đã nhập.`)
    } else if (kind === 'background') {
      setBackgroundUrl(url)
      videoPreviewFallbackRef.current.delete(`${asset.id}:${asset.path}`)
      notify('Video nền đã sẵn sàng.')
    } else {
      setActiveKind(kind)
      dispatch({ type: 'set-track-time-mapping', mapping: { ...pruneTrackMapping(currentProjectRef.current.trackTimeMapping, assets), playbackAssetId: asset.id } })
      setAudioError('')
      notify(`${kind === 'full' ? 'Bản đầy đủ' : 'Beat'} đã sẵn sàng.`)
    }
  }

  async function onBrowserFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) await importBrowserFile(file)
    event.target.value = ''
  }

  async function openProject() {
    try {
      const result = await window.kara?.openProject()
      if (!result) return
      const loaded = parseProjectJson(JSON.stringify(result.project))
      stopWordRecording(true)
      setCurrentPath(result.path)
      dispatch({ type: 'replace', project: loaded })
      setSelectedId(loaded.segments[0]?.id ?? '')
      setPosition(0)
      setDuration(Math.max(0, ...loaded.assets.map((asset) => finiteMediaDuration(asset.duration ?? 0) ?? 0)))
      setToast('Đã mở project.')
      const lyrics = loaded.assets.find((asset) => asset.kind === 'lyrics')
      let missingMedia = 0
      const unavailableAssetIds = new Set<string>()
      if (lyrics && window.kara) {
        try { setLyricsRaw(await window.kara.readTextFile(lyrics.path)) }
        catch { setLyricsRaw(''); missingMedia += 1; unavailableAssetIds.add(lyrics.id) }
      }
      const mappedPlayback = loaded.assets.find((asset) => asset.id === loaded.trackTimeMapping.playbackAssetId)
      const playable = mappedPlayback && ['full', 'beat', 'vocal'].includes(mappedPlayback.kind)
        ? mappedPlayback
        : loaded.assets.find((asset) => asset.kind === 'full') ?? loaded.assets.find((asset) => asset.kind === 'beat') ?? loaded.assets.find((asset) => asset.kind === 'vocal')
      const background = loaded.assets.find((asset) => asset.kind === 'background')
      if (window.kara) {
        const separationCache = new Map<string, Promise<{ vocalsPath: string; instrumentalPath: string; vocalsUrl: string; instrumentalUrl: string; cacheHit: boolean }>>()
        const restoredAssets = await Promise.all(loaded.assets.map(async (asset) => {
          if (asset.kind === 'lyrics') return unavailableAssetIds.has(asset.id) ? { ...asset, processing: 'error' as const } : asset
          if (asset.derivedFrom) {
            const source = loaded.assets.find((candidate) => candidate.id === asset.derivedFrom)
            if (source) {
              try {
                if (asset.derivedKind === 'separation-vocal' || asset.derivedKind === 'separation-instrumental') {
                  let separation = separationCache.get(source.id)
                  if (!separation) {
                    separation = window.kara!.separateVocals(makeId(), source.path, loaded.provider.localPythonPath)
                    separationCache.set(source.id, separation)
                  }
                  const stems = await separation
                  const stemPath = asset.derivedKind === 'separation-vocal' ? stems.vocalsPath : stems.instrumentalPath
                  return { ...asset, path: stemPath, url: await window.kara!.getMediaUrl(stemPath), processing: 'ready' as const }
                }
                const regenerated = await window.kara!.extractVideoAudio(source.path)
                return { ...asset, ...regenerated, id: asset.id, kind: asset.kind, derivedFrom: asset.derivedFrom, derivedKind: asset.derivedKind ?? 'video-audio', processing: 'ready' as const }
              } catch { missingMedia += 1; return { ...asset, url: undefined, processing: 'error' as const } }
            }
          }
          try { return { ...asset, url: await window.kara!.getMediaUrl(asset.path), processing: 'ready' as const } }
          catch { missingMedia += 1; return { ...asset, url: undefined, processing: 'error' as const } }
        }))
        dispatch({ type: 'set-assets', assets: restoredAssets })
        setBackgroundUrl(restoredAssets.find((asset) => asset.kind === 'background')?.url)
        if (playable) setActiveKind(playable.kind === 'beat' ? 'beat' : playable.kind === 'vocal' ? 'vocal' : 'full')
      }
      if (missingMedia) notify(`Đã mở project; ${missingMedia} nguồn media cần nối lại.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thể mở project.')
    }
  }

  async function restoreRecoveryProject() {
    if (!recoveryCandidate || recoveryBusy) return
    setRecoveryBusy(true)
    try {
      const separationCache = new Map<string, Promise<{ vocalsPath: string; instrumentalPath: string; vocalsUrl: string; instrumentalUrl: string; cacheHit: boolean }>>()
      const assets = await Promise.all(recoveryCandidate.assets.map(async (asset) => {
        if (asset.kind === 'lyrics') {
          if (!window.kara) return { ...asset, processing: 'error' as const }
          try {
            await window.kara.readTextFile(asset.path)
            return { ...asset, processing: undefined }
          } catch {
            return { ...asset, processing: 'error' as const }
          }
        }
        if (!window.kara) return { ...asset, url: undefined, processing: 'error' as const }
        if (asset.derivedFrom) {
          const source = recoveryCandidate.assets.find((candidate) => candidate.id === asset.derivedFrom)
          if (source) {
            try {
              if (asset.derivedKind === 'separation-vocal' || asset.derivedKind === 'separation-instrumental') {
                let separation = separationCache.get(source.id)
                if (!separation) {
                  separation = window.kara.separateVocals(makeId(), source.path, recoveryCandidate.provider.localPythonPath)
                  separationCache.set(source.id, separation)
                }
                const stems = await separation
                const stemPath = asset.derivedKind === 'separation-vocal' ? stems.vocalsPath : stems.instrumentalPath
                return { ...asset, path: stemPath, url: await window.kara.getMediaUrl(stemPath), processing: 'ready' as const }
              }
              const extracted = await window.kara.extractVideoAudio(source.path)
              return { ...asset, ...extracted, id: asset.id, kind: asset.kind, derivedFrom: asset.derivedFrom, derivedKind: asset.derivedKind ?? 'video-audio', processing: 'ready' as const }
            } catch { return { ...asset, url: undefined, processing: 'error' as const } }
          }
        }
        try { return { ...asset, url: await window.kara.getMediaUrl(asset.path), processing: 'ready' as const } }
        catch { return { ...asset, url: undefined, processing: 'error' as const } }
      }))
      const restored = { ...recoveryCandidate, assets }
      stopWordRecording(true)
      dispatch({ type: 'replace', project: restored })
      setCurrentPath(undefined)
      setSelectedId(restored.segments[0]?.id ?? '')
      setPosition(0)
      setDuration(Math.max(0, ...restored.assets.map((asset) => finiteMediaDuration(asset.duration ?? 0) ?? 0)))
      const lyrics = restored.assets.find((asset) => asset.kind === 'lyrics')
      if (lyrics && window.kara) {
        try { setLyricsRaw(await window.kara.readTextFile(lyrics.path)) }
        catch { setLyricsRaw(''); notify('Đã khôi phục project; cần nối lại file lời.') }
      }
      setBackgroundUrl(restored.assets.find((asset) => asset.kind === 'background')?.url)
      const mappedPlayback = restored.assets.find((asset) => asset.id === restored.trackTimeMapping.playbackAssetId)
      const playable = mappedPlayback && ['full', 'beat', 'vocal'].includes(mappedPlayback.kind)
        ? mappedPlayback
        : restored.assets.find((asset) => asset.kind === 'full') ?? restored.assets.find((asset) => asset.kind === 'beat') ?? restored.assets.find((asset) => asset.kind === 'vocal')
      if (playable) setActiveKind(playable.kind === 'full' || playable.kind === 'beat' || playable.kind === 'vocal' ? playable.kind : 'full')
      setRecoveryCandidate(null)
      const missingCount = restored.assets.filter((asset) => asset.processing === 'error' || (asset.kind !== 'lyrics' && !asset.url)).length
      notify(missingCount ? `Đã khôi phục bản tự lưu; ${missingCount} nguồn cần nối lại.` : 'Đã khôi phục bản tự lưu.')
    } catch {
      notify('Không thể khôi phục project.')
    } finally {
      setRecoveryBusy(false)
    }
  }

  async function dismissRecoveryProject() {
    if (recoveryBusy) return
    setRecoveryBusy(true)
    try {
      if (window.kara) await window.kara.clearRecoveryProject()
      else window.localStorage.removeItem('kara-last-project')
      setRecoveryCandidate(null)
    } catch {
      notify('Không thể xóa bản tự khôi phục cũ.')
    } finally {
      setRecoveryBusy(false)
    }
  }

  async function saveProject() {
    try {
      if (window.kara) {
        const result = await window.kara.saveProject(project, currentPath)
        if (result) {
          setCurrentPath(result.path)
          notify('Project đã lưu.')
        }
      } else {
        const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `${project.title || 'kara-project'}.kara.json`
        link.click()
        URL.revokeObjectURL(link.href)
        notify('Đã tải project JSON xuống.')
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thể lưu project.')
    }
  }

  function togglePlay() {
    const media = activeAsset?.url ? audioRef.current : videoProvidesAudio ? videoAudioRef.current : null
    if (!media) {
      notify('Nhập bản đầy đủ, beat hoặc video có audio để phát.')
      return
    }
    if (playing) {
      media.pause()
      setPlaying(false)
    } else {
      void media.play().then(() => setPlaying(true)).catch(() => setAudioError('Trình duyệt không thể phát định dạng media này.'))
    }
  }

  function toggleSelectedLoop() {
    if (!selected) return
    if (loopSegmentId === selected.id) {
      setLoopSegmentId('')
      return
    }
    setLoopSegmentId(selected.id)
    seekTo(selected.start)
    if (!playing) togglePlay()
  }

  function jumpToReview(segment: LyricSegment) {
    setSelectedId(segment.id)
    setReviewQueueOpen(true)
    seekTo(segment.start)
    setLoopSegmentId(segment.id)
    setSlowPlayback(true)
  }

  function confirmSegmentReview(segment: LyricSegment) {
    dispatch({ type: 'update-segment', id: segment.id, patch: acknowledgeSegment(segment, reviewedAudioIds.includes(segment.id)) })
    setReviewedAudioIds((ids) => ids.filter((id) => id !== segment.id))
    const next = sortedSegments.find((item) => item.id !== segment.id && item.needsReview)
    if (next) jumpToReview(next)
    else {
      setLoopSegmentId('')
      setSlowPlayback(false)
    }
  }

  function playReviewSegment(segment: LyricSegment) {
    if (selected?.id !== segment.id || loopSegmentId !== segment.id) jumpToReview(segment)
    else seekTo(segment.start)
    const media = activeMedia()
    if (media?.paused) togglePlay()
  }

  function reviewReasonLabel(segment: LyricSegment) {
    if (segment.reviewStatus === 'listened' && segment.reviewReason === 'reviewed') return 'Đã nghe · timing vẫn là ASR/ước lượng'
    if (segment.reviewStatus === 'explicitly-accepted') return 'Chấp nhận nháp · timing chưa kiểm chứng'
    if (segment.reviewStatus === 'edited') return 'Timing đã sửa · cần nghe lại'
    switch (segment.reviewReason) {
      case 'estimated-timing': return 'Timing ước lượng · cần căn theo giọng'
      case 'recognition-timing': return 'Timestamp nhận dạng · cần nghe xác nhận'
      case 'low-text-match': return 'Lời không khớp rõ với nhận dạng'
      case 'empty-timing': return 'Thiếu timing từ'
      case 'manual-edit': return 'Timing vừa chỉnh · cần nghe lại'
      case 'reviewed': return 'Đã nghe xác nhận'
      default: return segment.needsReview ? 'Cần nghe xác nhận' : 'Đã nghe xác nhận'
    }
  }

  function navigateWorkflowStep(step: 'ingest' | 'recognize' | 'sync' | 'preview' | 'export') {
    setWorkflowStep(step)
    if (step === 'export') {
      updateExportPreview()
      setModal('export')
      return
    }
    if (step === 'ingest') {
      sourceRailRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      editorColumnRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const target = step === 'recognize'
      ? recognitionActionRef.current
      : step === 'sync'
        ? syncSectionRef.current
        : previewSectionRef.current
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (step === 'recognize') recognitionActionRef.current?.focus({ preventScroll: true })
  }

  function seekTo(value: number) {
    if (wordRecordingRef.current) {
      notify('Đang căn từ: hãy bấm từ kế tiếp, không tua beat.')
      return
    }
    const safe = Math.max(0, Math.min(maxTime, value))
    setPosition(safe)
    const playbackAsset = activeAsset ?? (videoProvidesAudio ? backgroundAsset : undefined)
    const target = timelineToAssetTime(safe, project.trackTimeMapping, playbackAsset?.id)
    if (audioRef.current && activeAsset) audioRef.current.currentTime = Math.max(0, target)
    if (videoAudioRef.current && videoProvidesAudio) videoAudioRef.current.currentTime = Math.max(0, target)
  }

  function addTimeAnchor() {
    if (!selectedMappingAsset) return
    const sourceTime = Number(mappingSourceTime)
    const timelineTime = Number(mappingTimelineTime)
    if (!Number.isFinite(sourceTime) || !Number.isFinite(timelineTime) || sourceTime < 0 || timelineTime < 0) {
      notify('Thời gian phải là số giây không âm.')
      return
    }
    const assetMapping = project.trackTimeMapping.assetMappings.find((item) => item.assetId === selectedMappingAsset.id)
    const anchors = [...(assetMapping?.anchors ?? []), { sourceTime, timelineTime }].sort((a, b) => a.sourceTime - b.sourceTime)
    if (anchors.some((anchor, index) => index > 0 && (anchor.sourceTime <= anchors[index - 1].sourceTime || anchor.timelineTime <= anchors[index - 1].timelineTime))) {
      notify('Mốc thời gian phải tăng dần ở cả hai track và không được trùng.')
      return
    }
    const assetMappings = [...project.trackTimeMapping.assetMappings.filter((item) => item.assetId !== selectedMappingAsset.id), { assetId: selectedMappingAsset.id, anchors }]
    dispatch({ type: 'set-track-time-mapping', mapping: { ...project.trackTimeMapping, assetMappings } })
    setMappingSourceTime('0')
    setMappingTimelineTime('0')
  }

  async function estimateSelectedTrackOffset() {
    const referenceAsset = activeAsset ?? fullAsset ?? beatAsset ?? vocalAsset
    const candidateAsset = selectedMappingAsset
    if (!referenceAsset?.url || !candidateAsset?.url || referenceAsset.id === candidateAsset.id) {
      notify('Chọn một track chuẩn khác với track cần căn.')
      return
    }
    setSyncBusy(true)
    setSyncEstimate(null)
    try {
      const [referenceResponse, candidateResponse] = await Promise.all([
        fetch(referenceAsset.url), fetch(candidateAsset.url),
      ])
      if (!referenceResponse.ok || !candidateResponse.ok) throw new Error('Không đọc được một trong hai track.')
      const [referenceBytes, candidateBytes] = await Promise.all([referenceResponse.arrayBuffer(), candidateResponse.arrayBuffer()])
      const context = new AudioContext()
      try {
        const [reference, candidate] = await Promise.all([context.decodeAudioData(referenceBytes), context.decodeAudioData(candidateBytes)])
        const estimate = estimateTrackOffset(reference, candidate)
        if (!estimate || estimate.confidence < 0.7 || estimate.comparedSeconds < 2) {
          setSyncEstimate(estimate ?? { offset: 0, confidence: 0, comparedSeconds: 0 })
          return
        }
        setSyncEstimate(estimate)
      } finally {
        await context.close()
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thể phân tích hai track.')
    } finally {
      setSyncBusy(false)
    }
  }

  function applySyncEstimate() {
    if (!selectedMappingAsset || !syncEstimate || syncEstimate.confidence < 0.7) return
    const anchors = syncEstimate.anchors ?? [offsetToAnchor(syncEstimate.offset)]
    const assetMappings = [...project.trackTimeMapping.assetMappings.filter((item) => item.assetId !== selectedMappingAsset.id), { assetId: selectedMappingAsset.id, anchors }]
    dispatch({ type: 'set-track-time-mapping', mapping: { ...project.trackTimeMapping, assetMappings } })
    setMappingSourceTime(String(anchors.at(-1)!.sourceTime.toFixed(2)))
    setMappingTimelineTime(String(anchors.at(-1)!.timelineTime.toFixed(2)))
    notify(syncEstimate.driftPercent === undefined
      ? `Đã căn track với độ lệch ${syncEstimate.offset >= 0 ? '+' : ''}${syncEstimate.offset.toFixed(2)} giây.`
      : `Đã căn ${anchors.length} mốc; bù lệch tốc độ ${syncEstimate.driftPercent.toFixed(2)}%.`)
  }

  function removeTimeAnchor(index: number) {
    if (!selectedMappingAsset) return
    const assetMappings = project.trackTimeMapping.assetMappings.map((item) => item.assetId === selectedMappingAsset.id
      ? { ...item, anchors: item.anchors.filter((_, anchorIndex) => anchorIndex !== index) }
      : item).filter((item) => item.assetId !== selectedMappingAsset.id || item.anchors.length)
    dispatch({ type: 'set-track-time-mapping', mapping: { ...project.trackTimeMapping, assetMappings } })
  }

  function setMappingRole(role: 'analysisAssetId' | 'playbackAssetId' | 'renderAssetId', assetId: string) {
    dispatch({ type: 'set-track-time-mapping', mapping: { ...project.trackTimeMapping, [role]: assetId || undefined } })
    if (role === 'playbackAssetId' && assetId) {
      const asset = project.assets.find((item) => item.id === assetId)
      if (asset && asset.kind !== 'background' && asset.kind !== 'lyrics') setActiveKind(asset.kind as 'full' | 'beat' | 'vocal')
    }
  }

  function changeSegment(id: string, patch: Partial<LyricSegment>) {
    const segment = project.segments.find((item) => item.id === id)
    if (!segment) return
    if (patch.start !== undefined || patch.end !== undefined) {
      if (segment.timingLocked) return notify('Timing dòng này đang khóa. Hãy mở khóa trước khi sửa.')
      const start = Math.max(0, patch.start ?? segment.start)
      const end = Math.max(start + 0.05, patch.end ?? segment.end)
      const resized = resizeSegment(segment, start, end)
      dispatch({ type: 'update-segment', id, patch: { ...patch, start: resized.start, end: resized.end, words: resized.words.map((word) => ({ ...word, origin: 'manual' })), origin: 'manual', ...editReviewState() } })
      return
    }
    if (patch.text !== undefined && patch.text !== segment.text) {
      dispatch({ type: 'update-segment', id, patch: { ...patch, words: [], ...editReviewState('empty-timing') } })
      return
    }
    dispatch({ type: 'update-segment', id, patch })
  }

  async function realignSelectedSegment() {
    if (!selected || !analysisSnapshot || !recentTranscriptMatches || busy || realignmentBusy) return
    if (selected.timingLocked) return notify('Dòng này đang khóa timing. Hãy mở khóa trước khi căn lại.')
    const projectId = project.projectId
    const revision = project.revision
    const segmentId = selected.id
    setRealignmentBusy(true)
    try {
      let transcript = analysisSnapshot.transcript
      if (analysisSnapshot.sourceAssetId) {
        if (!analysisSnapshot.sourcePath || !analysisSnapshot.sourceFingerprint || !analysisSnapshot.sourceSignature || !window.kara) {
          return notify('Transcript này thiếu fingerprint audio. Hãy chạy nhận dạng lại để xác minh nguồn.')
        }
        const signature = await window.kara.getMediaSignature(analysisSnapshot.sourcePath)
        const verificationKey = `${analysisSnapshot.sourceFingerprint}:${signature.size}:${signature.modifiedAtMs}`
        if (verifiedMediaRef.current.get(analysisSnapshot.sourcePath) !== verificationKey) {
          const fingerprint = await window.kara.getMediaFingerprint(analysisSnapshot.sourcePath)
          if (fingerprint !== analysisSnapshot.sourceFingerprint) return notify('Nội dung audio đã thay đổi kể từ lần nhận dạng. Hãy nhận dạng lại trước khi căn cục bộ.')
          verifiedMediaRef.current.set(analysisSnapshot.sourcePath, verificationKey)
        }
        if (!transcript && analysisSnapshot.transcriptCacheKey) {
          const cached = await window.kara.loadCachedTranscript(analysisSnapshot.transcriptCacheKey)
          if (!cached) return notify('Transcript đã hết cache trên máy này. Hãy chạy nhận dạng lại để căn cục bộ.')
          transcript = mapTranscriptToTimeline(cached, {
            assetMappings: [{ assetId: analysisSnapshot.sourceAssetId, anchors: analysisSnapshot.sourceTimeAnchors ?? [] }],
          }, analysisSnapshot.sourceAssetId)
        }
      }
      if (!transcript) return notify('Không tìm thấy dữ liệu transcript để căn lại.')
      const current = currentProjectRef.current
      if (current.projectId !== projectId || current.revision !== revision || current.analysisSnapshot !== analysisSnapshot) {
        return notify('Project đã thay đổi trong lúc kiểm tra audio. Chọn lại dòng rồi thử lại.')
      }
      const currentSegment = current.segments.find((item) => item.id === segmentId)
      const preserved = currentSegment && realignSegmentFromTranscript(currentSegment, transcript)
      if (!preserved) return notify('Transcript gần nhất không có audio quanh dòng này. Hãy chạy nhận dạng lại.')
      dispatch({ type: 'update-segment', id: segmentId, patch: {
        start: preserved.start,
        end: preserved.end,
        words: preserved.words,
        confidence: preserved.confidence,
        needsReview: preserved.needsReview,
        origin: preserved.origin,
        providerSpeakerId: preserved.providerSpeakerId,
      } })
      notify(preserved.needsReview ? 'Đã căn lại bằng transcript đã lưu; hãy nghe để xác nhận.' : 'Đã căn lại dòng từ transcript đã lưu.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không kiểm tra được audio để căn lại.')
    } finally {
      setRealignmentBusy(false)
    }
  }

  function addSegment() {
    const start = selected?.end ?? position
    const segment: LyricSegment = { id: makeId(), text: 'Dòng lời mới', start, end: start + 2.5, speakerRole: 'unknown', words: [], needsReview: true, reviewReason: 'empty-timing', origin: 'manual' }
    const segments = [...project.segments, segment].sort((a, b) => a.start - b.start)
    dispatch({ type: 'set-segments', segments })
    setSelectedId(segment.id)
  }

  function splitSelected() {
    if (!selected) return
    if (selected.timingLocked) return notify('Hãy mở khóa timing trước khi tách dòng.')
    const words = selected.words
    let splitAt = (selected.start + selected.end) / 2
    if (words.length > 1) splitAt = words[Math.floor(words.length / 2)].start
    const parts = selected.text.trim().split(/\s+/)
    const midpoint = Math.max(1, Math.ceil(parts.length / 2))
    const first: LyricSegment = { ...selected, text: parts.slice(0, midpoint).join(' '), end: splitAt, words: words.filter((word) => word.end <= splitAt), ...editReviewState(), origin: 'manual' }
    const second: LyricSegment = { ...selected, id: makeId(), text: parts.slice(midpoint).join(' ') || parts.at(-1) || '', start: splitAt, words: words.filter((word) => word.start >= splitAt), ...editReviewState(), origin: 'manual' }
    dispatch({ type: 'set-segments', segments: [...project.segments.filter((item) => item.id !== selected.id), first, second].sort((a, b) => a.start - b.start) })
    setSelectedId(second.id)
  }

  function mergeSelected() {
    if (!selected) return
    const ordered = [...project.segments].sort((a, b) => a.start - b.start)
    const index = ordered.findIndex((item) => item.id === selected.id)
    const neighbor = ordered[index + 1] ?? ordered[index - 1]
    if (!neighbor) return notify('Cần thêm một dòng kế bên để gộp.')
    if (selected.timingLocked || neighbor.timingLocked) return notify('Hãy mở khóa timing của các dòng trước khi gộp.')
    const earlier = selected.start <= neighbor.start ? selected : neighbor
    const later = earlier.id === selected.id ? neighbor : selected
    const merged: LyricSegment = { ...earlier, text: `${earlier.text.trim()} ${later.text.trim()}`.trim(), start: Math.min(earlier.start, later.start), end: Math.max(earlier.end, later.end), words: [...earlier.words, ...later.words].sort((a, b) => a.start - b.start), ...editReviewState(), origin: 'manual' }
    dispatch({ type: 'set-segments', segments: [...project.segments.filter((item) => item.id !== earlier.id && item.id !== later.id), merged].sort((a, b) => a.start - b.start) })
    setSelectedId(merged.id)
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, segment: LyricSegment, edge: DragState['edge']) {
    event.preventDefault()
    event.stopPropagation()
    if (segment.timingLocked) return notify('Timing dòng này đang khóa. Hãy mở khóa trước khi kéo.')
    setDrag({ id: segment.id, edge, startX: event.clientX, originalStart: segment.start, originalEnd: segment.end })
  }

  async function importProviderSettings() {
    if (!window.kara) return
    try {
      const loaded = await window.kara.loadProviderSettings()
      setProviderProfile(loaded.profile)
    } catch {
      notify('Không tải được cấu hình nhận dạng.')
    }
  }

  async function saveProviderSettings() {
    try {
      if (window.kara) await window.kara.saveProviderSettings(providerProfile)
      dispatch({ type: 'set-provider', provider: providerProfile })
      setModal(null)
      notify('Cấu hình nhận dạng đã lưu trên máy này.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thể lưu cấu hình nhận dạng.')
    }
  }

  async function checkLocalRuntime() {
    if (!window.kara) return
    setRuntimeCheck({ busy: true, message: 'Đang kiểm tra Python và runtime local…' })
    try {
      const report = await window.kara.checkLocalRuntime(providerProfile)
      const packages = [
        `Faster-Whisper ${report.fasterWhisper.version ?? (report.fasterWhisper.available ? 'đã cài' : 'chưa cài')}`,
        `PyAV ${report.av?.version ?? (report.av?.available ? 'đã cài' : 'chưa cài')}`,
        `CTranslate2 ${report.ctranslate2?.version ?? (report.ctranslate2?.available ? 'đã cài' : 'chưa cài')}`,
        `Stable-ts ${report.stableWhisper?.version ?? (report.stableWhisper?.available ? 'đã cài' : report.stableWhisper?.error ? 'thiếu dependency' : 'chưa cài')}`,
        `Demucs ${report.demucs?.available ? report.demucs.version ?? 'sẵn sàng' : report.demucs?.error ? `thiếu dependency (${report.demucs.error})` : 'chưa cài'}`,
        `CUDA ${report.cudaDeviceCount ? `sẵn sàng · ${report.cudaDeviceCount} thiết bị` : 'không khả dụng'}`,
      ]
      const alignmentReady = Boolean(report.stableWhisper?.available)
      const supported = report.manifest?.runtime?.python?.supported?.join('/') ?? '3.10/3.11/3.12'
      const pythonReady = report.pythonSupported ?? true
      const asrReady = report.runtimeReady ?? report.fasterWhisper.available
      const status = !pythonReady ? `Python ngoài dải hỗ trợ (${supported})` : !asrReady ? 'Thiếu Faster-Whisper hoặc runtime chưa sẵn sàng' : !alignmentReady ? `Thiếu Stable-ts${report.stableWhisper?.error ? `: ${report.stableWhisper.error}` : ''}` : 'Runtime sẵn sàng'
      const policy = report.manifest?.runtime?.packages?.['faster-whisper']?.versionPolicy === 'unverified' ? ' · phiên bản package chưa pin/xác minh' : ''
      const manifestStatus = report.manifestLoaded === false ? ' · thiếu runtime manifest' : ''
      setRuntimeCheck({ busy: false, ok: pythonReady && asrReady && alignmentReady && report.manifestLoaded !== false, message: `${status} · ${report.pythonExecutable ?? 'Python'} ${report.pythonVersion} · ${packages.join(' · ')}${policy}${manifestStatus}` })
    } catch (error) {
      setRuntimeCheck({ busy: false, ok: false, message: error instanceof Error ? error.message : 'Không kiểm tra được Python runtime.' })
    }
  }

  async function transcribe() {
    if (busy) return
    const jobId = makeId()
    const snapshot = captureRecognitionSnapshot(project, providerProfile, lyricsRaw)
    setBusy(true)
    setRecognitionJobId(jobId)
    try {
      setRecognitionProgress(0)
      let transcript: NormalizedTranscript
      const lyricsText = lyricsRaw ? parseLyrics(lyricsRaw, lyricsAsset?.displayName).map((line) => line.text).join('\n') : project.segments.map((segment) => segment.text).join('\n')
      if (providerProfile.kind === 'mock') {
        const mockLines = lyricsRaw ? parseLyrics(lyricsRaw, lyricsAsset?.displayName) : project.segments.map((segment) => ({ text: segment.text, start: segment.start, end: segment.end }))
        const words = mockLines.flatMap((line, index) => {
          const text = line.text.trim()
          if (!text) return []
          const start = line.start ?? index * 3.2
          const end = line.end ?? start + Math.max(2.2, text.split(/\s+/).length * 0.48)
          const tokens = text.split(/\s+/)
          const span = (end - start) / tokens.length
          return [{ id: makeId(), text, start, end, speakerId: index % 2 ? 'speaker_1' : 'speaker_0', confidence: 0.5, words: tokens.map((word, wordIndex) => ({ id: makeId(), text: word, start: start + wordIndex * span, end: start + (wordIndex + 1) * span, confidence: 0.5, origin: 'estimated' as const })) }]
        })
        transcript = { segments: words }
      } else {
        if (!window.kara) throw new Error('Whisper local chỉ chạy trong ứng dụng desktop.')
        const recognitionAsset = analysisAsset
        if (!recognitionAsset) throw new Error('Chưa có audio phân tích. Hãy nhập file ca sĩ hoặc vocal stem trước.')
        transcript = mapTranscriptToTimeline(await window.kara.transcribe(jobId, providerProfile, recognitionAsset.path, lyricsText), project.trackTimeMapping, recognitionAsset.id)
      }
      if (!isRecognitionSnapshotCurrent(snapshot, currentProjectRef.current, providerProfileRef.current, lyricsRawRef.current)) {
        notify('Project, lời hoặc cấu hình nhận dạng đã thay đổi trong lúc xử lý. Kết quả cũ đã được bỏ qua.')
        return
      }
      const lines = lyricsRaw ? parseLyrics(lyricsRaw, lyricsAsset?.displayName) : []
      const alignedSegments = lines.length && transcript.timingMethod !== 'direct-lyrics-alignment'
        ? alignTranscriptToLyrics(lines, transcript)
        : transcript.segments.map((segment) => ({
          ...segment,
          words: segment.words.map((word) => ({ ...word, origin: providerProfile.kind === 'mock' || word.origin === 'estimated' ? 'estimated' as const : transcript.timingMethod === 'direct-lyrics-alignment' && word.origin === 'aligned' ? 'aligned' as const : 'asr' as const })),
          speakerRole: 'unknown' as const,
          providerSpeakerId: segment.speakerId,
          needsReview: providerProfile.kind === 'mock' || segment.words.length === 0 || segment.words.some((word) => word.origin !== 'manual') || (segment.confidence ?? 1) < 0.68,
          reviewReason: segment.words.length === 0 ? 'empty-timing' as const : providerProfile.kind === 'mock' || segment.words.some((word) => word.origin === 'estimated') ? 'estimated-timing' as const : segment.words.some((word) => word.origin === 'asr' || word.origin === 'aligned') ? 'recognition-timing' as const : (segment.confidence ?? 1) < 0.68 ? 'low-text-match' as const : undefined,
          reviewStatus: providerProfile.kind === 'mock' ? 'pending' as const : undefined,
          origin: providerProfile.kind === 'mock' ? 'estimated' as const : transcript.timingMethod === 'direct-lyrics-alignment' && segment.words.length && segment.words.every((word) => word.origin === 'aligned') ? 'aligned' as const : 'asr' as const,
        }))
      const nextSegments = preserveLockedTimings(project.segments, alignedSegments)
      const transcriptSnapshot = providerProfile.kind === 'mock' || (transcript.audioFingerprint && transcript.audioSignature) ? {
        transcript: providerProfile.kind === 'mock' || !transcript.transcriptCacheKey ? transcript : undefined,
        transcriptCacheKey: transcript.transcriptCacheKey,
        sourceAssetId: providerProfile.kind === 'mock' ? undefined : analysisAsset?.id,
        sourcePath: providerProfile.kind === 'mock' ? undefined : analysisAsset?.path,
        sourceFingerprint: transcript.audioFingerprint,
        sourceSignature: transcript.audioSignature,
        sourceTimeAnchors: providerProfile.kind !== 'mock' && analysisAsset
          ? project.trackTimeMapping.assetMappings.find((item) => item.assetId === analysisAsset.id)?.anchors ?? []
          : undefined,
        mappingKey: JSON.stringify(project.trackTimeMapping),
        providerKind: providerProfile.kind,
        capturedAt: new Date().toISOString(),
      } : undefined
      setReviewedAudioIds([])
      dispatch({ type: 'set-analysis-result', segments: nextSegments, snapshot: transcriptSnapshot })
      setSelectedId(nextSegments[0]?.id ?? '')
      setWorkflowStep('sync')
      const engineDetail = transcript.timingMethod === 'direct-lyrics-alignment' ? ' · Căn trực tiếp lời theo audio' : ''
      const deviceDetail = transcript.deviceFallbackReason ? ` · đã chuyển sang CPU: ${transcript.deviceFallbackReason}` : ''
      const needsReviewCount = nextSegments.filter((segment) => segment.needsReview).length
      notify(`${nextSegments.length} dòng đã sẵn sàng · ${needsReviewCount} dòng cần nghe xác nhận${engineDetail}${deviceDetail}${transcript.cacheHit ? ' · dùng kết quả đã lưu cache' : ''}.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Nhận dạng không thành công.')
    } finally {
      setBusy(false)
      setRecognitionJobId('')
      setRecognitionProgress(0)
    }
  }

  async function cancelRecognition() {
    if (!recognitionJobId || !window.kara) return
    try {
      await window.kara.cancelTranscribe(recognitionJobId)
    } catch {
      notify('Không thể gửi yêu cầu hủy nhận dạng.')
    }
  }

  function updateExportPreview(format = exportFormat) {
    setExportFormat(format)
    setExportPreview(format === 'srt' ? buildSrt(sortedSegments, project.exportOptions) : buildAss(sortedSegments, project.exportOptions, videoSettings))
  }

  async function exportFile() {
    updateExportPreview(exportFormat)
    const content = exportFormat === 'srt' ? buildSrt(sortedSegments, project.exportOptions) : buildAss(sortedSegments, project.exportOptions, videoSettings)
    try {
      if (window.kara) {
        const result = await window.kara.saveExport(exportFormat, content, `${project.title || 'kara-lyrics'}.${exportFormat}`)
        if (result) {
          setModal(null)
          notify(`Đã xuất ${result.path.split(/[\\/]/).pop()}.`)
        }
      } else {
        const link = document.createElement('a')
        link.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
        link.download = `${project.title || 'kara-lyrics'}.${exportFormat}`
        link.click()
        URL.revokeObjectURL(link.href)
        setModal(null)
        notify(`Đã tải file ${exportFormat.toUpperCase()} xuống.`)
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thể xuất subtitle.')
    }
  }

  async function startRender() {
    if (renderState.status === 'running' || renderState.status === 'canceling') return
    if (!window.kara) {
      setModal('render')
      setRenderState({ jobId: '', status: 'error', percent: 0, message: '', error: 'Render MP4 chỉ khả dụng trong ứng dụng desktop.' })
      return
    }
    if (!renderAudioPath) {
      setModal('render')
      setRenderState({ jobId: '', status: 'error', percent: 0, message: '', error: 'Hãy nhập audio hoặc video có audio trước khi render.' })
      return
    }
    const jobId = `render-${makeId()}`
    const renderTimeAsset = renderAsset ?? (videoProvidesAudio ? backgroundAsset : undefined)
    const renderSegments = renderTimeAsset ? mapSegmentsToAssetTime(sortedSegments, project.trackTimeMapping, renderTimeAsset.id) : sortedSegments
    const renderDuration = Math.max(renderAudioDuration ?? 0, renderAsset && renderAsset.id === activeAsset?.id ? assetDurations[renderAsset.id] ?? 0 : 0, !renderAsset ? duration : 0, ...renderSegments.map((segment) => segment.end), 0)
    if (!renderDuration) {
      setModal('render')
      setRenderState({ jobId: '', status: 'error', percent: 0, message: '', error: 'Chưa xác định được thời lượng audio. Hãy phát audio hoặc thêm timing lời trước khi render.' })
      return
    }
    const request: RenderRequest = {
      jobId,
      audioPath: renderAudioPath ?? '',
      backgroundPath: backgroundAsset?.path,
      assContent: buildAss(renderSegments, project.exportOptions, videoSettings),
      duration: renderDuration,
      video: videoSettings,
    }
    cancelRenderRef.current = false
    setModal('render')
    setRenderState({ jobId, status: 'running', percent: 0, message: 'Đang chuẩn bị render…' })
    try {
      const result = await window.kara.startRender(request)
      if (!result) {
        setRenderState((current) => current.jobId === jobId ? { ...current, status: 'canceled', message: 'Đã hủy render.' } : current)
        return
      }
      const outputUrl = await window.kara.getMediaUrl(result.path)
      setRenderState((current) => current.jobId === jobId ? { ...current, status: 'done', percent: 100, message: 'Video đã render xong.', outputPath: result.path, outputUrl } : current)
    } catch (error) {
      setRenderState((current) => current.jobId === jobId
        ? { ...current, status: 'error', message: '', error: error instanceof Error ? error.message : 'Không thể render video.' }
        : current)
    }
  }

  async function cancelRender() {
    if (renderState.status !== 'running' || !renderState.jobId || !window.kara) return
    cancelRenderRef.current = true
    setRenderState((current) => ({ ...current, status: 'canceling', message: 'Đang hủy render…' }))
    try {
      await window.kara.cancelRender(renderState.jobId)
    } catch {
      notify('Không thể gửi yêu cầu hủy render.')
    }
  }

  function resetRender() {
    cancelRenderRef.current = false
    setRenderState({ jobId: '', status: 'idle', percent: 0, message: '' })
  }

  function activeMedia(): HTMLMediaElement | null {
    if (activeAsset?.url) return audioRef.current
    if (videoProvidesAudio) return videoAudioRef.current
    return null
  }

  function startWordRecording() {
    if (!selected) return
    if (selected.timingLocked) return notify('Timing dòng này đang khóa. Hãy mở khóa trước khi thu lại.')
    if (!beatAsset) return notify('Hãy nhập Beat trước khi thu timing.')
    prepareWordRecording(selected.id)
  }

  function prepareWordRecording(segmentId: string, attempt = 0, generation?: number) {
    const activeGeneration = generation ?? ++wordRecordingGenerationRef.current
    if (activeGeneration !== wordRecordingGenerationRef.current) return
    const currentProject = currentProjectRef.current
    const segment = currentProject.segments.find((item) => item.id === segmentId)
    if (!segment) return
    const beat = currentProject.assets.find((asset) => asset.kind === 'beat')
    if (!beat) return notify('Hãy nhập Beat trước khi thu timing.')
    dispatch({ type: 'set-track-time-mapping', mapping: { ...currentProject.trackTimeMapping, playbackAssetId: beat.id } })
    const beatMedia = audioRef.current
    if (!beatMedia || beatMedia.getAttribute('src') !== beat.url) {
      if (attempt >= 40) return notify('Không thể mở Beat để thu timing.')
      setActiveKind('beat')
      window.setTimeout(() => prepareWordRecording(segmentId, attempt + 1, activeGeneration), 50)
      return
    }
    if (Number.isFinite(beatMedia.duration) && segment.start >= beatMedia.duration) return notify('Dòng lời nằm sau thời lượng của Beat.')
    const session = createWordRecordingSession(segment)
    wordRecordingRef.current = session
    setWordRecording(session)
    setSpaceHeld(false)
    dispatch({ type: 'begin-transaction' })
    dispatch({ type: 'update-segment', id: session.segmentId, patch: { words: session.words, ...editReviewState() } })
    const startPlayback = () => {
      if (activeGeneration !== wordRecordingGenerationRef.current || currentProjectRef.current.projectId !== currentProject.projectId) return
      setPosition(segment.start)
      void beatMedia.play().then(() => setPlaying(true)).catch(() => notify('Không thể phát beat để căn từ.'))
    }
    const beatStart = timelineToAssetTime(segment.start, currentProject.trackTimeMapping, beat.id)
    if (Math.abs(beatMedia.currentTime - beatStart) < 0.02) startPlayback()
    else {
      let timeout = 0
      const cleanup = () => {
        window.clearTimeout(timeout)
        beatMedia.removeEventListener('seeked', onSeeked)
        if (wordRecordingSeekCleanupRef.current === cleanup) wordRecordingSeekCleanupRef.current = null
      }
      const onSeeked = () => {
        cleanup()
        if (activeGeneration !== wordRecordingGenerationRef.current || currentProjectRef.current.projectId !== currentProject.projectId) return
        startPlayback()
      }
      timeout = window.setTimeout(() => {
        cleanup()
        if (activeGeneration !== wordRecordingGenerationRef.current) return
        stopWordRecording(true)
        notify('Không thể tua chính xác đến đầu dòng.')
      }, 4000)
      wordRecordingSeekCleanupRef.current = cleanup
      beatMedia.addEventListener('seeked', onSeeked, { once: true })
      const target = Math.min(beatStart, Number.isFinite(beatMedia.duration) ? beatMedia.duration : beatStart)
      beatMedia.currentTime = target
    }
  }

  function stopWordRecording(discard = false) {
    wordRecordingGenerationRef.current += 1
    wordRecordingSeekCleanupRef.current?.()
    wordRecordingSeekCleanupRef.current = null
    let session = wordRecordingRef.current
    if (!session) return
    if (discard || (session.nextIndex === 0 && !session.spaceHeld)) {
      dispatch({ type: 'cancel-transaction' })
    } else {
      if (session.spaceHeld) {
        const media = activeMedia()
        const ended = endHeldWord(session, assetTimeToTimeline(media?.currentTime ?? session.segmentEnd, project.trackTimeMapping, activeAsset?.id ?? beatAsset?.id))
        if (ended) session = ended
      }
      if (session.nextIndex > 0) {
        dispatch({ type: 'update-segment', id: session.segmentId, patch: { words: finishWordRecording(session), needsReview: session.nextIndex < session.words.length, reviewReason: session.nextIndex < session.words.length ? 'empty-timing' : 'manual-edit', origin: 'manual' } })
      }
      dispatch({ type: 'end-transaction' })
    }
    wordRecordingRef.current = null
    setWordRecording(null)
    setSpaceHeld(false)
  }

  function beginHeldWordAtCurrentTime() {
    const session = wordRecordingRef.current
    const media = activeMedia()
    if (!session || !media || media.paused || session.spaceHeld) return
    const next = beginHeldWord(session, assetTimeToTimeline(media.currentTime, project.trackTimeMapping, activeAsset?.id ?? beatAsset?.id))
    if (!next) return notify('Không thể bắt đầu từ tại mốc này.')
    wordRecordingRef.current = next
    setWordRecording(next)
    setSpaceHeld(true)
    dispatch({ type: 'update-segment', id: next.segmentId, patch: { words: next.words, ...editReviewState() } })
  }

  function startNextWordRecording() {
    if (!selected) return
    const currentIndex = sortedSegments.findIndex((segment) => segment.id === selected.id)
    const nextSegment = sortedSegments[currentIndex + 1]
    if (!nextSegment) {
      stopWordRecording()
      return
    }
    stopWordRecording()
    setSelectedId(nextSegment.id)
    window.setTimeout(() => prepareWordRecording(nextSegment.id), 0)
  }

  function endHeldWordAtCurrentTime() {
    const session = wordRecordingRef.current
    const media = activeMedia()
    if (!session || !media || !session.spaceHeld) return
    const next = endHeldWord(session, assetTimeToTimeline(media.currentTime, project.trackTimeMapping, activeAsset?.id ?? beatAsset?.id))
    if (!next) return
    wordRecordingRef.current = next
    setWordRecording(next)
    setSpaceHeld(false)
    dispatch({ type: 'update-segment', id: next.segmentId, patch: { words: next.words, needsReview: next.nextIndex < next.words.length, reviewReason: next.nextIndex < next.words.length ? 'empty-timing' : 'manual-edit', origin: 'manual' } })
    if (next.nextIndex >= next.words.length) startNextWordRecording()
  }

  function setLyricPosition(nextPosition: NormalizedPosition) {
    dispatch({ type: 'set-video-settings', settings: { lyricPosition: nextPosition } })
  }
  function updateTimeField(id: string, key: 'start' | 'end', text: string) {
    const parsed = parseTimecode(text)
    if (parsed !== null) changeSegment(id, key === 'start'
      ? { start: Math.min(parsed, selected?.end ? selected.end - 0.05 : parsed) }
      : { end: Math.max(parsed, selected?.start ? selected.start + 0.05 : parsed) })
  }

  function handleGlobalKeys(event: React.KeyboardEvent) {
    const target = event.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
    if (event.code === 'Space') {
      event.preventDefault()
      if (wordRecordingRef.current) return
      togglePlay()
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void saveProject()
    }
    if (!wordRecordingRef.current && event.key === 'ArrowLeft') seekTo(position - (event.shiftKey ? 1 : 0.1))
    if (!wordRecordingRef.current && event.key === 'ArrowRight') seekTo(position + (event.shiftKey ? 1 : 0.1))
  }

  const rulerStyle = (segment: LyricSegment): CSSProperties => ({
    left: `${segment.start / maxTime * 100}%`,
    width: `${Math.max(0.8, (segment.end - segment.start) / maxTime * 100)}%`,
    '--speaker-color': SPEAKER_COLORS[segment.speakerRole],
  } as CSSProperties)

  const nextReviewSegment = sortedSegments.find((segment) => segment.needsReview)
  const guidedStep = !fullAsset && !beatAsset && !vocalAsset && !backgroundAsset
    ? { title: 'Bắt đầu bằng audio hoặc video', detail: 'Nạp nhạc trước; video có thể trích thành audio để phát, nhận dạng và render.', label: 'Nhập audio', run: () => void loadMedia('full'), secondaryLabel: 'Nhập video', secondary: () => void loadMedia('background') }
    : !analysisAsset && backgroundAsset
      ? { title: 'Lấy audio từ video', detail: 'Tạo WAV từ track audio trong video để tiếp tục nhận dạng và căn lời.', label: 'Trích audio', run: () => void extractVideoAudio() }
      : providerProfile.kind === 'mock' && !lyricsRaw && !project.segments.length
        ? { title: 'Thêm lời để tạo timing mẫu', detail: 'Demo offline chỉ dựng timing từ lời đã nhập; Whisper local có thể nhận dạng lời từ audio.', label: 'Nhập lời', run: () => void loadMedia('lyrics') }
        : providerProfile.kind === 'local' && runtimeCheck.message && runtimeCheck.ok === false
          ? { title: 'Kiểm tra cấu hình Whisper', detail: 'Runtime chưa sẵn sàng. Chọn Python 3.10–3.12 và cài Faster-Whisper trong runtime đó.', label: 'Mở cấu hình', run: () => { void importProviderSettings(); setModal('provider') } }
          : !recentTranscriptMatches
            ? { title: 'Tạo lời và timing tự động', detail: 'Whisper chạy trên máy. Kết quả sẽ được căn theo lời nhập nếu có, rồi đưa các dòng thiếu chắc chắn vào hàng rà.', label: providerProfile.kind === 'mock' ? 'Tạo timing demo' : 'Nhận dạng local', run: () => { setWorkflowStep('recognize'); void transcribe() } }
            : nextReviewSegment
              ? { title: 'Rà các dòng chưa chắc chắn', detail: 'Nhảy tới dòng đầu tiên cần nghe lại để chỉnh lời hoặc timing trước khi preview.', label: 'Rà dòng tiếp theo', run: () => jumpToReview(nextReviewSegment) }
              : { title: 'Xem trước và xuất karaoke', detail: 'Timing đã sẵn sàng. Kiểm tra vị trí chữ, kích thước preview và khung hình đầu ra.', label: 'Mở preview', run: () => setWorkflowStep('preview') }

  return (
    <div className="app-shell" onKeyDown={handleGlobalKeys}>
      <header className="topbar">
        <div className="brand-mark" aria-label="Kara Studio"><span className="brand-glyph">K</span><span>KARA<span className="brand-light">STUDIO</span></span></div>
        <div className="project-name-wrap">
          <span className="project-file-dot" />
          <input className="project-title" aria-label="Tên project" value={project.title} onChange={(event) => dispatch({ type: 'set-title', title: event.target.value })} />
          <span className="topbar-divider" />
          <span className="save-state">{currentPath ? 'Đã lưu' : 'Bản nháp'}</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="Mở project" onClick={() => void openProject()}><Icon name="folder" /></button>
          <button className="icon-button" title="Hoàn tác (Ctrl+Z)" disabled={Boolean(history.transactionBase) || !history.past.length} onClick={() => dispatch({ type: 'undo' })}><Icon name="undo" /></button>
          <button className="icon-button" title="Làm lại (Ctrl+Shift+Z)" disabled={Boolean(history.transactionBase) || !history.future.length} onClick={() => dispatch({ type: 'redo' })}><Icon name="redo" /></button>
          <span className="topbar-divider" />
          <button className="button button-quiet" onClick={() => { void importProviderSettings(); setModal('provider') }}><Icon name="settings" size={16} /><span>Nhận dạng</span></button>
          <button className="button button-quiet" onClick={() => void saveProject()}><Icon name="save" size={16} /><span>Lưu</span></button>
              <button className="button button-quiet render-launch" onClick={() => { setWorkflowStep('preview'); setModal('render') }} disabled={renderState.status === 'running' || renderState.status === 'canceling'} title="Render video từ timing hiện tại"><Icon name="video" size={16} /><span>Render video</span></button>
          <button className="button button-accent" onClick={() => navigateWorkflowStep('export')}><Icon name="export" size={16} /><span>Xuất lời</span></button>
        </div>
      </header>

      <main className={`workspace ${inspectorOpen ? '' : 'inspector-hidden'}`} style={{ '--source-rail-width': `${workspaceWidths.source}px`, '--inspector-width': `${workspaceWidths.inspector}px` } as CSSProperties}>
        <aside className="source-rail" ref={sourceRailRef}>
          <div className="rail-heading"><span>NGUỒN</span><button className="tiny-icon" aria-label="Thêm nguồn" onClick={() => void loadMedia('full')}><Icon name="plus" size={15} /></button></div>
          <div className="source-group-label">ÂM THANH</div>
            <SourceCard kind="full" asset={fullAsset} active={activeAsset?.id === fullAsset?.id} onSelect={() => { if (wordRecordingRef.current) stopWordRecording(); setActiveKind('full'); setMappingRole('playbackAssetId', fullAsset?.id ?? ''); if (fullAsset) setAudioError('') }} onAdd={() => void loadMedia('full')} />
              <SourceCard kind="vocal" asset={vocalAsset} active={activeAsset?.id === vocalAsset?.id} onSelect={() => { if (wordRecordingRef.current) stopWordRecording(); setActiveKind('vocal'); setMappingRole('playbackAssetId', vocalAsset?.id ?? ''); if (vocalAsset) setAudioError('') }} onAdd={() => void loadMedia('vocal')} />
              <SourceCard kind="beat" asset={beatAsset} active={activeAsset?.id === beatAsset?.id} onSelect={() => { if (wordRecordingRef.current) stopWordRecording(); setActiveKind('beat'); setMappingRole('playbackAssetId', beatAsset?.id ?? ''); if (beatAsset) setAudioError('') }} onAdd={() => void loadMedia('beat')} />
          {fullAsset && (!separationJobId
            ? <button className="button button-small button-quiet extract-video-audio" onClick={() => void separateCurrentVocals()} disabled={!window.kara} title={!window.kara ? 'Tách stem cần ứng dụng desktop và Demucs local' : 'Tách bản đầy đủ thành vocal và instrumental'}><Icon name="wave" size={14} />Tách vocal + beat</button>
            : <button className="button button-small button-danger extract-video-audio" onClick={() => void window.kara?.cancelSeparation(separationJobId)}><Icon name="close" size={14} />Đang tách · Hủy</button>)}
          {mappableAssets.length > 1 && <details className="track-mapping-panel">
            <summary className="source-group-label">ĐỒNG BỘ TRACK · {mappableAssets.length}</summary>
            <label><span>Phân tích</span><select value={analysisAsset?.id ?? ''} onChange={(event) => setMappingRole('analysisAssetId', event.target.value)}><option value="">Tự chọn theo AI</option>{mappableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}</select></label>
            <label><span>Phát</span><select value={activeAsset?.id ?? ''} onChange={(event) => setMappingRole('playbackAssetId', event.target.value)}>{mappableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}</select></label>
            <label><span>Render</span><select value={renderAsset?.id ?? ''} onChange={(event) => setMappingRole('renderAssetId', event.target.value)}>{mappableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}</select></label>
            <label><span>Căn track</span><select value={selectedMappingAsset?.id ?? ''} onChange={(event) => setMappingAssetId(event.target.value)}>{mappableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}</select></label>
            <button className="button button-quiet button-small" onClick={() => void estimateSelectedTrackOffset()} disabled={syncBusy || !activeAsset || !selectedMappingAsset || activeAsset.id === selectedMappingAsset.id}>{syncBusy ? 'Đang phân tích…' : 'Tự căn theo track đang nghe'}</button>
            {syncEstimate && <div className={`sync-estimate ${syncEstimate.confidence < 0.7 || syncEstimate.comparedSeconds < 2 ? 'is-uncertain' : ''}`}>
              <span>{syncEstimate.confidence >= 0.7 && syncEstimate.comparedSeconds >= 2 ? 'Ước lượng lệch' : 'Tương quan chưa đủ chắc'}: {syncEstimate.offset >= 0 ? '+' : ''}{syncEstimate.offset.toFixed(2)} giây{syncEstimate.driftPercent === undefined ? '' : ` · bù tốc độ ${syncEstimate.driftPercent.toFixed(2)}%` } · mức khớp {Math.round(syncEstimate.confidence * 100)}%</span>
              {syncEstimate.confidence >= 0.7 && syncEstimate.comparedSeconds >= 2 && <button className="button button-small button-accent" onClick={applySyncEstimate}>Áp dụng</button>}
            </div>}
            <div className="mapping-times"><label><span>Giây nguồn</span><input type="number" min="0" step="0.01" value={mappingSourceTime} onChange={(event) => setMappingSourceTime(event.target.value)} /></label><label><span>Giây timeline</span><input type="number" min="0" step="0.01" value={mappingTimelineTime} onChange={(event) => setMappingTimelineTime(event.target.value)} /></label></div>
            <button className="button button-quiet button-small" onClick={addTimeAnchor}>Thêm mốc đồng bộ</button>
            <small className="mapping-hint">Ghép cùng một khoảnh khắc của hai track. Hai mốc trở lên cũng bù được lệch tốc độ.</small>
            {(project.trackTimeMapping.assetMappings.find((item) => item.assetId === selectedMappingAsset?.id)?.anchors ?? []).map((anchor, index) => <div className="mapping-anchor" key={`${anchor.sourceTime}-${anchor.timelineTime}`}><span>{formatClock(anchor.sourceTime)} → {formatClock(anchor.timelineTime)}</span><button className="tiny-icon" title="Xóa mốc" onClick={() => removeTimeAnchor(index)}><Icon name="close" size={14} /></button></div>)}
          </details>}
          <div className="source-group-label video-label">HÌNH NỀN</div>
          <button className={`lyrics-source background-source ${backgroundAsset ? 'has-file' : ''} ${backgroundAsset?.processing === 'error' ? 'needs-relink' : ''}`} onClick={() => void loadMedia('background')}>
            <span className="source-icon background-icon"><Icon name="video" /></span>
            <span className="source-info"><strong>{backgroundAsset?.displayName ?? 'Nhập video nền'}</strong><small>{backgroundAsset?.processing === 'error' ? 'Thiếu file · bấm để nối lại' : backgroundAsset ? 'Dùng cho preview và render' : 'MP4 · MOV · MKV · WebM · AVI · M4V'}</small></span>
            {backgroundAsset ? <Icon name="check" size={15} /> : <Icon name="plus" size={15} />}
          </button>
          {backgroundAsset && <button className="button button-small button-quiet extract-video-audio" onClick={() => void extractVideoAudio()} disabled={!window.kara} title={!window.kara ? 'Trích audio cần ứng dụng desktop' : 'Trích track audio thành WAV'}><Icon name="wave" size={14} />Trích audio từ video</button>}
          <div className="source-group-label lyrics-label">LỜI BÀI HÁT <span>{project.segments.length || '—'}</span></div>
          <button className={`lyrics-source ${lyricsAsset ? 'has-file' : ''} ${lyricsAsset?.processing === 'error' ? 'needs-relink' : ''}`} onClick={() => void loadMedia('lyrics')}>
            <span className="source-icon lyrics-icon"><Icon name="lyrics" /></span>
            <span className="source-info"><strong>{lyricsAsset?.displayName ?? 'Nhập lời bài hát'}</strong><small>{lyricsAsset?.processing === 'error' ? 'Thiếu file · bấm để nối lại' : lyricsAsset ? 'Đã liên kết với timeline' : 'TXT · LRC · SRT · ASS'}</small></span>
            {lyricsAsset ? <Icon name="check" size={15} /> : <Icon name="plus" size={15} />}
          </button>
          <div className="source-spacer" />
          <div className="provider-mini">
            <span className="provider-mini-icon"><Icon name="mic" size={15} /></span>
            <div><small>NHẬN DẠNG</small><strong>{providerProfile.kind === 'mock' ? 'Demo offline' : 'Whisper local'}</strong></div>
            <button className="tiny-icon" title="Cấu hình nhận dạng" onClick={() => { void importProviderSettings(); setModal('provider') }}><Icon name="more" size={17} /></button>
          </div>
        </aside>
        <WorkspaceResizeHandle pane="source" label="Thay đổi chiều rộng khu nguồn" value={workspaceWidths.source} minimum={150} maximum={320} defaultValue={DEFAULT_WORKSPACE_WIDTHS.source} onResize={(source) => setWorkspaceWidths((current) => ({ ...current, source }))} />

        <section className="editor-column" ref={editorColumnRef}>
          {recoveryCandidate && <div className="recovery-banner" role="status"><div><strong>Có bản tự khôi phục chưa được mở</strong><span>{recoveryCandidate.title} · cập nhật {new Date(recoveryCandidate.updatedAt).toLocaleString('vi-VN')}</span></div><button className="button button-small button-accent" onClick={() => void restoreRecoveryProject()} disabled={recoveryBusy}>{recoveryBusy ? 'Đang mở…' : 'Khôi phục'}</button><button className="button button-small button-quiet" onClick={() => void dismissRecoveryProject()} disabled={recoveryBusy}>Bỏ qua</button></div>}
          <div className="workflow-strip" aria-label="Quy trình karaoke"><button className={`workflow-step ${workflowStep === 'ingest' ? 'is-active' : 'is-done'}`} onClick={() => navigateWorkflowStep('ingest')}><span>01</span><strong>Nạp bài</strong><small>{fullAsset || backgroundAsset ? 'Media đã sẵn sàng' : 'Audio hoặc video'}</small></button><button className={`workflow-step ${workflowStep === 'recognize' ? 'is-active' : recentTranscriptMatches ? 'is-done' : ''}`} onClick={() => navigateWorkflowStep('recognize')}><span>02</span><strong>Nhận dạng</strong><small>{providerProfile.kind === 'local' ? 'Whisper local' : 'Demo offline'}</small></button><button className={`workflow-step ${workflowStep === 'sync' ? 'is-active' : project.segments.length ? 'is-done' : ''}`} onClick={() => navigateWorkflowStep('sync')}><span>03</span><strong>Đồng bộ</strong><small>{completedCount}/{project.segments.length || 0} dòng</small></button><button className={`workflow-step ${workflowStep === 'preview' ? 'is-active' : ''}`} onClick={() => navigateWorkflowStep('preview')}><span>04</span><strong>Preview</strong><small>Style &amp; vị trí</small></button><button className={`workflow-step ${workflowStep === 'export' ? 'is-active' : ''}`} onClick={() => navigateWorkflowStep('export')}><span>05</span><strong>Xuất</strong><small>ASS · MP4</small></button></div>
          <div className="guided-next-step"><div className="guided-step-marker"><span>TIẾP THEO</span><b>{nextReviewSegment ? project.segments.filter((segment) => segment.needsReview).length : project.segments.length ? '✓' : '01'}</b></div><div className="guided-step-copy"><strong>{guidedStep.title}</strong><span>{guidedStep.detail}</span></div><div className="guided-step-actions"><button className="button button-accent button-small" onClick={guidedStep.run} disabled={busy || Boolean(separationJobId)}>{busy ? 'Đang xử lý…' : guidedStep.label}</button>{guidedStep.secondaryLabel && <button className="button button-quiet button-small" onClick={guidedStep.secondary}>{guidedStep.secondaryLabel}</button>}</div></div>
  <div className="studio-top"><section className="lyrics-input-panel">          <label className="lyrics-editor-label" htmlFor="lyrics-draft">Lời chuẩn · mỗi câu một dòng</label>
          <textarea id="lyrics-draft" className="lyrics-draft" value={lyricsRaw} onChange={(event) => setLyricsRaw(event.target.value)} placeholder="Dán lời đúng bản ca sĩ vào đây. Để trống nếu cần nhận dạng lời." spellCheck={false} />
          <button className="button button-accent" disabled={busy} onClick={() => void transcribe()}>{busy ? `Đang xử lý ${Math.round(recognitionProgress)}%` : lyricsRaw.trim() ? 'Căn lời theo nhạc' : 'Nhận lời từ nhạc'}</button>
</section>            <VideoPreview
            panelRef={previewSectionRef}
            key={project.projectId}
            segments={sortedSegments}
            time={position}
            audioAvailable={Boolean(activeAsset?.url || previewBackgroundUrl)}
            settings={videoSettings}
            backgroundUrl={previewBackgroundUrl}
            playing={playing}
            onPositionChange={setLyricPosition}
            onSettingsChange={(settings) => dispatch({ type: 'set-video-settings', settings })}
            onBackgroundError={(message) => void prepareCompatibleVideoPreview(message)}
            includeSpeakerPrefix={project.exportOptions.includeSpeakerPrefix}
            includeKaraokeTags={project.exportOptions.includeKaraokeTags}
            leadInMs={project.exportOptions.leadInMs}
            leadOutMs={project.exportOptions.leadOutMs}
            onBackgroundDurationChange={(value) => {
              if (backgroundAsset) setAssetDurations((current) => ({ ...current, [backgroundAsset.id]: value }))
              if (!activeAsset && value > 0) setDuration(value)
            }}
          /></div>
          <section className="transport-panel">
              <div className="transport-topline">

              <div className="transport-current">
                <span className={`track-indicator ${activeKind}`}><Icon name="music" size={14} /></span>
              <div><strong>{activeAsset?.displayName ?? (videoProvidesAudio ? backgroundAsset?.displayName : undefined) ?? 'Chưa có audio'}</strong><small>{activeAsset ? activeKind === 'full' ? 'BẢN ĐẦY ĐỦ' : activeKind === 'vocal' ? 'VOCAL STEM' : 'BEAT / INSTRUMENTAL' : videoProvidesAudio ? 'AUDIO TRONG VIDEO NỀN' : 'Nhập audio để nghe và căn lời'}</small></div>
              </div>
              <div className="transport-controls">
                <button className="transport-skip" title="Lùi 5 giây" onClick={() => seekTo(position - 5)}><Icon name="back" /></button>
                <button className="play-button" title={playing ? 'Tạm dừng' : 'Phát'} onClick={togglePlay}><Icon name={playing ? 'pause' : 'play'} size={20} /></button>
                <button className="transport-skip" title="Tiến 5 giây" onClick={() => seekTo(position + 5)}><Icon name="forward" /></button>
              </div>
              <div className="time-readout"><strong>{formatClock(position)}</strong><span>/ {formatClock(duration || maxTime)}</span></div>
              </div>
            <div className="wave-panel">
              <div className="wave-time-labels"><span>00:00</span><span>{formatClock(maxTime / 4)}</span><span>{formatClock(maxTime / 2)}</span><span>{formatClock(maxTime * 0.75)}</span><span>{formatClock(maxTime)}</span></div>
              <div className="waveform" role="slider" aria-label="Vị trí phát audio" aria-valuemin={0} aria-valuemax={maxTime} aria-valuenow={position} tabIndex={0} onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                seekTo((event.clientX - bounds.left) / bounds.width * maxTime)
              }} onKeyDown={(event) => { if (event.key === 'ArrowLeft') seekTo(position - 0.1); if (event.key === 'ArrowRight') seekTo(position + 0.1) }}>
                {waveformImage && <img className="waveform-image" src={waveformImage} alt="" aria-hidden="true" />}
                {!waveformImage && <div className={`wave-bars ${waveformLoading ? 'is-loading' : ''}`} aria-hidden="true">{Array.from({ length: 188 }, (_, index) => {
                  const peak = waveformPeaks[index] ?? 0
                  const value = Math.max(0.025, Math.min(1, peak))
                  return <i key={index} style={{ height: `${Math.max(3, value * 100)}%`, opacity: waveformPeaks.length ? 0.35 + value * 0.55 : 0.16 }} />
                })}</div>}
                <div className="wave-progress" style={{ width: `${position / maxTime * 100}%` }} />
                <div className="playhead" style={{ left: `${position / maxTime * 100}%` }}><span /></div>
                {!activeAsset && !videoProvidesAudio && <div className="wave-empty-label">Nhập bản đầy đủ, beat hoặc video có audio để phát</div>}
              </div>
              <div className="wave-footnote"><span><i className="legend-full" />{activeAsset?.displayName ?? 'Track đang nghe'}</span><button onClick={() => { const next = activeKind === 'full' ? vocalAsset ? 'vocal' : 'beat' : 'full'; const asset = next === 'full' ? fullAsset : next === 'vocal' ? vocalAsset : beatAsset; setActiveKind(next); if (asset) setMappingRole('playbackAssetId', asset.id) }} disabled={!fullAsset && !beatAsset && !vocalAsset}>Đổi track <span>⇄</span></button></div>
            </div>
            {audioError && <div className="audio-error"><Icon name="warning" size={14} />{audioError}</div>}
            {activeAsset?.url && <audio ref={audioRef} src={activeAsset.url} onLoadedMetadata={(event) => { const value = finiteMediaDuration(event.currentTarget.duration); if (value !== undefined) { setAssetDurations((current) => ({ ...current, [activeAsset.id]: value })); setDuration(assetTimeToTimeline(value, project.trackTimeMapping, activeAsset.id)) } const target = timelineToAssetTime(position, project.trackTimeMapping, activeAsset.id); if (Number.isFinite(target)) event.currentTarget.currentTime = Math.max(0, target); setAudioError('') }} onEnded={() => { setPlaying(false); if (wordRecordingRef.current) stopWordRecording() }} onError={() => setAudioError('Không đọc được audio. Hãy thử MP3, WAV, M4A, FLAC hoặc OGG.')} />}
            {videoProvidesAudio && previewBackgroundUrl && <video ref={videoAudioRef} className="video-audio-source" src={previewBackgroundUrl} preload="metadata" onLoadedMetadata={(event) => { const value = finiteMediaDuration(event.currentTarget.duration); if (value !== undefined) { if (backgroundAsset) setAssetDurations((current) => ({ ...current, [backgroundAsset.id]: value })); setDuration(assetTimeToTimeline(value, project.trackTimeMapping, backgroundAsset?.id)) } const target = timelineToAssetTime(position, project.trackTimeMapping, backgroundAsset?.id); if (Number.isFinite(target)) event.currentTarget.currentTime = Math.max(0, target) }} onEnded={() => { setPlaying(false); if (wordRecordingRef.current) stopWordRecording() }} onError={() => {
              const message = 'Không đọc được audio trong video nền.'
              setAudioError(message)
              void prepareCompatibleVideoPreview(message)
            }} />}
          </section>



          <div className="timeline-heading" ref={syncSectionRef}>
            <div><div className="section-title">Lời & thời gian</div><p>Kéo mép dòng để căn nhịp · chọn một dòng để sửa</p></div>
            <div className="timeline-actions">
              <span className="review-status"><span className="review-dot" />{completedCount}/{project.segments.length} đã xác nhận</span>
              <button className="button button-quiet button-small" onClick={() => setReviewQueueOpen((value) => !value)}>Cần xác nhận · {project.segments.filter((segment) => segment.needsReview).length}</button>
              {busy && recognitionJobId && window.kara && <button className="button button-danger button-small" onClick={() => void cancelRecognition()}>Hủy nhận dạng</button>}
              <button ref={recognitionActionRef} className="button button-quiet button-small" onClick={() => { setWorkflowStep('recognize'); void transcribe() }} disabled={busy}><Icon name="mic" size={15} />{busy ? providerProfile.kind === 'local' ? `Đang căn ${Math.round(recognitionProgress)}%` : 'Đang xử lý…' : providerProfile.kind === 'mock' ? 'Tạo timing demo' : providerProfile.kind === 'local' ? 'Căn timestamp local' : 'Nhận dạng audio'}</button>
              <button className="button button-small button-add" onClick={addSegment}><Icon name="plus" size={15} />Dòng lời</button>
            </div>
          </div>

          {reviewQueueOpen && <div className="review-queue" aria-label="Danh sách cần nghe lại"><div className="review-queue-heading"><strong>Cần nghe xác nhận · {project.segments.filter((segment) => segment.needsReview).length}</strong><button className="tiny-icon" title="Đóng danh sách" onClick={() => setReviewQueueOpen(false)}><Icon name="close" size={14} /></button></div>{sortedSegments.filter((segment) => segment.needsReview).length ? sortedSegments.filter((segment) => segment.needsReview).map((segment) => <div className={`review-queue-item ${selected?.id === segment.id ? 'is-current' : ''}`} key={segment.id}><button onClick={() => jumpToReview(segment)}><span>{formatClock(segment.start)} · {formatClock(segment.end)}</span><strong>{segment.text}</strong><small>{reviewReasonLabel(segment)}</small></button><button className="review-play-button" title={playing && loopSegmentId === segment.id ? 'Tạm dừng dòng' : 'Phát lặp chậm dòng'} onClick={() => playing && loopSegmentId === segment.id ? togglePlay() : playReviewSegment(segment)}>{playing && loopSegmentId === segment.id ? 'Ⅱ' : '▶'}</button><button className="review-mark-button" title={reviewedAudioIds.includes(segment.id) ? 'Xác nhận đã nghe' : 'Nghe dòng trước khi xác nhận'} disabled={!reviewedAudioIds.includes(segment.id)} onClick={() => confirmSegmentReview(segment)}><Icon name="check" size={14} /></button></div>) : <p className="review-queue-empty">Không còn dòng cần nghe. Preview đã sẵn sàng.</p>}</div>}

          <div className="timeline-column-labels"><span>LỜI</span><div ref={rulerRef} className="ruler-header"><span>00:00</span><span>{formatClock(maxTime * 0.25)}</span><span>{formatClock(maxTime * 0.5)}</span><span>{formatClock(maxTime * 0.75)}</span><span>{formatClock(maxTime)}</span></div><span>NGƯỜI HÁT</span></div>
          <div className="segment-list">
            {sortedSegments.map((segment, index) => (
              <div className={`segment-row ${selected?.id === segment.id ? 'is-selected' : ''}`} key={segment.id} onClick={() => { setSelectedId(segment.id); setInspectorOpen(true) }}>
                <div className="segment-lyric-cell">
                  <span className="segment-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="segment-copy"><strong>{segment.text}</strong><small>{formatClock(drag?.id === segment.id ? drag.previewStart ?? segment.start : segment.start)} <span>–</span> {formatClock(drag?.id === segment.id ? drag.previewEnd ?? segment.end : segment.end)}</small></span>
                  {segment.needsReview && <span className="needs-review-mark" title="Cần nghe lại">•</span>}
                </div>
                <div className="segment-ruler" onPointerDown={(event) => {
                  const target = event.target as HTMLElement
                  if (target.closest('.segment-handle')) return
                  const bounds = event.currentTarget.getBoundingClientRect()
                  seekTo((event.clientX - bounds.left) / bounds.width * maxTime)
                }}>
                  <div className="ruler-grid"><i /><i /><i /><i /></div>
                  <div className={`segment-block role-${segment.speakerRole} ${selected?.id === segment.id ? 'active' : ''}`} style={rulerStyle(drag?.id === segment.id ? { ...segment, start: drag.previewStart ?? segment.start, end: drag.previewEnd ?? segment.end } : segment)}>
                    <button className="segment-handle handle-start" aria-label="Căn điểm bắt đầu" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => startDrag(event, segment, 'start')} />
                    <span className="segment-block-text">{segment.text}</span>
                    <button className="segment-handle handle-end" aria-label="Căn điểm kết thúc" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => startDrag(event, segment, 'end')} />
                  </div>
                  <div className="ruler-playhead" style={{ left: `${position / maxTime * 100}%` }} />
                </div>
                <div className="speaker-cell"><span className={`speaker-pill role-${segment.speakerRole}`}><i />{roleShort[segment.speakerRole]}</span></div>
              </div>
            ))}
            {!sortedSegments.length && <div className="empty-segments"><Icon name="lyrics" size={22} /><strong>Chưa có dòng lời</strong><span>Nhập lời hoặc thêm một dòng để bắt đầu dựng timing.</span><button className="button button-quiet" onClick={addSegment}>Thêm dòng lời</button></div>}
          </div>
          <div className="timeline-footer"><span>{project.segments.length} dòng lời <i /> {project.segments.reduce((sum, segment) => sum + segment.words.length, 0)} từ có timing</span><span>Kéo mép block để căn · nhấn Space để phát/tạm dừng</span></div>
        </section>

        {inspectorOpen && <WorkspaceResizeHandle pane="inspector" label="Thay đổi chiều rộng bảng thuộc tính" value={workspaceWidths.inspector} minimum={210} maximum={400} defaultValue={DEFAULT_WORKSPACE_WIDTHS.inspector} onResize={(inspector) => setWorkspaceWidths((current) => ({ ...current, inspector }))} />}

        {inspectorOpen ? <aside className="inspector">
          <div className="inspector-heading"><div><span>THUỘC TÍNH</span><strong>{selected ? `Dòng ${String(sortedSegments.findIndex((item) => item.id === selected.id) + 1).padStart(2, '0')}` : 'Chưa chọn dòng'}</strong></div><div className="inspector-heading-actions"><button className="tiny-icon" title="Xóa dòng" aria-label="Xóa dòng" disabled={!selected} onClick={() => {
            if (!selected) return
            if (selected.timingLocked) return notify('Hãy mở khóa timing trước khi xóa dòng.')
            dispatch({ type: 'delete-segment', id: selected.id })
            const next = sortedSegments.find((item) => item.id !== selected.id)
            setSelectedId(next?.id ?? '')
          }}><Icon name="trash" size={16} /></button><button className="tiny-icon" title="Ẩn bảng thuộc tính" aria-label="Ẩn bảng thuộc tính" onClick={() => setInspectorOpen(false)}><Icon name="close" size={15} /></button></div></div>
          {selected ? <>
            <section className="inspector-section">
              <label className="field-label" htmlFor="segment-text">Nội dung</label>
              <textarea id="segment-text" className="lyric-textarea" value={selected.text} rows={3} onChange={(event) => changeSegment(selected.id, { text: event.target.value })} />
            </section>
            <section className="inspector-section time-section">
              <div className="field-label">Thời gian <span>hh:mm:ss.ms</span></div>
              <div className="time-fields">
                <label><small>BẮT ĐẦU</small><input disabled={selected.timingLocked} value={formatTimecode(selected.start)} onChange={(event) => updateTimeField(selected.id, 'start', event.target.value)} onBlur={(event) => {
                  const value = parseTimecode(event.target.value)
                  if (value !== null) changeSegment(selected.id, { start: Math.max(0, Math.min(value, selected.end - 0.05)) })
                }} /></label>
                <span className="time-dash">—</span>
                <label><small>KẾT THÚC</small><input disabled={selected.timingLocked} value={formatTimecode(selected.end)} onChange={(event) => updateTimeField(selected.id, 'end', event.target.value)} onBlur={(event) => {
                  const value = parseTimecode(event.target.value)
                  if (value !== null) changeSegment(selected.id, { end: Math.max(selected.start + 0.05, value) })
                }} /></label>
              </div>
              <div className="nudge-row"><button disabled={selected.timingLocked} onClick={() => changeSegment(selected.id, { start: Math.max(0, selected.start - 0.05), end: Math.max(selected.start + 0.05, selected.end - 0.05) })}>− 50 ms</button><button disabled={selected.timingLocked} onClick={() => changeSegment(selected.id, { start: selected.start + 0.05, end: selected.end + 0.05 })}>+ 50 ms</button><button onClick={() => seekTo(selected.start)}>Nghe từ đầu</button></div>
              <div className="nudge-row review-playback-row"><button className={loopSegmentId === selected.id ? 'is-active' : ''} onClick={toggleSelectedLoop} disabled={Boolean(wordRecording)}>{loopSegmentId === selected.id ? 'Tắt lặp đoạn' : 'Lặp đoạn'}</button><button className={slowPlayback ? 'is-active' : ''} onClick={() => setSlowPlayback((value) => !value)}>{slowPlayback ? 'Tốc độ 0.7×' : 'Nghe chậm 0.7×'}</button></div>
            </section>
            <section className="inspector-section">
              <div className="field-label">Người hát</div>
              <div className="role-picker">{(['male', 'female', 'duet', 'unknown'] as SpeakerRole[]).map((role) => <button key={role} className={`role-choice role-${role} ${selected.speakerRole === role ? 'chosen' : ''}`} onClick={() => changeSegment(selected.id, { speakerRole: role })}><i />{roleLabels[role]}</button>)}</div>
              {selected.providerSpeakerId && <div className="speaker-origin">Mã người hát từ bản nhận dạng: <strong>{selected.providerSpeakerId}</strong></div>}
            </section>
            <section className="inspector-section word-section">
              <div className="field-label"><span>Timing từng từ</span><span>{selected.words.length || '—'}</span></div>
              <div className="word-recording-toolbar">
                {!wordRecording ? <button className="button button-accent button-small" onClick={startWordRecording} disabled={!selected.words.length && !selected.text.trim()}><Icon name="mic" size={14} />Thu / căn từ</button> : <><strong className={spaceHeld ? 'is-space-held' : ''}>{spaceHeld ? 'ĐANG NGÂN' : 'ĐANG THU'} · {wordRecording.nextIndex}/{wordRecording.words.length} từ</strong><button className="button button-small button-danger" onClick={() => stopWordRecording(true)}>Hủy</button><button className="button button-small button-quiet" onClick={() => stopWordRecording()}>Dừng</button></>}
                {!wordRecording && recentTranscriptMatches && <button className="button button-quiet button-small" onClick={() => void realignSelectedSegment()} disabled={busy || realignmentBusy || selected.timingLocked} title="Căn lại từ transcript đã lưu trong vùng quanh dòng này">{realignmentBusy ? 'Đang kiểm tra audio…' : 'Căn lại dòng này'}</button>}
              </div>
              <p className="word-recording-hint">Căn nhanh: bấm ▶ rồi giữ <kbd>Space</kbd> trong lúc phát âm từ, nhả phím để chốt thời điểm; mỗi nhịp là một từ. Có thể chạm từng từ để sửa thủ công.</p>
              {selected.words.length ? <>
                <WordTimingLane onResize={(id, edge, time) => { const next = resizeWord(selected, id, edge, time); if (next !== selected) dispatch({ type: 'update-segment', id: selected.id, patch: { words: next.words, origin: 'manual', ...editReviewState() } }) }} segment={selected} disabled={Boolean(wordRecording || selected.timingLocked)} onMove={(wordId, delta) => {
                  const moved = moveWord(selected, wordId, delta)
                  if (moved !== selected) dispatch({ type: 'update-segment', id: selected.id, patch: { words: moved.words, origin: 'manual', ...editReviewState() } })
                }} />
                <div className="word-list">{selected.words.map((word, index) => <div className={`word-chip-row word-origin-${word.origin ?? selected.origin ?? 'unknown'}`} key={word.id}><button className={`word-chip ${wordRecording && index === wordRecording.nextIndex ? 'is-recording-target' : ''} ${wordRecording && index < wordRecording.nextIndex ? 'is-recorded' : ''}`} title={`${formatTimecode(word.start)} – ${formatTimecode(word.end)} · ${word.origin === 'asr' ? 'Timestamp ASR · cần nghe xác nhận' : word.origin === 'aligned' ? 'Căn trực tiếp theo audio' : word.origin === 'estimated' ? 'Ước lượng · căn tay theo giọng' : 'Đã căn thủ công'}`} onClick={() => { seekTo(word.start); if (word.origin !== 'manual') setLoopSegmentId(selected.id) }} disabled={Boolean(wordRecording)}><span>{word.text}</span><small>{formatClock(word.start)} · {word.origin === 'asr' ? 'ASR' : word.origin === 'aligned' ? 'ALIGN' : word.origin === 'estimated' ? 'ƯỚC LƯỢNG' : 'TAY'}</small>{word.confidence !== undefined && <i style={{ opacity: Math.max(0.3, word.confidence) }} />}</button><button type="button" className={`word-lock ${word.timingLocked ? 'is-locked' : ''}`} aria-label={`${word.timingLocked ? 'Mở khóa' : 'Khóa'} timing từ ${word.text}`} title={`${word.timingLocked ? 'Mở khóa' : 'Khóa'} timing từ`} disabled={Boolean(wordRecording || selected.timingLocked)} onClick={() => dispatch({ type: 'update-segment', id: selected.id, patch: { words: selected.words.map((item) => item.id === word.id ? { ...item, timingLocked: !item.timingLocked } : item) } })}>{word.timingLocked ? '🔒' : '◇'}</button></div>)}</div>
              </> : <div className="word-empty">Chưa có timing cấp từ.<br />Bấm “Căn từ theo beat” để tạo và chấm từng từ.</div>}
            </section>
            <section className="inspector-section quality-section">
              <div className="quality-label"><span>ĐỘ TIN CẬY</span><strong>{selected.confidence === undefined ? 'Chưa có dữ liệu' : `${Math.round(selected.confidence * 100)}%`}</strong></div>
              <div className="confidence-track"><i style={{ width: `${Math.max(0, Math.min(100, (selected.confidence ?? 0) * 100))}%`, background: selected.confidence !== undefined && selected.confidence < 0.65 ? '#f1b365' : '#58dfb1' }} /></div>
              <span className="quality-note">Text confidence dùng để so khớp lời, không đảm bảo timing đúng. {reviewReasonLabel(selected)}.</span>
              <div className="quality-actions"><button className="button button-quiet button-small" disabled={Boolean(wordRecording)} onClick={() => selected.needsReview
                ? (reviewedAudioIds.includes(selected.id) ? confirmSegmentReview(selected) : dispatch({ type: 'update-segment', id: selected.id, patch: { needsReview: false, reviewReason: 'reviewed', reviewStatus: 'explicitly-accepted' } }))
                : dispatch({ type: 'update-segment', id: selected.id, patch: { needsReview: true, reviewReason: 'explicit', reviewStatus: 'pending' } })}>{selected.needsReview ? reviewedAudioIds.includes(selected.id) ? 'Đã nghe · xác nhận' : 'Chấp nhận nháp này' : 'Đưa lại vào hàng nghe'}</button><button className="button button-quiet button-small" disabled={Boolean(wordRecording)} onClick={() => dispatch({ type: 'update-segment', id: selected.id, patch: { timingLocked: !selected.timingLocked } })}>{selected.timingLocked ? 'Mở khóa timing' : 'Khóa timing'}</button></div>
            </section>
            <div className="inspector-actions"><button className="button button-quiet" onClick={splitSelected}><Icon name="split" size={15} />Tách dòng</button><button className="button button-quiet" onClick={mergeSelected}><Icon name="merge" size={15} />Gộp kế</button></div>
          </> : <div className="inspector-empty">Chọn một dòng lời trong timeline để chỉnh.</div>}
        </aside> : <button className="inspector-reopen button button-quiet button-small" onClick={() => setInspectorOpen(true)}><Icon name="more" size={14} />Thuộc tính</button>}
      </main>

      <footer className="statusbar"><div><span className="status-ready"><i />Sẵn sàng</span><span className="status-divider" />{project.assets.length} nguồn liên kết<span className="status-divider" />{currentPath ? currentPath.split(/[\\/]/).pop() : 'Project chưa lưu'}</div><div><span>LOCALE</span><strong>VI</strong><span className="status-divider" />Kara Studio · Beta</div></footer>

      <input ref={inputRef} className="visually-hidden" type="file" accept="audio/*,video/*,.txt,.lrc,.srt,.ass,.ssa,.mp4,.mov,.mkv,.webm,.avi,.m4v" onChange={(event) => void onBrowserFile(event)} />

      {modal === 'provider' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}>
        <section className="dialog provider-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-title">
          <div className="dialog-heading"><div><span className="dialog-icon"><Icon name="mic" /></span><div><h2 id="provider-title">Cấu hình nhận dạng</h2><p>Chọn dịch vụ nhận lời và timing từ audio.</p></div></div><button className="tiny-icon" onClick={() => setModal(null)} aria-label="Đóng"><Icon name="close" /></button></div>
          <div className="dialog-body">
            <label className="field-label" htmlFor="provider-kind">Dịch vụ</label>
            <div className="provider-options">
              {([{ kind: 'mock', label: 'Demo offline', detail: 'Tạo timing mẫu, không gửi audio' }, { kind: 'local', label: 'Whisper local', detail: 'Timestamp từng từ, chạy trên máy' }] as Array<{ kind: ProviderKind; label: string; detail: string }>).map((option) => <button key={option.kind} className={`provider-option ${providerProfile.kind === option.kind ? 'active' : ''}`} onClick={() => setProviderProfile({ ...providerProfile, kind: option.kind, model: option.kind === 'local' && !['tiny', 'base', 'small', 'medium'].includes(providerProfile.model) ? 'small' : providerProfile.model })}><span className="provider-radio" /><span><strong>{option.label}</strong><small>{option.detail}</small></span></button>)}
            </div>
            {providerProfile.kind === 'local' && <>
              <div className="form-grid"><label><span className="field-label">Model Whisper</span><select className="text-input" value={providerProfile.model} onChange={(event) => setProviderProfile({ ...providerProfile, model: event.target.value })}><option value="tiny">tiny · nhanh, nhẹ</option><option value="base">base · cân bằng</option><option value="small">small · chính xác hơn</option><option value="medium">medium · tốt hơn, chậm hơn</option><option value="large-v3-turbo">large-v3-turbo · cục bộ, nặng</option></select></label><label><span className="field-label">Ngôn ngữ</span><input className="text-input" value={providerProfile.language} onChange={(event) => setProviderProfile({ ...providerProfile, language: event.target.value })} placeholder="vi" /></label></div>
              <label className="field-label" htmlFor="local-source">Nguồn nhận dạng</label><select id="local-source" className="text-input" value={providerProfile.localSource ?? 'original'} onChange={(event) => setProviderProfile({ ...providerProfile, localSource: event.target.value as 'original' | 'vocal' | 'auto' })}><option value="original">Original mix · không tách vocal</option><option value="vocal">Vocal stem · chính xác hơn nếu đã tách</option><option value="auto">Auto · ưu tiên vocal stem</option></select>
              <p className="form-hint">Có lời: căn trực tiếp bằng Stable-ts như Vietkara. Chưa có lời: Whisper nhận dạng từng từ. Cần stable-ts 2.19.1 trong runtime đã chọn.</p>
              <p className="form-hint">Beat được giữ làm audio phát và audio render. Audio ca sĩ/vocal stem chỉ dùng để phân tích mốc từ, không bị trộn vào video karaoke.</p><label className="field-label" htmlFor="local-model-path">Thư mục model (tuỳ chọn)</label><input id="local-model-path" className="text-input" value={providerProfile.localModelPath ?? ''} onChange={(event) => setProviderProfile({ ...providerProfile, localModelPath: event.target.value || undefined })} placeholder="Để trống để Faster-Whisper tự tìm/tải model" />
              <p className="form-hint">Chọn Original để phân tích trực tiếp file ca sĩ; chọn Vocal stem nếu đã có stem sạch. Cả hai chỉ tạo timestamp, không thay đổi audio render.</p>
              <label className="field-label" htmlFor="local-python-path">Python executable (tuỳ chọn)</label><input id="local-python-path" className="text-input" value={providerProfile.localPythonPath ?? ''} onChange={(event) => setProviderProfile({ ...providerProfile, localPythonPath: event.target.value || undefined })} placeholder="C:\\Python312\\python.exe · để trống dùng Python mặc định" />
              <div className="runtime-check-row"><button className="button button-small button-quiet" disabled={!window.kara} onClick={async () => { const path = await window.kara?.pickRuntimePath('python'); if (path) { setProviderProfile({ ...providerProfile, localPythonPath: path }); setRuntimeCheck({ busy: false, ok: false, message: 'Đã chọn Python; bấm Kiểm tra runtime.' }) } }}>Chọn Python…</button><button className="button button-small button-quiet" disabled={!window.kara} onClick={async () => { const path = await window.kara?.pickRuntimePath('model'); if (path) setProviderProfile({ ...providerProfile, localModelPath: path }) }}>Chọn model đã tải…</button></div>
              <div className="runtime-check-row"><button type="button" className="button button-small button-quiet" onClick={() => void checkLocalRuntime()} disabled={!window.kara || runtimeCheck.busy}>{runtimeCheck.busy ? 'Đang kiểm tra…' : 'Kiểm tra runtime'}</button>{runtimeCheck.message && <span className={runtimeCheck.ok ? 'runtime-check-ok' : 'runtime-check-warning'}>{runtimeCheck.message}</span>}</div>
            </>}
            {providerProfile.kind === 'mock' && <div className="mock-note"><span className="mock-spark">✳</span><div><strong>Demo không gửi dữ liệu</strong><p>Tạo mốc từ lời để thử timeline offline. Đây không phải kết quả nhận dạng giọng thật.</p></div></div>}
            {!window.kara && providerProfile.kind === 'local' && <div className="warning-note">Whisper local cần chạy trong ứng dụng desktop; browser preview hỗ trợ Demo offline.</div>}
          </div>
          <div className="dialog-footer"><button className="button button-quiet" onClick={() => setModal(null)}>Hủy</button><button className="button button-accent" onClick={() => void saveProviderSettings()}>Lưu cấu hình</button></div>
        </section>
      </div>}

      {modal === 'export' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}>
        <section className="dialog export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div className="dialog-heading"><div><span className="dialog-icon export-dialog-icon"><Icon name="export" /></span><div><h2 id="export-title">Xuất phụ đề</h2><p>Kiểm tra định dạng và bản xem trước trước khi lưu.</p></div></div><button className="tiny-icon" onClick={() => setModal(null)} aria-label="Đóng"><Icon name="close" /></button></div>
          <div className="dialog-body">
            <div className="export-tabs"><button className={exportFormat === 'ass' ? 'active' : ''} onClick={() => updateExportPreview('ass')}>ASS <small>Karaoke style</small></button><button className={exportFormat === 'srt' ? 'active' : ''} onClick={() => updateExportPreview('srt')}>SRT <small>Phụ đề phổ thông</small></button></div>
            <div className="export-options"><label><input type="checkbox" checked={project.exportOptions.includeSpeakerPrefix} onChange={(event) => dispatch({ type: 'set-export-options', options: { includeSpeakerPrefix: event.target.checked } })} />Thêm nhãn người hát</label>{exportFormat === 'ass' && <label><input type="checkbox" checked={project.exportOptions.includeKaraokeTags} onChange={(event) => dispatch({ type: 'set-export-options', options: { includeKaraokeTags: event.target.checked } })} />Timing tô từng từ <span>(khi có dữ liệu)</span></label>}</div>
            <div className="preview-heading"><span>XEM TRƯỚC</span><span>{project.segments.length} cues</span></div>
            <pre className="export-preview">{(exportFormat === 'srt' ? buildSrt(sortedSegments, project.exportOptions) : buildAss(sortedSegments, project.exportOptions, videoSettings)).slice(0, 2600)}{(exportFormat === 'srt' ? buildSrt(sortedSegments, project.exportOptions) : buildAss(sortedSegments, project.exportOptions, videoSettings)).length > 2600 ? '\n…' : ''}</pre>
          </div>
          <div className="dialog-footer"><button className="button button-quiet" onClick={() => setModal(null)}>Đóng</button><button className="button button-accent" onClick={() => void exportFile()}><Icon name="export" size={16} />Lưu file .{exportFormat}</button></div>
        </section>
      </div>}

      {modal === 'render' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && renderState.status !== 'running' && renderState.status !== 'canceling') setModal(null) }}>
        <section className="dialog render-dialog" role="dialog" aria-modal="true" aria-labelledby="render-title">
          <div className="dialog-heading"><div><span className="dialog-icon render-dialog-icon"><Icon name="video" /></span><div><h2 id="render-title">Render video karaoke</h2><p>Xuất video MP4 {videoSettings.width} × {videoSettings.height} với lời đã căn timing.</p></div></div><button className="tiny-icon" onClick={() => { if (renderState.status !== 'running' && renderState.status !== 'canceling') setModal(null) }} aria-label="Đóng" disabled={renderState.status === 'running' || renderState.status === 'canceling'}><Icon name="close" /></button></div>
          <div className="dialog-body render-body">
            {!window.kara && <div className="desktop-only-note"><Icon name="warning" size={17} /><div><strong>Render cần ứng dụng desktop</strong><p>Browser vẫn dùng được preview, kéo vị trí chữ và chỉnh timing. Hãy mở Kara Studio bản Windows để tạo MP4 bằng FFmpeg.</p></div></div>}
              <div className="render-summary"><div><span>Audio render</span><strong>{renderAsset?.displayName ?? backgroundAsset?.displayName ?? 'Chưa có audio/video'}</strong><small>{renderAsset ? beatAsset ? 'Ưu tiên beat có sẵn' : 'Dùng bản đầy đủ thay thế' : backgroundAsset ? videoProvidesAudio ? 'Dùng audio của video nền' : 'Video nền đã tắt tiếng, cần thêm audio' : 'Nhập beat hoặc audio có audio'}</small></div><div><span>Audio phân tích</span><strong>{analysisAsset?.displayName ?? 'Chưa chọn'}</strong><small>{analysisAsset ? 'Chỉ dùng cho timestamp, không render' : 'Nhập audio ca sĩ để căn từ'}</small></div><div><span>Hình nền</span><strong>{backgroundAsset?.displayName ?? 'Màu nền'}</strong><small>{backgroundAsset ? `Video nền được lặp và căn khung · padding ${videoSettings.backgroundColor}` : videoSettings.backgroundColor}</small></div><div><span>Khung hình</span><strong>{videoSettings.width} × {videoSettings.height}</strong><small>Vị trí lời {Math.round(videoSettings.lyricPosition.x * 100)}% · {Math.round(videoSettings.lyricPosition.y * 100)}%</small></div></div>
            {(renderState.status === 'running' || renderState.status === 'canceling') && <div className="render-progress-panel"><div className="render-progress-heading"><strong>{renderState.status === 'canceling' ? 'Đang hủy…' : 'Đang render video'}</strong><span>{renderState.percent}%</span></div><div className="render-progress-track"><i style={{ width: `${Math.max(0, Math.min(100, renderState.percent))}%` }} /></div><p>{renderState.message || 'Đang chuẩn bị…'}</p></div>}
            {renderState.status === 'error' && <div className="render-error"><Icon name="warning" size={17} /><div><strong>Không thể render video</strong><p>{renderState.error}</p></div></div>}
            {renderState.status === 'canceled' && <div className="render-canceled"><strong>Render đã hủy</strong><p>File tạm đã được dọn dẹp; project và timing của bạn vẫn giữ nguyên.</p></div>}
            {renderState.status === 'done' && renderState.outputUrl && <div className="render-result"><div className="render-result-heading"><div><strong>Video đã sẵn sàng</strong><span>{renderState.outputPath?.split(/[\\/]/).pop()}</span></div><span className="render-complete-mark"><Icon name="check" size={14} /></span></div><video className="render-result-video" controls preload="metadata" src={renderState.outputUrl}>Trình duyệt không hỗ trợ phát video.</video></div>}
            {renderState.status === 'idle' && <p className="render-help">Kara Studio sẽ dùng bản đầy đủ nếu có; nếu không, app sẽ render bằng beat. Subtitle ASS được tạo từ timing hiện tại và vị trí chữ đang lưu.</p>}
          </div>
          <div className="dialog-footer render-dialog-footer">{renderState.status === 'done' || renderState.status === 'error' || renderState.status === 'canceled' ? <button className="button button-quiet" onClick={resetRender}>Render lại</button> : null}<button className="button button-quiet" onClick={() => { if (renderState.status !== 'running' && renderState.status !== 'canceling') setModal(null) }} disabled={renderState.status === 'running' || renderState.status === 'canceling'}>{renderState.status === 'done' ? 'Đóng' : 'Hủy'}</button>{renderState.status === 'running' || renderState.status === 'canceling' ? <button className="button button-danger" onClick={() => void cancelRender()} disabled={renderState.status === 'canceling'}>Hủy render</button> : renderState.status !== 'done' && <button className="button button-accent" onClick={() => void startRender()} disabled={!window.kara || !renderAudioPath}>Bắt đầu render</button>}</div>
        </section>
      </div>}
      {toast && <div className="toast"><Icon name="check" size={15} />{toast}</div>}
    </div>
  )
}

  function SourceCard({ kind, asset, active, onSelect, onAdd }: { kind: 'full' | 'beat' | 'vocal'; asset?: MediaAsset; active: boolean; onSelect: () => void; onAdd: () => void }) {
  const label = kind === 'full' ? 'Bản đầy đủ' : kind === 'vocal' ? 'Vocal stem' : 'Beat / instrumental'
  const unavailable = Boolean(asset && (!asset.url || asset.processing === 'error'))
  return <button className={`source-card ${active ? 'is-active' : ''} ${asset ? 'has-asset' : ''} ${unavailable ? 'needs-relink' : ''}`} onClick={asset && !unavailable ? onSelect : onAdd}>
    <span className={`source-icon ${kind}`}><Icon name="music" /></span>
    <span className="source-info"><strong>{asset?.displayName ?? label}</strong><small>{unavailable ? 'Thiếu file · bấm để nối lại' : asset ? `${label}${asset.duration ? ` · ${formatClock(asset.duration)}` : ''}` : 'Chưa thêm audio'}</small></span>
    {asset && !unavailable ? <span className="active-track-marker">{active ? <i /> : <span />}</span> : <span className="source-add"><Icon name="plus" size={15} /></span>}
  </button>
}

export default App
