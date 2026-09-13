import { TextInput } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Eye, Heart, MessageCircle, Pin, PinOff, RotateCcw, Search, Send, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminContent, ContentKind, ContentSort } from '@manifold/contracts'
import type { ManifoldClient } from '@manifold/sdk'
import { activeLocale, formatDate, formatNumber } from '../../i18n/format'
import { ConfirmButton } from '../common/ConfirmButton'
import { Pager } from '../common/Pager'

export type StatusFilter = 'ALL' | 'DRAFT' | 'PUBLISHED' | 'DELETED'
export type TransitionAction = 'publish' | 'unpublish' | 'delete' | 'restore'
export type PinControl = { pinnedIds: string[]; onToggle: (content: AdminContent) => void; pending: boolean }

type ContentListPanelProps = { client: ManifoldClient; kind: ContentKind; singular: string; onEdit: (content: AdminContent) => void; onTransition: (content: AdminContent, action: TransitionAction) => void; hrefFor: (content: AdminContent) => string; pin?: PinControl }

export function ContentListPanel({ client, kind, singular, onEdit, onTransition, hrefFor, pin }: ContentListPanelProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<ContentSort>('newest')
  const [page, setPage] = useState(1)
  useEffect(() => { const timer = window.setTimeout(() => { setQ(search.trim()); setPage(1) }, 300); return () => window.clearTimeout(timer) }, [search])
  const list = useQuery({ queryKey: ['admin-content', kind, { status, q, sort, page, pinned: pinnedOnly || undefined }], queryFn: () => client.adminContent({ kind, status: status === 'ALL' ? undefined : status, q: q || undefined, sort: sort === 'newest' ? undefined : sort, page, pinned: pinnedOnly || undefined }) })
  const items = list.data?.data ?? []
  const totalPages = list.data?.pagination.totalPages ?? 1
  const plural = kind === 'ARTICLE' ? t('common.writings') : t('common.thoughts')
  return <section className="panel content-list">
    <div className="content-toolbar">
      <TextInput leftSection={<Search size={14} />} placeholder={t('list.search', { kind: plural })} aria-label={t('list.search', { kind: plural })} value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
      <div className="filter-chips" role="group" aria-label={t('list.statusFilter')}>
        {(['ALL', 'DRAFT', 'PUBLISHED', 'DELETED'] as const).map((option) => <button key={option} type="button" className={status === option ? 'filter-chip active' : 'filter-chip'} onClick={() => { setStatus(option); setPage(1) }}>{t(option === 'ALL' ? 'list.all' : option === 'DRAFT' ? 'list.drafts' : option === 'PUBLISHED' ? 'list.published' : 'list.deleted')}</button>)}
        {pin && <button type="button" className={pinnedOnly ? 'filter-chip active' : 'filter-chip'} aria-pressed={pinnedOnly} onClick={() => { setPinnedOnly((value) => !value); setPage(1) }}><Pin size={12} /> {t('list.pinned')}</button>}
      </div>
      <select className="filter-sort" value={sort} onChange={(event) => { setSort(event.currentTarget.value as ContentSort); setPage(1) }} aria-label={t('list.sort')}><option value="newest">{t('list.newest')}</option><option value="oldest">{t('list.oldest')}</option><option value="updated">{t('list.updated')}</option></select>
      <span className="content-toolbar-count">{list.data?.pagination.totalItems ?? items.length} {plural}</span>
    </div>
    {list.isError && <p className="content-list-error">{t('list.loadError')}</p>}
    {list.isPending && <p className="content-list-hint">{t('common.loading')}</p>}
    {items.map((content) => <ContentRow key={content.id} content={content} singular={singular} onEdit={onEdit} onTransition={onTransition} hrefFor={hrefFor} pin={pin} />)}
    {!list.isError && !list.isPending && !items.length && <p className="content-list-hint">{t('list.empty', { kind: plural })}</p>}
    <Pager page={page} totalPages={totalPages} onChange={(next) => { if (next >= 1 && next <= totalPages) setPage(next) }} />
  </section>
}

function ContentRow({ content, singular, onEdit, onTransition, hrefFor, pin }: { content: AdminContent; singular: string; onEdit: (content: AdminContent) => void; onTransition: (content: AdminContent, action: TransitionAction) => void; hrefFor: (content: AdminContent) => string; pin?: PinControl }) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const preview = content.summary?.trim() ? `✦ ${content.summary.trim()}` : content.excerpt
  const pinned = pin?.pinnedIds.includes(content.id) ?? false
  const label = content.title || t('list.untitled', { kind: singular })
  const title = content.title || content.id
  return <article className="content-row" role="button" tabIndex={0} aria-label={t('list.open', { title: label })} onClick={() => onEdit(content)} onKeyDown={(event) => { if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return; event.preventDefault(); onEdit(content) }}>
    <div><div className="row-title"><span className={`status-dot ${content.status.toLowerCase()}`} />{label}{pinned && <span className="pinned-badge"><Pin size={11} /> {t('list.pinned')}</span>}</div>{preview && <p className="content-row-preview">{preview}</p>}<p className="content-row-meta"><span>{formatDate(content.publishedAt ?? content.updatedAt, locale)}</span>{content.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}<span><Eye size={12} /> {formatNumber(content.viewCount, locale)}</span><span><Heart size={12} /> {formatNumber(content.likeCount, locale)}</span><span><MessageCircle size={12} /> {formatNumber(content.commentCount, locale)}</span></p></div>
    <div className="row-actions">
      <span className="status-label">{t(`common.status.${content.status.toLowerCase()}`)}</span>
      {pin && content.status === 'PUBLISHED' && <button type="button" className={pinned ? 'pin-button pinned' : 'pin-button'} title={t(pinned ? 'list.unpinTitle' : 'list.pinTitle')} aria-label={t(pinned ? 'list.unpin' : 'list.pin', { title })} aria-pressed={pinned} disabled={pin.pending} onClick={(event) => { event.stopPropagation(); pin.onToggle(content) }}>{pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>}
      {content.status === 'PUBLISHED' && <a className="row-link" href={hrefFor(content)} target="_blank" rel="noreferrer" title={t('editor.viewSite')} aria-label={t('list.viewNamed', { title })} onClick={(event) => event.stopPropagation()}><ArrowUpRight size={14} /></a>}
      {content.status === 'DRAFT' && <ConfirmButton label={t('list.publishNamed', { title })} confirmLabel={t('editor.publishNow')} confirmBody={t('editor.publishConfirm', { kind: singular })} icon={<Send size={14} />} stopPropagation onConfirm={() => onTransition(content, 'publish')} />}
      {content.status === 'PUBLISHED' && <ConfirmButton label={t('list.unpublishNamed', { title })} confirmLabel={t('editor.unpublish')} confirmBody={t('list.unpublishConfirm')} danger icon={<X size={14} />} stopPropagation onConfirm={() => onTransition(content, 'unpublish')} />}
      {content.status !== 'DELETED' && <ConfirmButton label={t('list.deleteNamed', { title })} confirmLabel={t('common.delete')} confirmBody={t('list.deleteConfirm')} danger icon={<Trash2 size={14} />} stopPropagation onConfirm={() => onTransition(content, 'delete')} />}
      {content.status === 'DELETED' && <ConfirmButton label={t('list.restoreNamed', { title })} confirmLabel={t('common.restore')} confirmBody={t('list.restoreConfirm', { kind: singular })} icon={<RotateCcw size={14} />} stopPropagation onConfirm={() => onTransition(content, 'restore')} />}
    </div>
  </article>
}
