import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { LyricSegment } from '../../shared/contracts'

type Props = {
  segment: LyricSegment
  disabled?: boolean
  onMove: (wordId: string, delta: number) => void
}

export default function WordTimingLane({ segment, disabled = false, onMove }: Props) {
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ wordId: string; pointerId: number; startX: number; delta: number } | null>(null)
  const [preview, setPreview] = useState<{ wordId: string; delta: number } | null>(null)
  const duration = Math.max(0.05, segment.end - segment.start)
  const words = [...segment.words].sort((a, b) => a.start - b.start || a.end - b.end)

  function start(event: ReactPointerEvent<HTMLButtonElement>, wordId: string) {
    const word = words.find((item) => item.id === wordId)
    if (disabled || !word || word.timingLocked || !laneRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { wordId, pointerId: event.pointerId, startX: event.clientX, delta: 0 }
  }

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    const width = laneRef.current?.getBoundingClientRect().width ?? 0
    if (!drag || drag.pointerId !== event.pointerId || width <= 0) return
    const delta = (event.clientX - drag.startX) / width * duration
    drag.delta = delta
    setPreview({ wordId: drag.wordId, delta })
  }

  function finish(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    setPreview(null)
    if (Math.abs(drag.delta) > 0.005) onMove(drag.wordId, drag.delta)
  }

  return <div className="word-timing-lane" ref={laneRef} aria-label="Timeline timing từng từ">
    {words.map((word) => {
      const left = (word.start - segment.start) / duration * 100
      const width = Math.max(1.2, (word.end - word.start) / duration * 100)
      const delta = preview?.wordId === word.id ? preview.delta : 0
      return <button
        type="button"
        key={word.id}
        className={`word-lane-block ${word.timingLocked ? 'is-locked' : ''}`}
        style={{ left: `calc(${left}% + ${delta / duration * 100}%)`, width: `${width}%` }}
        title={`${word.text} · ${word.start.toFixed(2)}–${word.end.toFixed(2)}s${word.timingLocked ? ' · đã khóa' : ' · kéo để dịch timing'}`}
        aria-label={`${word.text}, ${word.start.toFixed(2)} đến ${word.end.toFixed(2)} giây${word.timingLocked ? ', đã khóa' : ', kéo để dịch timing'}`}
        disabled={disabled || word.timingLocked}
        onPointerDown={(event) => start(event, word.id)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      ><span>{word.text}</span></button>
    })}
    {Array.from({ length: 3 }, (_, index) => <i key={index} className="word-lane-grid" style={{ left: `${(index + 1) * 25}%` }} />)}
  </div>
}
