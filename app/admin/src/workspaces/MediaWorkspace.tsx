import { Alert, Button, TextInput } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Search, Trash2, UploadCloud } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Media } from '@manifold/contracts'
import { formatDate } from '@manifold/render'
import { ApiError } from '@manifold/sdk'
import { createAdminClient } from '../api'
import { ConfirmButton } from '../components/ConfirmButton'
import { Pager } from '../components/Pager'

const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

export function MediaWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [copiedID, setCopiedID] = useState<string | null>(null)
  const copyTimer = useRef<number | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current) }, [])

  const list = useQuery({
    queryKey: ['admin-media', { q, page }],
    queryFn: () => client.listMedia({ q: q || undefined, page }),
  })
  const items = list.data?.data ?? []
  const totalPages = list.data?.pagination.totalPages ?? 1

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) await client.uploadMedia(file, file.name)
    },
    onSuccess: () => {
      setUploadError(null)
      setPage(1)
      void queryClient.invalidateQueries({ queryKey: ['admin-media'] })
    },
    onError: (error) => setUploadError(error instanceof ApiError ? `${error.message} (${error.code})` : 'Image upload failed.'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => client.deleteMedia(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-media'] }),
  })

  const startUpload = (files: File[]) => {
    const images = files.filter((file) => allowedImageTypes.has(file.type))
    if (!images.length) {
      setUploadError('Only PNG, JPEG, WebP, GIF and AVIF images are accepted.')
      return
    }
    upload.mutate(images)
  }
  const copyMarkdown = (media: Media) => {
    navigator.clipboard?.writeText(`![${media.filename}](${media.url})`).catch(() => {})
    setCopiedID(media.id)
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopiedID(null), 1600)
  }
  const changePage = (next: number) => {
    if (next < 1 || next > totalPages) return
    setPage(next)
  }

  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">Media</p><h1>Images stored beside the words.</h1><p className="subheading">Uploads live in Core and render inline on the public site.</p></div></div>
    <div className="content-toolbar">
      <TextInput
        leftSection={<Search size={14} />}
        placeholder="Search media"
        aria-label="Search media"
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <span className="content-toolbar-count">{list.data?.pagination.totalItems ?? items.length} images</span>
    </div>
    <div
      className={dragOver ? 'media-dropzone drag' : 'media-dropzone'}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { event.preventDefault(); setDragOver(false); startUpload(Array.from(event.dataTransfer.files)) }}
      role="button"
      tabIndex={0}
      aria-label="Upload images"
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click() } }}
    >
      <UploadCloud size={20} aria-hidden="true" />
      <span>Drop images here or click to upload — paste and drag also work inside the editor.</span>
      {upload.isPending && <span className="muted">Uploading…</span>}
    </div>
    <input
      ref={inputRef}
      type="file"
      accept={UPLOAD_ACCEPT}
      multiple
      hidden
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        startUpload(files)
      }}
    />
    {uploadError && <Alert color="red" variant="light" withCloseButton onClose={() => setUploadError(null)}>{uploadError}</Alert>}
    {list.isError && <p className="content-list-error">The media list could not be loaded. Please try again.</p>}
    {list.isPending && <p className="content-list-hint">Loading…</p>}
    {items.length > 0 && <div className="media-grid">
      {items.map((media) => <figure className="media-card" key={media.id}>
        <a href={media.url} target="_blank" rel="noreferrer" aria-label={`Open ${media.filename}`}>
          <img src={media.url} alt={media.filename} loading="lazy" decoding="async" />
        </a>
        <figcaption>
          <span className="media-name" title={media.filename}>{media.filename}</span>
          <span className="media-meta">{media.mime.replace('image/', '')} · {Math.max(1, Math.round(media.size / 1024))} KB · {formatDate(media.createdAt)}</span>
          <div className="media-actions">
            <Button size="compact-xs" variant="default" leftSection={<Copy size={12} />} onClick={() => copyMarkdown(media)}>{copiedID === media.id ? 'Copied' : 'Copy markdown'}</Button>
            <ConfirmButton label={`Delete ${media.filename}`} confirmLabel="Delete" confirmBody="Delete this image? Markdown that references it will show a broken image." danger icon={<Trash2 size={13} />} onConfirm={() => remove.mutate(media.id)} />
          </div>
        </figcaption>
      </figure>)}
    </div>}
    {!list.isError && !list.isPending && !items.length && <p className="content-list-hint">{q ? 'No images match the current filters.' : 'No images uploaded yet — drop files above or paste into the editor.'}</p>}
    <Pager page={page} totalPages={totalPages} onChange={changePage} />
  </section>
}

export default MediaWorkspace
