import { Alert, Button, TextInput } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, Copy, FileText, Search, Trash2, UploadCloud } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Media, MediaReference } from '@manifold/contracts'
import { ApiError } from '@manifold/sdk'
import { createAdminClient } from '../lib/api'
import { activeLocale, formatDate, formatNumber } from '../i18n/format'
import { ConfirmButton } from '../components/common/ConfirmButton'
import { Pager } from '../components/common/Pager'
import { navigate, requestNavigate } from '../lib/useHashRoute'

const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,application/pdf'

function describeMediaError(error: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (error instanceof ApiError && error.code === 'MEDIA_IN_USE') return t('media.deleteInUse')
  if (error instanceof ApiError) return `${error.message} (${error.code})`
  return t('media.deleteError')
}
const allowedMediaTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'application/pdf'])

function formatSize(size: number, locale: ReturnType<typeof activeLocale>): string {
  if (size >= 1024 * 1024) return `${formatNumber(size / (1024 * 1024), locale, { maximumFractionDigits: 1 })} MB`
  return `${formatNumber(Math.max(1, Math.round(size / 1024)), locale)} KB`
}

function mimeLabel(mime: string): string {
  return mime.replace('image/', '').replace('application/', '')
}

function referenceTarget(ref: MediaReference): string {
  const view = ref.kind === 'ARTICLE' ? 'writings' : 'thoughts'
  return `#/${view}/${ref.contentId}`
}

function useCopyMarkdown() {
  const { t } = useTranslation()
  const [copiedID, setCopiedID] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const copyTimer = useRef<number | null>(null)
  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current) }, [])
  const copyMarkdown = async (media: Media) => {
    const isPdf = media.mime === 'application/pdf'
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(isPdf ? `[${media.filename}](${media.url})` : `![${media.filename}](${media.url})`)
      setCopyError(null)
      setCopiedID(media.id)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopiedID(null), 1600)
    } catch {
      setCopiedID(null)
      setCopyError(t('media.copyError'))
    }
  }
  return { copiedID, copyError, clearCopyError: () => setCopyError(null), copyMarkdown }
}

export function MediaWorkspace({ token, segments }: { token: string; segments: string[] }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const mediaId = segments[0]
  if (!mediaId) return <MediaListPage client={client} />
  return <MediaDetailPage client={client} mediaId={mediaId} />
}

function MediaListPage({ client }: { client: ReturnType<typeof createAdminClient> }) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { copiedID, copyError, clearCopyError, copyMarkdown } = useCopyMarkdown()
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
    onError: (error) => setUploadError(error instanceof ApiError ? `${error.message} (${error.code})` : t('media.uploadError')),
  })
  const remove = useMutation({
    mutationFn: (id: string) => client.deleteMedia(id),
    onSuccess: () => {
      setDeleteError(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-media'] })
    },
    onError: (error) => setDeleteError(describeMediaError(error, t)),
  })

  const startUpload = (files: File[]) => {
    const images = files.filter((file) => allowedMediaTypes.has(file.type))
    if (!images.length) {
      setUploadError(t('media.accepted'))
      return
    }
    upload.mutate(images)
  }
  const changePage = (next: number) => {
    if (next < 1 || next > totalPages) return
    setPage(next)
  }

  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">{t('media.kicker')}</p><h1>{t('media.title')}</h1><p className="subheading">{t('media.copy')}</p></div></div>
    <div className="content-toolbar">
      <TextInput
        leftSection={<Search size={14} />}
        placeholder={t('media.search')}
        aria-label={t('media.search')}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <span className="content-toolbar-count">{t('common.count.files', { count: list.data?.pagination.totalItems ?? items.length })}</span>
    </div>
    <div
      className={dragOver ? 'media-dropzone drag' : 'media-dropzone'}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { event.preventDefault(); setDragOver(false); startUpload(Array.from(event.dataTransfer.files)) }}
      role="button"
      tabIndex={0}
      aria-label={t('media.dropzoneAria')}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click() } }}
    >
      <UploadCloud size={20} aria-hidden="true" />
      <span>{t('media.dropzone')}</span>
      {upload.isPending && <span className="muted">{t('media.uploading')}</span>}
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
    {copyError && <Alert color="red" variant="light" withCloseButton onClose={clearCopyError}>{copyError}</Alert>}
    {list.isError && <p className="content-list-error">{t('media.listError')}</p>}
    {list.isPending && <p className="content-list-hint">{t('common.loading')}</p>}
    {items.length > 0 && <div className="media-grid">
      {items.map((media) => <figure className="media-card" key={media.id}>
        <a href={media.url} target="_blank" rel="noreferrer" aria-label={t('media.open', { filename: media.filename })}>
          {media.mime === 'application/pdf'
            ? <span className="media-pdf-card"><FileText size={22} aria-hidden="true" /><span>PDF</span></span>
            : <img src={media.url} alt={media.filename} loading="lazy" decoding="async" />}
        </a>
        <figcaption>
          <span className="media-name" title={media.filename}>{media.filename}</span>
          <span className="media-meta">{mimeLabel(media.mime)} · {formatSize(media.size, locale)} · {formatDate(media.createdAt, locale)}</span>
          <div className="media-actions">
            <Button size="compact-xs" variant="default" onClick={() => navigate(`#/media/${media.id}`)}>{t('common.details')}</Button>
            <Button size="compact-xs" variant="default" leftSection={<Copy size={12} />} onClick={() => void copyMarkdown(media)}>{copiedID === media.id ? t('common.copied') : t('common.copyMarkdown')}</Button>
            <ConfirmButton label={t('media.deleteNamed', { filename: media.filename })} confirmLabel={t('common.delete')} confirmBody={t('media.deleteConfirm')} danger icon={<Trash2 size={13} />} onConfirm={() => remove.mutate(media.id)} />
          </div>
        </figcaption>
      </figure>)}
    </div>}
    {!list.isError && !list.isPending && !items.length && <p className="content-list-hint">{q ? t('media.noMatch') : t('media.none')}</p>}
    <Pager page={page} totalPages={totalPages} onChange={changePage} />
  </section>
}

