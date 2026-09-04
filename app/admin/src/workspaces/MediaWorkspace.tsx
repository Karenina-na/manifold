import { Alert, Button, TextInput } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, Copy, FileText, Search, Trash2, UploadCloud } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Media, MediaReference } from '@manifold/contracts'
import { formatDate } from '@manifold/render'
import { ApiError } from '@manifold/sdk'
import { createAdminClient } from '../api'
import { ConfirmButton } from '../components/ConfirmButton'
import { Pager } from '../components/Pager'
import { navigate, requestNavigate } from '../lib/useHashRoute'

const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,application/pdf'

function describeMediaError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'MEDIA_IN_USE') {
    return 'This file is used in published or draft content. Remove those references first.'
  }
  if (error instanceof ApiError) return `${error.message} (${error.code})`
  return 'Media could not be deleted.'
}
const allowedMediaTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'application/pdf'])

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(size / 1024))} KB`
}

function mimeLabel(mime: string): string {
  return mime.replace('image/', '').replace('application/', '')
}

function referenceTarget(ref: MediaReference): string {
  const view = ref.kind === 'ARTICLE' ? 'writings' : 'thoughts'
  return `#/${view}/${ref.contentId}`
}

function useCopyMarkdown() {
  const [copiedID, setCopiedID] = useState<string | null>(null)
  const copyTimer = useRef<number | null>(null)
  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current) }, [])
  const copyMarkdown = (media: Media) => {
    const isPdf = media.mime === 'application/pdf'
    navigator.clipboard?.writeText(isPdf ? `[${media.filename}](${media.url})` : `![${media.filename}](${media.url})`).catch(() => {})
    setCopiedID(media.id)
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopiedID(null), 1600)
  }
  return { copiedID, copyMarkdown }
}

export function MediaWorkspace({ token, segments }: { token: string; segments: string[] }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const mediaId = segments[0]
  if (!mediaId) return <MediaListPage client={client} />
  return <MediaDetailPage client={client} mediaId={mediaId} />
}

function MediaListPage({ client }: { client: ReturnType<typeof createAdminClient> }) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { copiedID, copyMarkdown } = useCopyMarkdown()
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

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
    onSuccess: () => {
      setDeleteError(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-media'] })
    },
    onError: (error) => setDeleteError(describeMediaError(error)),
  })

  const startUpload = (files: File[]) => {
    const images = files.filter((file) => allowedMediaTypes.has(file.type))
    if (!images.length) {
      setUploadError('Only PNG, JPEG, WebP, GIF, AVIF images and PDF files are accepted.')
      return
    }
    upload.mutate(images)
  }
  const changePage = (next: number) => {
    if (next < 1 || next > totalPages) return
    setPage(next)
  }

  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">Media</p><h1>Files stored beside the words.</h1><p className="subheading">Uploads live in Core — images render inline, PDFs link from the profile.</p></div></div>
    <div className="content-toolbar">
      <TextInput
        leftSection={<Search size={14} />}
        placeholder="Search media"
        aria-label="Search media"
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <span className="content-toolbar-count">{list.data?.pagination.totalItems ?? items.length} files</span>
    </div>
    <div
      className={dragOver ? 'media-dropzone drag' : 'media-dropzone'}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { event.preventDefault(); setDragOver(false); startUpload(Array.from(event.dataTransfer.files)) }}
      role="button"
      tabIndex={0}
      aria-label="Upload images or PDFs"
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click() } }}
    >
      <UploadCloud size={20} aria-hidden="true" />
      <span>Drop images or PDFs here or click to upload — paste and drag also work inside the editor.</span>
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
    {deleteError && <Alert color="red" variant="light" withCloseButton onClose={() => setDeleteError(null)}>{deleteError}</Alert>}
    {list.isError && <p className="content-list-error">The media list could not be loaded. Please try again.</p>}
    {list.isPending && <p className="content-list-hint">Loading…</p>}
    {items.length > 0 && <div className="media-grid">
      {items.map((media) => <figure className="media-card" key={media.id}>
        <a href={media.url} target="_blank" rel="noreferrer" aria-label={`Open ${media.filename}`}>
          {media.mime === 'application/pdf'
            ? <span className="media-pdf-card"><FileText size={22} aria-hidden="true" /><span>PDF</span></span>
            : <img src={media.url} alt={media.filename} loading="lazy" decoding="async" />}
        </a>
        <figcaption>
          <span className="media-name" title={media.filename}>{media.filename}</span>
          <span className="media-meta">{mimeLabel(media.mime)} · {formatSize(media.size)} · {formatDate(media.createdAt)}</span>
          <div className="media-actions">
            <Button size="compact-xs" variant="default" onClick={() => navigate(`#/media/${media.id}`)}>Details</Button>
            <Button size="compact-xs" variant="default" leftSection={<Copy size={12} />} onClick={() => copyMarkdown(media)}>{copiedID === media.id ? 'Copied' : 'Copy markdown'}</Button>
            <ConfirmButton label={`Delete ${media.filename}`} confirmLabel="Delete" confirmBody="Delete this file? Anything referencing it will show as broken." danger icon={<Trash2 size={13} />} onConfirm={() => remove.mutate(media.id)} />
          </div>
        </figcaption>
      </figure>)}
    </div>}
    {!list.isError && !list.isPending && !items.length && <p className="content-list-hint">{q ? 'No files match the current filters.' : 'No files uploaded yet — drop images or PDFs above or paste into the editor.'}</p>}
    <Pager page={page} totalPages={totalPages} onChange={changePage} />
  </section>
}

