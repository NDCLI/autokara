import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

type WorkspaceResizeHandleProps = {
  label: string
  pane: 'source' | 'inspector'
  value: number
  minimum: number
  maximum: number
  defaultValue: number
  onResize: (value: number) => void
}

export function WorkspaceResizeHandle({ label, pane, value, minimum, maximum, defaultValue, onResize }: WorkspaceResizeHandleProps) {
  const dragging = useRef(false)

  function resizeFromPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragging.current) return
    const workspace = event.currentTarget.closest('.workspace')
    const bounds = workspace?.getBoundingClientRect()
    if (!bounds) return
    const width = pane === 'source' ? event.clientX - bounds.left : bounds.right - event.clientX
    onResize(Math.round(Math.max(minimum, Math.min(maximum, width))))
  }

  function resizeFromKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(defaultValue)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = pane === 'source' ? (event.key === 'ArrowRight' ? 1 : -1) : (event.key === 'ArrowLeft' ? 1 : -1)
    onResize(Math.max(minimum, Math.min(maximum, value + direction * (event.shiftKey ? 32 : 8))))
  }

  return <button
    type="button"
    className={`workspace-resize-handle ${pane}-resize-handle`}
    role="separator"
    aria-orientation="vertical"
    aria-label={label}
    aria-valuemin={minimum}
    aria-valuemax={maximum}
    aria-valuenow={value}
    title="Kéo để thay đổi chiều rộng · nhấp đúp hoặc nhấn Home để đặt lại"
    onDoubleClick={() => onResize(defaultValue)}
    onPointerDown={(event) => {
      dragging.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={resizeFromPointer}
    onPointerUp={(event) => {
      dragging.current = false
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onLostPointerCapture={() => { dragging.current = false }}
    onKeyDown={resizeFromKeyboard}
  />
}