function MediaDetailPage({ client, mediaId }: { client: ReturnType<typeof createAdminClient>; mediaId: string }) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const queryClient = useQueryClient()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { copiedID, copyError, clearCopyError, copyMarkdown } = useCopyMarkdown()
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
    onError: (error) => setDeleteError(describeMediaError(error, t)),
  })

  if (mediaQuery.isPending) return <section className="workspace"><p className="content-list-hint">{t('common.loading')}</p></section>
  if (mediaQuery.isError || !media) {
    return <section className="workspace editor-page">
      <div className="editor-topbar"><button type="button" className="editor-back" onClick={() => navigate('#/media')}><ArrowLeft size={15} /> {t('media.back')}</button></div>
      <p className="content-list-error">{t(mediaQuery.isError ? 'media.loadError' : 'media.notFound')}</p>
    </section>
  }
  return <section className="workspace editor-page media-detail">
    <div className="editor-topbar">
      <button type="button" className="editor-back" onClick={() => requestNavigate('#/media')}><ArrowLeft size={15} /> {t('media.back')}</button>
      {references.length > 0 && <span className="media-ref-count">{t('common.count.references', { count: references.length })}</span>}
    </div>
    <div className="page-heading">
      <div>
        <p className="kicker">{t('media.kicker')}</p>
        <h1>{media.filename}</h1>
        <p className="subheading">{t('media.uploadedAt', { date: formatDate(media.createdAt, locale), size: formatSize(media.size, locale) })}</p>
      </div>
    </div>
    <div className="media-detail-preview">
      {media.mime === 'application/pdf'
        ? <span className="media-pdf-card"><FileText size={32} aria-hidden="true" /><span>PDF</span></span>
        : <img src={media.url} alt={media.filename} decoding="async" />}
    </div>
    <div className="media-detail-info">
      <dl>
        <div><dt>{t('media.type')}</dt><dd>{mimeLabel(media.mime)}</dd></div>
        <div><dt>{t('media.size')}</dt><dd>{formatSize(media.size, locale)}</dd></div>
        <div><dt>{t('media.uploaded')}</dt><dd>{formatDate(media.createdAt, locale)}</dd></div>
        <div><dt>{t('media.id')}</dt><dd className="media-id" title={media.id}>{media.id}</dd></div>
      </dl>
      <div className="media-actions">
        <Button size="compact-sm" variant="default" component="a" href={media.url} target="_blank" rel="noreferrer" leftSection={<ArrowUpRight size={13} />}>{t('common.openPreview')}</Button>
        <Button size="compact-sm" variant="default" leftSection={<Copy size={13} />} onClick={() => void copyMarkdown(media)}>{copiedID === media.id ? t('common.copied') : t('common.copyMarkdown')}</Button>
        <ConfirmButton label={t('media.deleteNamed', { filename: media.filename })} confirmLabel={t('common.delete')} confirmBody={t('media.deleteConfirm')} danger icon={<Trash2 size={14} />} onConfirm={() => remove.mutate()} />
      </div>
      {deleteError && <Alert color="red" variant="light" withCloseButton onClose={() => setDeleteError(null)}>{deleteError}</Alert>}
      {copyError && <Alert color="red" variant="light" withCloseButton onClose={clearCopyError}>{copyError}</Alert>}
    </div>
    <div className="media-refs">
      <p className="kicker">{t('media.usedBy')}</p>
      <h2>{t('media.references')}</h2>
      {refsQuery.isPending && <p className="content-list-hint">{t('common.loading')}</p>}
      {refsQuery.isError && <p className="content-list-error">{t('media.refsError')}</p>}
      {!refsQuery.isPending && !refsQuery.isError && references.length === 0 && <p className="content-list-hint">{t('media.noRefs')}</p>}
      {references.map((ref) => <article
        className="content-row media-ref-row"
        key={ref.contentId}
        role="button"
        tabIndex={0}
        aria-label={t('media.openReference', { title: ref.title || ref.slug })}
        onClick={() => navigate(referenceTarget(ref))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            navigate(referenceTarget(ref))
          }
        }}
      >
        <div>
          <div className="row-title"><span className={`status-dot ${ref.status.toLowerCase()}`} />{ref.title || t('media.untitled', { kind: ref.kind === 'ARTICLE' ? t('common.writing') : t('common.thought') })}</div>
          <p className="content-row-meta">
            <span>{ref.kind === 'ARTICLE' ? t('common.writing') : t('common.thought')}</span>
            <span>/{ref.slug}</span>
            <span className="ref-open-hint">{t('media.openEditor')} <ArrowUpRight size={12} /></span>
          </p>
        </div>
      </article>)}
    </div>
  </section>
}

export default MediaWorkspace