function MediaDetailPage({ client, mediaId }: { client: ReturnType<typeof createAdminClient>; mediaId: string }) {
  const queryClient = useQueryClient()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { copiedID, copyMarkdown } = useCopyMarkdown()
  const mediaQuery = useQuery({
    queryKey: ['admin-media-item', mediaId],
    queryFn: () => client.listMedia({ q: mediaId, pageSize: 50 }),
  })
  const media = mediaQuery.data?.data.find((item) => item.id === mediaId)
  const refsQuery = useQuery({
    queryKey: ['admin-media-references', mediaId],
    queryFn: () => client.mediaReferences(mediaId),
  })
  const references = refsQuery.data?.references ?? []
  const remove = useMutation({
    mutationFn: () => client.deleteMedia(mediaId),
    onSuccess: () => {
      setDeleteError(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-media'] })
      navigate('#/media')
    },
    onError: (error) => setDeleteError(describeMediaError(error)),
  })

  if (mediaQuery.isPending) return <section className="workspace"><p className="content-list-hint">Loading…</p></section>
  if (mediaQuery.isError || !media) {
    return <section className="workspace editor-page">
      <div className="editor-topbar"><button type="button" className="editor-back" onClick={() => navigate('#/media')}><ArrowLeft size={15} /> Back to media</button></div>
      <p className="content-list-error">This file could not be found. It may have been deleted.</p>
    </section>
  }
  return <section className="workspace editor-page media-detail">
    <div className="editor-topbar">
      <button type="button" className="editor-back" onClick={() => requestNavigate('#/media')}><ArrowLeft size={15} /> Back to media</button>
      {references.length > 0 && <span className="media-ref-count">{references.length} reference{references.length === 1 ? '' : 's'}</span>}
    </div>
    <div className="page-heading">
      <div>
        <p className="kicker">Media</p>
        <h1>{media.filename}</h1>
        <p className="subheading">Uploaded {formatDate(media.createdAt)} · {formatSize(media.size)}</p>
      </div>
    </div>
    <div className="media-detail-preview">
      {media.mime === 'application/pdf'
        ? <span className="media-pdf-card"><FileText size={32} aria-hidden="true" /><span>PDF</span></span>
        : <img src={media.url} alt={media.filename} decoding="async" />}
    </div>
    <div className="media-detail-info">
      <dl>
        <div><dt>Type</dt><dd>{mimeLabel(media.mime)}</dd></div>
        <div><dt>Size</dt><dd>{formatSize(media.size)}</dd></div>
        <div><dt>Uploaded</dt><dd>{formatDate(media.createdAt)}</dd></div>
        <div><dt>ID</dt><dd className="media-id" title={media.id}>{media.id}</dd></div>
      </dl>
      <div className="media-actions">
        <Button size="compact-sm" variant="default" component="a" href={media.url} target="_blank" rel="noreferrer" leftSection={<ArrowUpRight size={13} />}>Open preview</Button>
        <Button size="compact-sm" variant="default" leftSection={<Copy size={13} />} onClick={() => copyMarkdown(media)}>{copiedID === media.id ? 'Copied' : 'Copy markdown'}</Button>
        <ConfirmButton label={`Delete ${media.filename}`} confirmLabel="Delete" confirmBody="Delete this file? Anything referencing it will show as broken." danger icon={<Trash2 size={14} />} onConfirm={() => remove.mutate()} />
      </div>
      {deleteError && <Alert color="red" variant="light" withCloseButton onClose={() => setDeleteError(null)}>{deleteError}</Alert>}
    </div>
    <div className="media-refs">
      <p className="kicker">Used by</p>
      <h2>References</h2>
      {refsQuery.isPending && <p className="content-list-hint">Loading…</p>}
      {refsQuery.isError && <p className="content-list-error">The reference list could not be loaded. Please try again.</p>}
      {!refsQuery.isPending && !refsQuery.isError && references.length === 0 && <p className="content-list-hint">No published or draft content references this file.</p>}
      {references.map((ref) => <article className="content-row media-ref-row" key={ref.contentId} onClick={() => navigate(referenceTarget(ref))}>
        <div>
          <div className="row-title"><span className={`status-dot ${ref.status.toLowerCase()}`} />{ref.title || `Untitled ${ref.kind === 'ARTICLE' ? 'writing' : 'thought'}`}</div>
          <p className="content-row-meta">
            <span>{ref.kind === 'ARTICLE' ? 'Writing' : 'Thought'}</span>
            <span>/{ref.slug}</span>
            <span className="ref-open-hint">Open editor <ArrowUpRight size={12} /></span>
          </p>
        </div>
      </article>)}
    </div>
  </section>
}

export default MediaWorkspace
