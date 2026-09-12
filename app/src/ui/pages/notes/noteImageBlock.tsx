import { defaultBlockSpecs } from '@blocknote/core'
import { createReactBlockSpec } from '@blocknote/react'
import { ImagePlus, Pencil, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'

interface ImageProperties {
  url: string
  name: string
  caption: string
  alt: string
  previewWidth: number | undefined
  crop: 'original' | 'square' | 'landscape' | 'portrait'
  focalX: number
  focalY: number
}

interface ImageEditor {
  isEditable: boolean
  uploadFile: ((file: File, blockId?: string) => Promise<string | Record<string, string>>) | undefined
  resolveFileUrl?: (url: string) => Promise<string>
  updateBlock: (id: string, update: { props: Partial<ImageProperties> }) => void
}

const CROP_OPTIONS = [
  { value: 'original', label: 'Original' },
  { value: 'square', label: 'Square' },
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' }
] as const

function isImageCrop(value: string): value is ImageProperties['crop'] {
  return CROP_OPTIONS.some((option) => option.value === value)
}

function imageStyle(props: ImageProperties): CSSProperties {
  const ratios = { original: 'auto', square: '1', landscape: '16 / 9', portrait: '3 / 4' }
  return {
    width: props.previewWidth ?? '100%', maxWidth: '100%',
    aspectRatio: ratios[props.crop], objectFit: 'cover',
    objectPosition: `${props.focalX}% ${props.focalY}%`
  }
}

function imagePreviewStyle(props: ImageProperties): CSSProperties {
  const ratios = { original: 'auto', square: '1', landscape: '16 / 9', portrait: '3 / 4' }
  return {
    aspectRatio: ratios[props.crop], objectFit: 'cover',
    objectPosition: `${props.focalX}% ${props.focalY}%`
  }
}

function ImageView({ id, props, editor }: { id: string; props: ImageProperties; editor: ImageEditor }): ReactNode {
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props)
  const [link, setLink] = useState('')
  useEffect(() => {
    let active = true
    setSource('')
    if (props.url === '') return
    const resolve = editor.resolveFileUrl === undefined ? Promise.resolve(props.url) : editor.resolveFileUrl(props.url)
    void resolve.then((url) => { if (active) { setSource(url); setError(null) } },
      (failure: Error) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [editor, props.url])

  const upload = async (file: File): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (editor.uploadFile === undefined) throw new Error('Image uploads are unavailable in this editor')
      const result = await editor.uploadFile(file, id)
      if (typeof result !== 'string') throw new TypeError('Image upload did not return its stable attachment URL')
      editor.updateBlock(id, { props: { url: result, name: file.name } })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <figure className="note-image" contentEditable={false}>
      {props.url === '' && !editor.isEditable ? <p>Empty image</p> : props.url === '' ? <div className="note-image-empty"><ImagePlus size={20} />
        <label className="note-image-upload">{busy ? 'Uploading…' : 'Upload image'}<input type="file" accept="image/*" disabled={busy}
          onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void upload(file) }} /></label>
        <form onSubmit={(event) => {
          event.preventDefault()
          try {
            const url = new URL(link)
            if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('Use an https:// or http:// image address')
            editor.updateBlock(id, { props: { url: url.toString() } })
            setError(null)
          } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
        }}><input aria-label="Image URL" value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste an image link" /><button type="submit">Add</button></form>
      </div> : <>
        {source !== '' ? <img src={source} alt={props.alt} style={imageStyle(props)} draggable={false}
          onError={() => setError('This image could not load. Check its link or replace the file.')} /> : <p>Loading image…</p>}
        {editor.isEditable ? <button type="button" className="note-image-edit" aria-label="Edit image" onClick={() => { setDraft(props); setEditing(true) }}><Pencil size={14} /></button> : null}
        {props.caption !== '' ? <figcaption>{props.caption}</figcaption> : null}
      </>}
      {error !== null ? <p className="note-media-error" role="alert">{error}</p> : null}
      <Modal open={editing} onClose={() => setEditing(false)} width={560} ariaLabel="Edit image">
        <form className="notes-dialog note-image-dialog" onSubmit={(event) => { event.preventDefault(); editor.updateBlock(id, { props: draft }); setEditing(false) }}>
          <div className="notes-dialog-head"><h2>Image</h2><button type="button" aria-label="Close image settings" onClick={() => setEditing(false)}><X size={17} /></button></div>
          <div className="note-image-dialog-body">
            {source !== '' ? <div className="note-image-preview-frame" data-crop={draft.crop}><img className="note-image-crop-preview" src={source} alt={draft.alt} style={imagePreviewStyle(draft)} /></div> : null}
            <div className="note-image-properties">
              <label className="is-wide">Alt text<input value={draft.alt} maxLength={2000} onChange={(event) => setDraft({ ...draft, alt: event.target.value })} /></label>
              <label className="is-wide">Caption<input value={draft.caption} maxLength={2000} onChange={(event) => setDraft({ ...draft, caption: event.target.value })} /></label>
              <label>Width<input type="number" min={80} max={1600} value={draft.previewWidth ?? 640} onChange={(event) => setDraft({ ...draft, previewWidth: Number(event.target.value) })} /></label>
              <label>Crop<Select value={draft.crop} options={CROP_OPTIONS} placeholder="Choose a crop" ariaLabel="Image crop"
                onChange={(crop) => { if (isImageCrop(crop)) setDraft({ ...draft, crop }) }} /></label>
              {draft.crop !== 'original' ? <>
                <label>Horizontal position<input type="range" min={0} max={100} value={draft.focalX} onChange={(event) => setDraft({ ...draft, focalX: Number(event.target.value) })} /></label>
                <label>Vertical position<input type="range" min={0} max={100} value={draft.focalY} onChange={(event) => setDraft({ ...draft, focalY: Number(event.target.value) })} /></label>
              </> : null}
              <label className="is-wide">Replace image<input type="file" accept="image/*" disabled={busy} onChange={(event) => {
                const file = event.target.files?.[0]
                if (file !== undefined) { setEditing(false); void upload(file) }
              }} /></label>
            </div>
          </div>
          <div className="notes-dialog-actions"><button type="button" onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="is-primary">Save</button></div>
        </form>
      </Modal>
    </figure>
  )
}

export const noteImageBlock = createReactBlockSpec({
  type: 'image',
  propSchema: {
    ...defaultBlockSpecs.image.config.propSchema,
    alt: { default: '' },
    crop: { default: 'original', values: ['original', 'square', 'landscape', 'portrait'] as const },
    focalX: { default: 50 }, focalY: { default: 50 }
  }, content: 'none'
}, {
  meta: { fileBlockAccept: ['image/*'] },
  render: ({ block, editor }): ReactNode => <ImageView id={block.id} props={block.props} editor={editor as unknown as ImageEditor} />,
  parse: (element) => {
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
    if (image === null) return undefined
    return { url: image.getAttribute('src') ?? '', alt: image.alt,
      caption: element.querySelector('figcaption')?.textContent ?? '', previewWidth: image.width || undefined }
  },
  toExternalHTML: ({ block }): ReactNode => <figure><img src={block.props.url} alt={block.props.alt} style={imageStyle(block.props)} />
    {block.props.caption !== '' ? <figcaption>{block.props.caption}</figcaption> : null}</figure>
})()
