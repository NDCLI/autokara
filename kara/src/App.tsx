import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_PROVIDER, DEFAULT_VIDEO_SETTINGS, SPEAKER_COLORS, type ExportFormat, type KaraProject, type LyricSegment, type MediaAsset, type MediaKind, type NormalizedPosition, type NormalizedTranscript, type ProviderKind, type ProviderProfile, type RenderProgress, type RenderRequest, type SpeakerRole } from '../shared/contracts'
import { parseProjectJson } from '../shared/validation'
import { alignLyrics, lyricsToSegments, parseLyrics } from './lib/lyrics/parse'
import { buildAss, buildSrt } from './lib/export/subtitles'
import { formatClock, formatTimecode, parseTimecode } from './lib/timecode'
import { createHistory, projectReducer } from './state/projectReducer'
import { createDemoSegments, createNewProject } from './state/projectFactory'
import VideoPreview from './components/VideoPreview'

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const roleLabels: Record<SpeakerRole, string> = { male: 'Nam', female: 'Nữ', duet: 'Đối đáp', unknown: 'Chưa gán' }
const roleShort: Record<SpeakerRole, string> = { male: 'NAM', female: 'NỮ', duet: 'ĐÔI', unknown: '—' }

function createProject(): KaraProject {
  return createNewProject({ provider: DEFAULT_PROVIDER, exportOptions: DEFAULT_EXPORT_OPTIONS })
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

type DragState = { id: string; edge: 'start' | 'end'; startX: number; originalStart: number; originalEnd: number }

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
  const [currentPath, setCurrentPath] = useState<string | undefined>()
  const [activeKind, setActiveKind] = useState<'full' | 'beat'>('full')
  const [selectedId, setSelectedId] = useState(project.segments[0]?.id ?? '')
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({})
  const [backgroundUrl, setBackgroundUrl] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<'provider' | 'export' | 'render' | null>(null)
  const [toast, setToast] = useState('')
  const [providerProfile, setProviderProfile] = useState<ProviderProfile>(DEFAULT_PROVIDER)
  const [apiKey, setApiKey] = useState('')
  const [apiKeyPresent, setApiKeyPresent] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('ass')
  const [exportPreview, setExportPreview] = useState('')
  const [drag, setDrag] = useState<DragState | null>(null)
  const [lyricsRaw, setLyricsRaw] = useState('')
  const [audioError, setAudioError] = useState('')
  const [browserImportKind, setBrowserImportKind] = useState<MediaKind>('full')
  const [renderState, setRenderState] = useState<RenderState>({ jobId: '', status: 'idle', percent: 0, message: '' })
  const cancelRenderRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const backgroundVideoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const autosaveRef = useRef<number | null>(null)

  const fullAsset = project.assets.find((asset) => asset.kind === 'full')
  const beatAsset = project.assets.find((asset) => asset.kind === 'beat')
  const backgroundAsset = project.assets.find((asset) => asset.kind === 'background')
  const lyricsAsset = project.assets.find((asset) => asset.kind === 'lyrics')
  const previewBackgroundUrl = backgroundUrl ?? backgroundAsset?.url
  const activeAsset = activeKind === 'full' ? fullAsset : beatAsset
  const renderAsset = fullAsset ?? beatAsset
  const selected = project.segments.find((segment) => segment.id === selectedId) ?? project.segments[0]
  const videoSettings = project.video ?? DEFAULT_VIDEO_SETTINGS
  const maxTime = Math.max(duration, ...project.segments.map((segment) => segment.end), 20)
  const sortedSegments = useMemo(() => [...project.segments].sort((a, b) => a.start - b.start), [project.segments])
  const completedCount = project.segments.filter((segment) => !segment.needsReview).length

  useEffect(() => {
    if (!window.kara) return
    void window.kara.loadProviderSettings().then(({ profile, apiKeyPresent: hasKey }) => {
      setProviderProfile(profile)
      setApiKeyPresent(hasKey)
      dispatch({ type: 'set-provider', provider: profile })
    }).catch(() => setToast('Không tải được cấu hình provider đã lưu.'))
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!window.kara) return
    return window.kara.onRenderProgress((progress) => {
      setRenderState((current) => current.jobId === progress.jobId
        ? { ...current, percent: progress.percent, message: progress.status }
        : current)
    })
  }, [])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      const audio = audioRef.current
      if (!audio) return
      setPosition(audio.currentTime)
      if (audio.ended) setPlaying(false)
    }, 80)
    return () => window.clearInterval(timer)
  }, [playing])

  useEffect(() => {
    if (!drag) return
    const onMove = (event: PointerEvent) => {
      const width = rulerRef.current?.getBoundingClientRect().width ?? 0
      if (!width) return
      const delta = (event.clientX - drag.startX) / width * maxTime
      const segment = project.segments.find((item) => item.id === drag.id)
      if (!segment) return
      if (drag.edge === 'start') {
        const start = Math.max(0, Math.min(drag.originalEnd - 0.12, drag.originalStart + delta))
        dispatch({ type: 'update-segment', id: drag.id, patch: { start, words: [] } })
      } else {
        const end = Math.max(drag.originalStart + 0.12, drag.originalEnd + delta)
        dispatch({ type: 'update-segment', id: drag.id, patch: { end, words: [] } })
      }
    }
    const onUp = () => setDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, maxTime, project.segments])

  useEffect(() => {
    if (!window.kara) return
    if (autosaveRef.current) window.clearTimeout(autosaveRef.current)
    autosaveRef.current = window.setTimeout(() => {
      try { window.localStorage.setItem('kara-last-project', JSON.stringify(project)) } catch { /* storage is optional */ }
    }, 800)
    return () => { if (autosaveRef.current) window.clearTimeout(autosaveRef.current) }
  }, [project])

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
      const asset: MediaAsset = { id: makeId(), kind, ...file }
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
        if (kind === 'beat' && !fullAsset) setActiveKind('beat')
        setAudioError('')
        notify(`${kind === 'full' ? 'Bản đầy đủ' : 'Beat'} đã sẵn sàng.`)
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thể nhập file.')
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
        : browserImportKind === 'beat'
          ? 'beat'
          : 'full'
    const url = URL.createObjectURL(file)
    const asset: MediaAsset = { id: makeId(), kind, path: file.name, displayName: file.name, mimeType: file.type, url }
    dispatch({ type: 'set-assets', assets: [...project.assets.filter((item) => item.kind !== kind), asset] })
    if (kind === 'lyrics') {
      const text = await file.text()
      setLyricsRaw(text)
      const parsed = parseLyrics(text, file.name)
      dispatch({ type: 'set-segments', segments: lyricsToSegments(parsed) })
      notify(`${parsed.length} dòng lời đã nhập.`)
    } else if (kind === 'background') {
      setBackgroundUrl(url)
      notify('Video nền đã sẵn sàng.')
    } else {
      setActiveKind(kind)
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
      setCurrentPath(result.path)
      dispatch({ type: 'replace', project: loaded })
      setSelectedId(loaded.segments[0]?.id ?? '')
      setPosition(0)
      setDuration(Math.max(0, ...loaded.assets.map((asset) => asset.duration ?? 0)))
      setToast('Đã mở project.')
      const lyrics = loaded.assets.find((asset) => asset.kind === 'lyrics')
      if (lyrics) setLyricsRaw(await window.kara?.readTextFile(lyrics.path) ?? '')
      const playable = loaded.assets.find((asset) => asset.kind === 'full') ?? loaded.assets.find((asset) => asset.kind === 'beat')
      const background = loaded.assets.find((asset) => asset.kind === 'background')
      if (window.kara) {
        const playableUrl = playable ? await window.kara.getMediaUrl(playable.path) : undefined
        const backgroundUrl = background ? await window.kara.getMediaUrl(background.path) : undefined
        dispatch({ type: 'set-assets', assets: loaded.assets.map((asset) => asset.id === playable?.id ? { ...asset, url: playableUrl } : asset.id === background?.id ? { ...asset, url: backgroundUrl } : asset) })
        setBackgroundUrl(backgroundUrl)
        if (playable) setActiveKind(playable.kind === 'beat' ? 'beat' : 'full')
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thể mở project.')
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
    const audio = audioRef.current
    if (!audio) {
      notify('Nhập bản đầy đủ hoặc beat để phát audio.')
      return
    }
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      void audio.play().then(() => setPlaying(true)).catch(() => setAudioError('Trình duyệt không thể phát định dạng audio này.'))
    }
  }

  function seekTo(value: number) {
    const safe = Math.max(0, Math.min(maxTime, value))
    setPosition(safe)
    if (audioRef.current) audioRef.current.currentTime = safe
  }

  function changeSegment(id: string, patch: Partial<LyricSegment>) {
    dispatch({ type: 'update-segment', id, patch })
  }

  function addSegment() {
    const start = selected?.end ?? position
    const segment: LyricSegment = { id: makeId(), text: 'Dòng lời mới', start, end: start + 2.5, speakerRole: 'unknown', words: [], needsReview: true }
    const segments = [...project.segments, segment].sort((a, b) => a.start - b.start)
    dispatch({ type: 'set-segments', segments })
    setSelectedId(segment.id)
  }

  function splitSelected() {
    if (!selected) return
    const words = selected.words
    let splitAt = (selected.start + selected.end) / 2
    if (words.length > 1) splitAt = words[Math.floor(words.length / 2)].start
    const parts = selected.text.trim().split(/\s+/)
    const midpoint = Math.max(1, Math.ceil(parts.length / 2))
    const first: LyricSegment = { ...selected, text: parts.slice(0, midpoint).join(' '), end: splitAt, words: words.filter((word) => word.end <= splitAt) }
    const second: LyricSegment = { ...selected, id: makeId(), text: parts.slice(midpoint).join(' ') || parts.at(-1) || '', start: splitAt, words: words.filter((word) => word.start >= splitAt), needsReview: true }
    dispatch({ type: 'set-segments', segments: [...project.segments.filter((item) => item.id !== selected.id), first, second].sort((a, b) => a.start - b.start) })
    setSelectedId(second.id)
  }

  function mergeSelected() {
    if (!selected) return
    const ordered = [...project.segments].sort((a, b) => a.start - b.start)
    const index = ordered.findIndex((item) => item.id === selected.id)
    const neighbor = ordered[index + 1] ?? ordered[index - 1]
    if (!neighbor) return notify('Cần thêm một dòng kế bên để gộp.')
    const earlier = selected.start <= neighbor.start ? selected : neighbor
    const later = earlier.id === selected.id ? neighbor : selected
    const merged: LyricSegment = { ...earlier, text: `${earlier.text.trim()} ${later.text.trim()}`.trim(), start: Math.min(earlier.start, later.start), end: Math.max(earlier.end, later.end), words: [...earlier.words, ...later.words].sort((a, b) => a.start - b.start), needsReview: earlier.needsReview || later.needsReview }
    dispatch({ type: 'set-segments', segments: [...project.segments.filter((item) => item.id !== earlier.id && item.id !== later.id), merged].sort((a, b) => a.start - b.start) })
    setSelectedId(merged.id)
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, segment: LyricSegment, edge: DragState['edge']) {
    event.preventDefault()
    event.stopPropagation()
    setDrag({ id: segment.id, edge, startX: event.clientX, originalStart: segment.start, originalEnd: segment.end })
  }

  async function importProviderSettings() {
    if (!window.kara) return
    try {
      const loaded = await window.kara.loadProviderSettings()
      setProviderProfile(loaded.profile)
      setApiKeyPresent(loaded.apiKeyPresent)
    } catch {
      notify('Không tải được cấu hình provider.')
    }
  }

  async function saveProviderSettings() {
    try {
      if (window.kara) await window.kara.saveProviderSettings(providerProfile, apiKey)
      else if (providerProfile.kind !== 'mock') throw new Error('API bên thứ ba chỉ chạy trong ứng dụng desktop.')
      dispatch({ type: 'set-provider', provider: providerProfile })
      setApiKeyPresent(apiKey.trim() ? true : apiKeyPresent)
      setApiKey('')
      setModal(null)
      notify('Cấu hình provider đã lưu trên máy này.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thể lưu cấu hình provider.')
    }
  }

  async function transcribe() {
    if (busy) return
    setBusy(true)
    try {
      let transcript: NormalizedTranscript
      const lyricsText = lyricsRaw || project.segments.map((segment) => segment.text).join('\n')
      if (providerProfile.kind === 'mock') {
        const mockLines = lyricsRaw ? parseLyrics(lyricsRaw, lyricsAsset?.displayName) : project.segments.map((segment) => ({ text: segment.text, start: segment.start, end: segment.end }))
        const words = mockLines.flatMap((line, index) => {
          const text = line.text.trim()
          if (!text) return []
          const start = line.start ?? index * 3.2
          const end = line.end ?? start + Math.max(2.2, text.split(/\s+/).length * 0.48)
          const tokens = text.split(/\s+/)
          const span = (end - start) / tokens.length
          return [{ id: makeId(), text, start, end, speakerId: index % 2 ? 'speaker_1' : 'speaker_0', confidence: 0.5, words: tokens.map((word, wordIndex) => ({ id: makeId(), text: word, start: start + wordIndex * span, end: start + (wordIndex + 1) * span, confidence: 0.5 })) }]
        })
        transcript = { segments: words }
      } else {
        if (!window.kara) throw new Error('Provider cloud chỉ chạy trong ứng dụng desktop.')
        if (!fullAsset) throw new Error('Hãy nhập bản đầy đủ trước khi gửi audio nhận dạng.')
        transcript = await window.kara.transcribe(providerProfile, fullAsset.path, lyricsText)
      }
      const lines = lyricsRaw ? parseLyrics(lyricsRaw, lyricsAsset?.displayName) : []
      const nextSegments = lines.length ? alignLyrics(lines, transcript) : transcript.segments.map((segment) => ({ ...segment, speakerRole: segment.speakerId?.includes('1') ? 'female' as const : segment.speakerId ? 'male' as const : 'unknown' as const, providerSpeakerId: segment.speakerId, needsReview: (segment.confidence ?? 1) < 0.68 }))
      dispatch({ type: 'set-segments', segments: nextSegments })
      setSelectedId(nextSegments[0]?.id ?? '')
      notify(`${nextSegments.length} dòng đã sẵn sàng chỉnh sửa.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Nhận dạng không thành công.')
    } finally {
      setBusy(false)
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
    if (!renderAsset) {
      setModal('render')
      setRenderState({ jobId: '', status: 'error', percent: 0, message: '', error: 'Hãy nhập bản đầy đủ hoặc beat trước khi render.' })
      return
    }
    const jobId = `render-${makeId()}`
    const renderDuration = Math.max(renderAsset.duration ?? 0, renderAsset.id === activeAsset?.id ? duration : 0, ...sortedSegments.map((segment) => segment.end), 0)
    if (!renderDuration) {
      setModal('render')
      setRenderState({ jobId: '', status: 'error', percent: 0, message: '', error: 'Chưa xác định được thời lượng audio. Hãy phát audio hoặc thêm timing lời trước khi render.' })
      return
    }
    const request: RenderRequest = {
      jobId,
      audioPath: renderAsset.path,
      backgroundPath: backgroundAsset?.path,
      assContent: buildAss(sortedSegments, project.exportOptions, videoSettings),
      duration: renderDuration,
      video: videoSettings,
    }
    cancelRenderRef.current = false
    setModal('render')
    setRenderState({ jobId, status: 'running', percent: 0, message: 'Đang chuẩn bị render…' })
    try {
      const result = await window.kara.startRender(request)
      if (cancelRenderRef.current || !result) {
        setRenderState((current) => current.jobId === jobId ? { ...current, status: 'canceled', message: 'Đã hủy render.' } : current)
        return
      }
      const outputUrl = await window.kara.getMediaUrl(result.path)
      setRenderState((current) => current.jobId === jobId ? { ...current, status: 'done', percent: 100, message: 'Video đã render xong.', outputPath: result.path, outputUrl } : current)
    } catch (error) {
      if (cancelRenderRef.current) {
        setRenderState((current) => current.jobId === jobId ? { ...current, status: 'canceled', message: 'Đã hủy render.' } : current)
      } else {
        setRenderState((current) => current.jobId === jobId ? { ...current, status: 'error', message: '', error: error instanceof Error ? error.message : 'Không thể render video.' } : current)
      }
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
    if (event.key === 'ArrowLeft') seekTo(position - (event.shiftKey ? 1 : 0.1))
    if (event.key === 'ArrowRight') seekTo(position + (event.shiftKey ? 1 : 0.1))
  }

  const rulerStyle = (segment: LyricSegment): CSSProperties => ({
    left: `${segment.start / maxTime * 100}%`,
    width: `${Math.max(0.8, (segment.end - segment.start) / maxTime * 100)}%`,
    '--speaker-color': SPEAKER_COLORS[segment.speakerRole],
  } as CSSProperties)

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
          <button className="icon-button" title="Hoàn tác (Ctrl+Z)" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}><Icon name="undo" /></button>
          <button className="icon-button" title="Làm lại (Ctrl+Shift+Z)" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}><Icon name="redo" /></button>
          <span className="topbar-divider" />
          <button className="button button-quiet" onClick={() => setModal('provider')}><Icon name="settings" size={16} /><span>Provider</span><span className={`connection-dot ${providerProfile.kind !== 'mock' && apiKeyPresent ? 'is-connected' : ''}`} /></button>
          <button className="button button-quiet" onClick={() => void saveProject()}><Icon name="save" size={16} /><span>Lưu</span></button>
          <button className="button button-quiet render-launch" onClick={() => setModal('render')} disabled={renderState.status === 'running' || renderState.status === 'canceling'}><Icon name="video" size={16} /><span>Render video</span></button>
          <button className="button button-accent" onClick={() => { updateExportPreview(); setModal('export') }}><Icon name="export" size={16} /><span>Xuất lời</span></button>
        </div>
      </header>

      <main className="workspace">
        <aside className="source-rail">
          <div className="rail-heading"><span>NGUỒN</span><button className="tiny-icon" aria-label="Thêm nguồn" onClick={() => void loadMedia('full')}><Icon name="plus" size={15} /></button></div>
          <div className="source-group-label">ÂM THANH</div>
          <SourceCard kind="full" asset={fullAsset} active={activeKind === 'full'} onSelect={() => { setActiveKind('full'); if (fullAsset) setAudioError('') }} onAdd={() => void loadMedia('full')} />
          <SourceCard kind="beat" asset={beatAsset} active={activeKind === 'beat'} onSelect={() => { setActiveKind('beat'); if (beatAsset) setAudioError('') }} onAdd={() => void loadMedia('beat')} />
          <div className="source-group-label video-label">HÌNH NỀN</div>
          <button className={`lyrics-source background-source ${backgroundAsset ? 'has-file' : ''}`} onClick={() => void loadMedia('background')}>
            <span className="source-icon background-icon"><Icon name="video" /></span>
            <span className="source-info"><strong>{backgroundAsset?.displayName ?? 'Nhập video nền'}</strong><small>{backgroundAsset ? 'Dùng cho preview và render' : 'MP4 · MOV · MKV · WebM · AVI · M4V'}</small></span>
            {backgroundAsset ? <Icon name="check" size={15} /> : <Icon name="plus" size={15} />}
          </button>
          <div className="source-group-label lyrics-label">LỜI BÀI HÁT <span>{project.segments.length || '—'}</span></div>
          <button className={`lyrics-source ${lyricsAsset ? 'has-file' : ''}`} onClick={() => void loadMedia('lyrics')}>
            <span className="source-icon lyrics-icon"><Icon name="lyrics" /></span>
            <span className="source-info"><strong>{lyricsAsset?.displayName ?? 'Nhập lời bài hát'}</strong><small>{lyricsAsset ? 'Đã liên kết với timeline' : 'TXT · LRC · SRT · ASS'}</small></span>
            {lyricsAsset ? <Icon name="check" size={15} /> : <Icon name="plus" size={15} />}
          </button>
          <div className="source-spacer" />
          <div className="provider-mini">
            <span className="provider-mini-icon"><Icon name="mic" size={15} /></span>
            <div><small>NHẬN DẠNG</small><strong>{providerProfile.kind === 'mock' ? 'Demo offline' : providerProfile.kind === 'deepgram' ? 'Deepgram' : 'Custom API'}</strong></div>
            <button className="tiny-icon" title="Cấu hình" onClick={() => setModal('provider')}><Icon name="more" size={17} /></button>
          </div>
        </aside>

        <section className="editor-column">
          <section className="transport-panel">
            <div className="transport-topline">
              <div className="transport-current">
                <span className={`track-indicator ${activeKind}`}><Icon name="music" size={14} /></span>
                <div><strong>{activeAsset?.displayName ?? 'Chưa có audio'}</strong><small>{activeAsset ? activeKind === 'full' ? 'BẢN ĐẦY ĐỦ' : 'BEAT / INSTRUMENTAL' : 'Nhập audio để nghe và căn lời'}</small></div>
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
                <div className="wave-bars" aria-hidden="true">{Array.from({ length: 188 }, (_, index) => {
                  const value = (Math.sin(index * 1.37) * 0.28 + Math.cos(index * 0.37) * 0.21 + Math.sin(index * 0.09) * 0.25 + 0.48)
                  return <i key={index} style={{ height: `${Math.max(10, Math.min(96, value * 100))}%` }} />
                })}</div>
                <div className="wave-progress" style={{ width: `${position / maxTime * 100}%` }} />
                <div className="playhead" style={{ left: `${position / maxTime * 100}%` }}><span /></div>
                {!activeAsset && <div className="wave-empty-label">Nhập bản đầy đủ hoặc beat để hiển thị waveform</div>}
              </div>
              <div className="wave-footnote"><span><i className="legend-full" />{activeKind === 'full' ? 'Bản đầy đủ' : 'Beat đang nghe'}</span><button onClick={() => setActiveKind(activeKind === 'full' ? 'beat' : 'full')} disabled={!fullAsset && !beatAsset}>Đổi track <span>⇄</span></button></div>
            </div>
            {audioError && <div className="audio-error"><Icon name="warning" size={14} />{audioError}</div>}
            {activeAsset?.url && <audio ref={audioRef} src={activeAsset.url} onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration || 0); setAudioError('') }} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)} onError={() => setAudioError('Không đọc được audio. Hãy thử MP3, WAV, M4A, FLAC hoặc OGG.')} />}
          </section>

          <VideoPreview
            segments={sortedSegments}
            time={position}
            audioAvailable={Boolean(activeAsset?.url)}
            settings={videoSettings}
            backgroundUrl={previewBackgroundUrl}
            playing={playing}
            onPositionChange={setLyricPosition}
          />

          <div className="timeline-heading">
            <div><div className="section-title">Lời & thời gian</div><p>Kéo mép dòng để căn nhịp · chọn một dòng để sửa</p></div>
            <div className="timeline-actions">
              <span className="review-status"><span className="review-dot" />{completedCount}/{project.segments.length} đã rà soát</span>
              <button className="button button-quiet button-small" onClick={() => void transcribe()} disabled={busy}><Icon name="mic" size={15} />{busy ? 'Đang xử lý…' : providerProfile.kind === 'mock' ? 'Tạo timing demo' : 'Nhận dạng audio'}</button>
              <button className="button button-small button-add" onClick={addSegment}><Icon name="plus" size={15} />Dòng lời</button>
            </div>
          </div>

          <div className="timeline-column-labels"><span>LỜI</span><div ref={rulerRef} className="ruler-header"><span>00:00</span><span>{formatClock(maxTime * 0.25)}</span><span>{formatClock(maxTime * 0.5)}</span><span>{formatClock(maxTime * 0.75)}</span><span>{formatClock(maxTime)}</span></div><span>NGƯỜI HÁT</span></div>
          <div className="segment-list">
            {sortedSegments.map((segment, index) => (
              <div className={`segment-row ${selected?.id === segment.id ? 'is-selected' : ''}`} key={segment.id} onClick={() => { setSelectedId(segment.id); seekTo(segment.start) }}>
                <div className="segment-lyric-cell">
                  <span className="segment-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="segment-copy"><strong>{segment.text}</strong><small>{formatClock(segment.start)} <span>–</span> {formatClock(segment.end)}</small></span>
                  {segment.needsReview && <span className="needs-review-mark" title="Cần nghe lại">•</span>}
                </div>
                <div className="segment-ruler" onPointerDown={(event) => {
                  const target = event.target as HTMLElement
                  if (target.closest('.segment-handle')) return
                  const bounds = event.currentTarget.getBoundingClientRect()
                  seekTo((event.clientX - bounds.left) / bounds.width * maxTime)
                }}>
                  <div className="ruler-grid"><i /><i /><i /><i /></div>
                  <div className={`segment-block role-${segment.speakerRole} ${selected?.id === segment.id ? 'active' : ''}`} style={rulerStyle(segment)}>
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

        <aside className="inspector">
          <div className="inspector-heading"><div><span>THUỘC TÍNH</span><strong>{selected ? `Dòng ${String(sortedSegments.findIndex((item) => item.id === selected.id) + 1).padStart(2, '0')}` : 'Chưa chọn dòng'}</strong></div><button className="tiny-icon" title="Xóa dòng" disabled={!selected} onClick={() => {
            if (!selected) return
            dispatch({ type: 'delete-segment', id: selected.id })
            const next = sortedSegments.find((item) => item.id !== selected.id)
            setSelectedId(next?.id ?? '')
          }}><Icon name="trash" size={16} /></button></div>
          {selected ? <>
            <section className="inspector-section">
              <label className="field-label" htmlFor="segment-text">Nội dung</label>
              <textarea id="segment-text" className="lyric-textarea" value={selected.text} rows={3} onChange={(event) => changeSegment(selected.id, { text: event.target.value })} />
            </section>
            <section className="inspector-section time-section">
              <div className="field-label">Thời gian <span>hh:mm:ss.ms</span></div>
              <div className="time-fields">
                <label><small>BẮT ĐẦU</small><input value={formatTimecode(selected.start)} onChange={(event) => updateTimeField(selected.id, 'start', event.target.value)} onBlur={(event) => {
                  const value = parseTimecode(event.target.value)
                  if (value !== null) changeSegment(selected.id, { start: Math.max(0, Math.min(value, selected.end - 0.05)), words: [] })
                }} /></label>
                <span className="time-dash">—</span>
                <label><small>KẾT THÚC</small><input value={formatTimecode(selected.end)} onChange={(event) => updateTimeField(selected.id, 'end', event.target.value)} onBlur={(event) => {
                  const value = parseTimecode(event.target.value)
                  if (value !== null) changeSegment(selected.id, { end: Math.max(selected.start + 0.05, value), words: [] })
                }} /></label>
              </div>
              <div className="nudge-row"><button onClick={() => changeSegment(selected.id, { start: Math.max(0, selected.start - 0.05), end: Math.max(selected.start + 0.05, selected.end - 0.05), words: [] })}>− 50 ms</button><button onClick={() => changeSegment(selected.id, { start: selected.start + 0.05, end: selected.end + 0.05, words: [] })}>+ 50 ms</button><button onClick={() => seekTo(selected.start)}>Nghe từ đầu</button></div>
            </section>
            <section className="inspector-section">
              <div className="field-label">Người hát</div>
              <div className="role-picker">{(['male', 'female', 'duet', 'unknown'] as SpeakerRole[]).map((role) => <button key={role} className={`role-choice role-${role} ${selected.speakerRole === role ? 'chosen' : ''}`} onClick={() => changeSegment(selected.id, { speakerRole: role })}><i />{roleLabels[role]}</button>)}</div>
              {selected.providerSpeakerId && <div className="speaker-origin">API gán: <strong>{selected.providerSpeakerId}</strong></div>}
            </section>
            <section className="inspector-section word-section">
              <div className="field-label">Timing từng từ <span>{selected.words.length || '—'}</span></div>
              {selected.words.length ? <div className="word-list">{selected.words.map((word, index) => <button className="word-chip" key={word.id} title={`${formatTimecode(word.start)} – ${formatTimecode(word.end)}`} onClick={() => seekTo(word.start)}><span>{word.text}</span><small>{formatClock(word.start)}</small>{word.confidence !== undefined && <i style={{ opacity: Math.max(0.3, word.confidence) }} />}</button>)}</div> : <div className="word-empty">Chưa có timing cấp từ.<br />Chạy nhận dạng hoặc chỉnh mốc dòng bên trên.</div>}
            </section>
            <section className="inspector-section quality-section">
              <div className="quality-label"><span>ĐỘ TIN CẬY</span><strong>{selected.confidence === undefined ? 'Chưa có dữ liệu' : `${Math.round(selected.confidence * 100)}%`}</strong></div>
              <div className="confidence-track"><i style={{ width: `${Math.max(0, Math.min(100, (selected.confidence ?? 0) * 100))}%`, background: selected.confidence !== undefined && selected.confidence < 0.65 ? '#f1b365' : '#58dfb1' }} /></div>
              <span className="quality-note">{selected.needsReview ? 'Đánh dấu để nghe lại và xác nhận.' : 'Timing đã được rà soát.'}</span>
            </section>
            <div className="inspector-actions"><button className="button button-quiet" onClick={splitSelected}><Icon name="split" size={15} />Tách dòng</button><button className="button button-quiet" onClick={mergeSelected}><Icon name="merge" size={15} />Gộp kế</button></div>
          </> : <div className="inspector-empty">Chọn một dòng lời trong timeline để chỉnh.</div>}
        </aside>
      </main>

      <footer className="statusbar"><div><span className="status-ready"><i />Sẵn sàng</span><span className="status-divider" />{project.assets.length} nguồn liên kết<span className="status-divider" />{currentPath ? currentPath.split(/[\\/]/).pop() : 'Project chưa lưu'}</div><div><span>LOCALE</span><strong>VI</strong><span className="status-divider" />Kara Studio · Beta</div></footer>

      <input ref={inputRef} className="visually-hidden" type="file" accept="audio/*,video/*,.txt,.lrc,.srt,.ass,.ssa,.mp4,.mov,.mkv,.webm,.avi,.m4v" onChange={(event) => void onBrowserFile(event)} />

      {modal === 'provider' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}>
        <section className="dialog provider-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-title">
          <div className="dialog-heading"><div><span className="dialog-icon"><Icon name="mic" /></span><div><h2 id="provider-title">Cấu hình nhận dạng</h2><p>Chọn dịch vụ nhận lời và timing từ audio.</p></div></div><button className="tiny-icon" onClick={() => setModal(null)} aria-label="Đóng"><Icon name="close" /></button></div>
          <div className="dialog-body">
            <label className="field-label" htmlFor="provider-kind">Dịch vụ</label>
            <div className="provider-options">
              {([{ kind: 'mock', label: 'Demo offline', detail: 'Tạo timing mẫu, không gửi audio' }, { kind: 'deepgram', label: 'Deepgram', detail: 'Word timing và speaker diarization' }, { kind: 'custom', label: 'API tương thích', detail: 'Endpoint trả JSON đã chuẩn hóa' }] as Array<{ kind: ProviderKind; label: string; detail: string }>).map((option) => <button key={option.kind} className={`provider-option ${providerProfile.kind === option.kind ? 'active' : ''}`} onClick={() => setProviderProfile({ ...providerProfile, kind: option.kind })}><span className="provider-radio" /><span><strong>{option.label}</strong><small>{option.detail}</small></span></button>)}
            </div>
            {providerProfile.kind !== 'mock' && <>
              <label className="field-label" htmlFor="provider-endpoint">Endpoint</label>
              <input id="provider-endpoint" className="text-input" value={providerProfile.endpoint} onChange={(event) => setProviderProfile({ ...providerProfile, endpoint: event.target.value })} placeholder="https://api.example.com/v1/listen" />
              <div className="form-grid"><label><span className="field-label">Model</span><input className="text-input" value={providerProfile.model} onChange={(event) => setProviderProfile({ ...providerProfile, model: event.target.value })} /></label><label><span className="field-label">Ngôn ngữ</span><input className="text-input" value={providerProfile.language} onChange={(event) => setProviderProfile({ ...providerProfile, language: event.target.value })} /></label></div>
              {providerProfile.kind === 'custom' && <><label className="field-label" htmlFor="segments-path">JSON path tới segments</label><input id="segments-path" className="text-input" value={providerProfile.customSegmentsPath ?? 'segments'} onChange={(event) => setProviderProfile({ ...providerProfile, customSegmentsPath: event.target.value })} /><p className="form-hint">Mỗi segment cần <code>text</code>, <code>start</code>, <code>end</code>, có thể có <code>speaker</code> và <code>words[]</code>. API nhận audio thô qua POST.</p></>}
              <label className="field-label" htmlFor="provider-key">API key <span>{apiKeyPresent ? 'Đã lưu bảo mật trên máy này' : 'Chưa lưu'}</span></label>
              <input id="provider-key" className="text-input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={apiKeyPresent ? 'Để trống để giữ key đã lưu' : 'Dán API key'} autoComplete="new-password" />
              <label className="toggle-row"><input type="checkbox" checked={providerProfile.diarize} onChange={(event) => setProviderProfile({ ...providerProfile, diarize: event.target.checked })} /><span className="toggle-switch" /><span><strong>Nhận diện người nói</strong><small>Chỉ bật nếu provider hỗ trợ diarization</small></span></label>
              <div className="security-note"><Icon name="check" size={14} /><span>API key được mã hóa trong app data; không nằm trong file project.</span></div>
            </>}
            {providerProfile.kind === 'mock' && <div className="mock-note"><span className="mock-spark">✳</span><div><strong>Chỉnh lời mà không cần API</strong><p>Demo tạo mốc từ lời hiện có, để bạn thử timeline offline. Đây không phải kết quả nhận dạng giọng thật.</p></div></div>}
            {!window.kara && providerProfile.kind !== 'mock' && <div className="warning-note">Chạy trong desktop app để gửi audio an toàn; browser preview chỉ dùng được Demo offline.</div>}
          </div>
          <div className="dialog-footer"><button className="button button-quiet" onClick={() => { setModal(null); setApiKey('') }}>Hủy</button><button className="button button-accent" onClick={() => void saveProviderSettings()}>Lưu cấu hình</button></div>
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
            <div className="render-summary"><div><span>Nguồn audio</span><strong>{renderAsset?.displayName ?? 'Chưa có audio'}</strong><small>{fullAsset ? 'Ưu tiên bản đầy đủ' : beatAsset ? 'Dùng beat thay thế' : 'Nhập một file audio'}</small></div><div><span>Hình nền</span><strong>{backgroundAsset?.displayName ?? 'Màu nền'}</strong><small>{backgroundAsset ? `Video lặp theo audio · padding ${videoSettings.backgroundColor}` : videoSettings.backgroundColor}</small></div><div><span>Khung hình</span><strong>{videoSettings.width} × {videoSettings.height}</strong><small>Vị trí lời {Math.round(videoSettings.lyricPosition.x * 100)}% · {Math.round(videoSettings.lyricPosition.y * 100)}%</small></div></div>
            {(renderState.status === 'running' || renderState.status === 'canceling') && <div className="render-progress-panel"><div className="render-progress-heading"><strong>{renderState.status === 'canceling' ? 'Đang hủy…' : 'Đang render video'}</strong><span>{renderState.percent}%</span></div><div className="render-progress-track"><i style={{ width: `${Math.max(0, Math.min(100, renderState.percent))}%` }} /></div><p>{renderState.message || 'Đang chuẩn bị…'}</p></div>}
            {renderState.status === 'error' && <div className="render-error"><Icon name="warning" size={17} /><div><strong>Không thể render video</strong><p>{renderState.error}</p></div></div>}
            {renderState.status === 'canceled' && <div className="render-canceled"><strong>Render đã hủy</strong><p>File tạm đã được dọn dẹp; project và timing của bạn vẫn giữ nguyên.</p></div>}
            {renderState.status === 'done' && renderState.outputUrl && <div className="render-result"><div className="render-result-heading"><div><strong>Video đã sẵn sàng</strong><span>{renderState.outputPath?.split(/[\\/]/).pop()}</span></div><span className="render-complete-mark"><Icon name="check" size={14} /></span></div><video className="render-result-video" controls preload="metadata" src={renderState.outputUrl}>Trình duyệt không hỗ trợ phát video.</video></div>}
            {renderState.status === 'idle' && <p className="render-help">Kara Studio sẽ dùng bản đầy đủ nếu có; nếu không, app sẽ render bằng beat. Subtitle ASS được tạo từ timing hiện tại và vị trí chữ đang lưu.</p>}
          </div>
          <div className="dialog-footer render-dialog-footer">{renderState.status === 'done' || renderState.status === 'error' || renderState.status === 'canceled' ? <button className="button button-quiet" onClick={resetRender}>Render lại</button> : null}<button className="button button-quiet" onClick={() => { if (renderState.status !== 'running' && renderState.status !== 'canceling') setModal(null) }} disabled={renderState.status === 'running' || renderState.status === 'canceling'}>{renderState.status === 'done' ? 'Đóng' : 'Hủy'}</button>{renderState.status === 'running' || renderState.status === 'canceling' ? <button className="button button-danger" onClick={() => void cancelRender()} disabled={renderState.status === 'canceling'}>Hủy render</button> : renderState.status !== 'done' && <button className="button button-accent" onClick={() => void startRender()} disabled={!window.kara || !renderAsset}>Bắt đầu render</button>}</div>
        </section>
      </div>}
      {toast && <div className="toast"><Icon name="check" size={15} />{toast}</div>}
    </div>
  )
}

function SourceCard({ kind, asset, active, onSelect, onAdd }: { kind: 'full' | 'beat'; asset?: MediaAsset; active: boolean; onSelect: () => void; onAdd: () => void }) {
  const label = kind === 'full' ? 'Bản đầy đủ' : 'Beat / instrumental'
  return <button className={`source-card ${active ? 'is-active' : ''} ${asset ? 'has-asset' : ''}`} onClick={asset ? onSelect : onAdd}>
    <span className={`source-icon ${kind}`}><Icon name="music" /></span>
    <span className="source-info"><strong>{asset?.displayName ?? label}</strong><small>{asset ? `${label}${asset.duration ? ` · ${formatClock(asset.duration)}` : ''}` : 'Chưa thêm audio'}</small></span>
    {asset ? <span className="active-track-marker">{active ? <i /> : <span />}</span> : <span className="source-add"><Icon name="plus" size={15} /></span>}
  </button>
}

export default App
