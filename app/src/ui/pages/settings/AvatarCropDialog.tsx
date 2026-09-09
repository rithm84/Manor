import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { Button, Modal } from '../../components/ui'

const VIEWPORT = 240
const EXPORT_SIZE = 512
const MAX_ZOOM = 3

interface Offset {
  x: number
  y: number
}

export interface AvatarCropDialogProps {
  open: boolean
  /** Object URL of the picked image file. */
  imageUrl: string | null
  saving: boolean
  onCancel: () => void
  /** Receives the cropped square as base64 JPEG. */
  onSave: (base64: string) => void
}

/** Cover-fit scale: the image always fills the square viewport. */
function baseScale(width: number, height: number): number {
  return Math.max(VIEWPORT / width, VIEWPORT / height)
}

function clampOffset(offset: Offset, width: number, height: number, scale: number): Offset {
  const maxX = Math.max(0, (width * scale - VIEWPORT) / 2)
  const maxY = Math.max(0, (height * scale - VIEWPORT) / 2)
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y))
  }
}

/**
 * Square crop over the picked image: drag repositions, the slider zooms,
 * and Save renders the circled region to a 512px JPEG for upload.
 */
export function AvatarCropDialog({
  open,
  imageUrl,
  saving,
  onCancel,
  onSave
}: AvatarCropDialogProps): ReactNode {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragFrom = useRef<{ pointer: Offset; offset: Offset } | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })

  useEffect(() => {
    setSize(null)
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }, [imageUrl])

  const scale = size === null ? 1 : baseScale(size.width, size.height) * zoom

  const rezoom = (nextZoom: number): void => {
    setZoom(nextZoom)
    if (size !== null) {
      const nextScale = baseScale(size.width, size.height) * nextZoom
      setOffset((current) => clampOffset(current, size.width, size.height, nextScale))
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragFrom.current = { pointer: { x: event.clientX, y: event.clientY }, offset }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const from = dragFrom.current
    if (from === null || size === null) return
    const next = {
      x: from.offset.x + (event.clientX - from.pointer.x),
      y: from.offset.y + (event.clientY - from.pointer.y)
    }
    setOffset(clampOffset(next, size.width, size.height, scale))
  }

  const onPointerUp = (): void => {
    dragFrom.current = null
  }

  const save = (): void => {
    const image = imageRef.current
    if (image === null || size === null) return
    const canvas = document.createElement('canvas')
    canvas.width = EXPORT_SIZE
    canvas.height = EXPORT_SIZE
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('Canvas 2D context is unavailable for cropping')
    }
    // Invert the viewport transform: which image region fills the square?
    const sourceSize = VIEWPORT / scale
    const sourceX = size.width / 2 - (VIEWPORT / 2 + offset.x) / scale
    const sourceY = size.height / 2 - (VIEWPORT / 2 + offset.y) / scale
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      EXPORT_SIZE,
      EXPORT_SIZE
    )
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    onSave(dataUrl.slice(dataUrl.indexOf(',') + 1))
  }

  return (
    <Modal open={open} onClose={saving ? () => undefined : onCancel} width={320} ariaLabel="Crop profile picture">
      <div className="avatar-crop">
        <h2 className="avatar-crop-title">Crop your picture</h2>
        <div
          className="avatar-crop-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {imageUrl !== null ? (
            <img
              ref={imageRef}
              className="avatar-crop-image"
              src={imageUrl}
              alt=""
              draggable={false}
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight
                })
              }
              style={{
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`
              }}
            />
          ) : null}
          <div className="avatar-crop-ring" aria-hidden="true" />
        </div>
        <input
          type="range"
          className="avatar-crop-zoom"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(event) => rezoom(Number(event.target.value))}
          aria-label="Zoom"
        />
        <div className="avatar-crop-actions">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || size === null}>
            {saving ? 'Saving' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
