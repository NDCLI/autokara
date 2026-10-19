import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { DEFAULT_VIDEO_SETTINGS, SPEAKER_COLORS, type LyricSegment, type NormalizedPosition, type VideoSettings } from '../../shared/contracts'

const ROLE_PREFIX = { male: 'NAM', female: 'NỮ', duet: 'ĐỐI ĐÁP', unknown: '' } as const

type Props = {
  segments: LyricSegment[]
  time: number
  audioAvailable: boolean
  settings: VideoSettings
  backgroundUrl?: string
  playing: boolean
  onPositionChange: (position: NormalizedPosition) => void
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))

function syncBackgroundVideo(video: HTMLVideoElement | null, time: number, playing: boolean) {
  if (!video) return
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
  const target = duration ? time % duration : time
  if (Math.abs(video.currentTime - target) > 0.25) video.currentTime = target
  if (playing && video.paused) void video.play().catch(() => {})
  if (!playing && !video.paused) video.pause()
}

export default function VideoPreview({ segments, time, audioAvailable, settings, backgroundUrl, playing, onPositionChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const backgroundVideoRef = useRef<HTMLVideoElement>(null)
  const [dragPosition, setDragPosition] = useState<NormalizedPosition | null>(null)
  const [xDraft, setXDraft] = useState(String(Math.round(settings.lyricPosition.x * 100)))
  const [yDraft, setYDraft] = useState(String(Math.round(settings.lyricPosition.y * 100)))
  const position = dragPosition ?? settings.lyricPosition
  const activeSegment = useMemo(() => audioAvailable ? segments.find((segment) => time >= segment.start && time < segment.end) : undefined, [audioAvailable, segments, time])
  const wordIndex = activeSegment?.words.findIndex((word) => time >= word.start && time < word.end) ?? -1
  const style = { backgroundColor: settings.backgroundColor, aspectRatio: `${settings.width} / ${settings.height}` } as CSSProperties

  useEffect(() => {
    syncBackgroundVideo(backgroundVideoRef.current, time, playing)
  }, [backgroundUrl, playing, time])

  useEffect(() => {
    setXDraft(String(Math.round(settings.lyricPosition.x * 100)))
    setYDraft(String(Math.round(settings.lyricPosition.y * 100)))
  }, [settings.lyricPosition.x, settings.lyricPosition.y])

  function pointerPosition(event: ReactPointerEvent<HTMLButtonElement>): NormalizedPosition | null {
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds || !bounds.width || !bounds.height) return null
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    }
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const next = pointerPosition(event)
    if (next) setDragPosition(next)
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const next = pointerPosition(event)
    if (next) setDragPosition(next)
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const next = pointerPosition(event) ?? dragPosition
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragPosition(null)
    if (next) onPositionChange(next)
  }

  function nudgePosition(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 0.05 : 0.01
    const next = { ...settings.lyricPosition }
    if (event.key === 'ArrowLeft') next.x = clamp(next.x - step)
    else if (event.key === 'ArrowRight') next.x = clamp(next.x + step)
    else if (event.key === 'ArrowUp') next.y = clamp(next.y - step)
    else if (event.key === 'ArrowDown') next.y = clamp(next.y + step)
    else return
    event.preventDefault()
    event.stopPropagation()
    onPositionChange(next)
  }

  function commitAxis(axis: 'x' | 'y', value: string) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    const next = { ...settings.lyricPosition, [axis]: clamp(parsed / 100) }
    onPositionChange(next)
    if (axis === 'x') setXDraft(String(Math.round(next.x * 100)))
    else setYDraft(String(Math.round(next.y * 100)))
  }

  function renderLyrics() {
    if (!activeSegment) return null
    const prefix = ROLE_PREFIX[activeSegment.speakerRole]
    return <>
      {prefix && <span className="karaoke-speaker-prefix">{prefix} </span>}
      {activeSegment.words.length ? activeSegment.words.map((word, index) => <span className={index === wordIndex ? 'karaoke-word is-current' : 'karaoke-word'} key={word.id}>{word.text}{index < activeSegment.words.length - 1 ? ' ' : ''}</span>) : activeSegment.text}
    </>
  }

  return <section className="video-preview-panel" aria-label="Xem trước video karaoke">
    <div className="video-preview-stage" ref={stageRef} style={style}>
      <div className="preview-safe-area" aria-hidden="true" />
      {backgroundUrl && <video className="preview-background-video" src={backgroundUrl} muted playsInline preload="metadata" ref={backgroundVideoRef} aria-hidden="true" />}
      {activeSegment ? <button
        type="button"
        className={`karaoke-lyric-anchor role-${activeSegment.speakerRole}`}
        style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%`, '--speaker-color': SPEAKER_COLORS[activeSegment.speakerRole] } as CSSProperties}
        aria-label={`Vị trí lời karaoke, ngang ${Math.round(position.x * 100)}%, dọc ${Math.round(position.y * 100)}%`}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={nudgePosition}
      >{renderLyrics()}</button> : <div className="preview-empty-state">
        <span>{audioAvailable ? 'KHUNG HÌNH HIỆN TẠI' : 'CHƯA CÓ AUDIO'}</span>
        <strong>{audioAvailable ? 'Chưa có dòng lời ở thời điểm này' : 'Nhập audio để xem lời theo nhịp'}</strong>
      </div>}
      <span className="preview-resolution">{settings.width} × {settings.height}</span>
    </div>
    <div className="video-position-controls">
      <div className="position-control-heading"><div><strong>Vị trí lời</strong><span>Điểm neo ở giữa khối chữ</span></div><button type="button" className="button button-small button-quiet" onClick={() => onPositionChange({ ...DEFAULT_VIDEO_SETTINGS.lyricPosition })}>Đặt lại</button></div>
      <label className="position-field"><span>Ngang <small>X</small></span><div><input type="number" min="0" max="100" step="1" aria-label="Vị trí ngang phần trăm" value={xDraft} onChange={(event) => setXDraft(event.target.value)} onBlur={() => commitAxis('x', xDraft)} onKeyDown={(event) => { if (event.key === 'Enter') { commitAxis('x', xDraft); event.currentTarget.blur() } }} /><span>%</span></div></label>
      <label className="position-field"><span>Dọc <small>Y</small></span><div><input type="number" min="0" max="100" step="1" aria-label="Vị trí dọc phần trăm" value={yDraft} onChange={(event) => setYDraft(event.target.value)} onBlur={() => commitAxis('y', yDraft)} onKeyDown={(event) => { if (event.key === 'Enter') { commitAxis('y', yDraft); event.currentTarget.blur() } }} /><span>%</span></div></label>
      <p className="position-hint">Kéo chữ để di chuyển. Chọn chữ rồi dùng phím mũi tên; giữ Shift để đi nhanh.</p>
    </div>
  </section>
}
