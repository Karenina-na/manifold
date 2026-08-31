import { TextInput } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Eye, Heart, MessageCircle, Search, Send, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AdminContent, ContentKind, ContentSort } from '@manifold/contracts'
import type { ManifoldClient } from '@manifold/sdk'
import { formatDate } from '@manifold/render'
import { deriveExcerpt } from '../lib/content-derive'
import { ConfirmButton } from './ConfirmButton'
import { Pager } from './Pager'

export type StatusFilter = 'ALL' | 'DRAFT' | 'PUBLISHED'

export type TransitionAction = 'publish' | 'unpublish' | 'delete'

type ContentListPanelProps = {
  client: ManifoldClient
  kind: ContentKind
  singular: string
  onEdit: (content: AdminContent) => void
  onTransition: (content: AdminContent, action: TransitionAction) => void
  hrefFor: (content: AdminContent) => string
}

export function ContentListPanel({ client, kind, singular, onEdit, onTransition, hrefFor }: ContentListPanelProps) {
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<ContentSort>('newest')
  const [page, setPage] = useState(1)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])
  const list = useQuery({
    queryKey: ['admin-content', kind, { status, q, sort, page }],
    queryFn: () => client.adminContent({ kind, status: status === 'ALL' ? undefined : status, q: q || undefined, sort: sort === 'newest' ? undefined : sort, page }),
  })
  const items = list.data?.data ?? []
  const totalPages = list.data?.pagination.totalPages ?? 1
  const changePage = (next: number) => {
    if (next < 1 || next > totalPages) return
    setPage(next)
  }
  return <section className="panel content-list">
    <div className="content-toolbar">
      <TextInput
        leftSection={<Search size={14} />}
        placeholder={`Search ${singular}s`}
        aria-label={`Search ${singular}s`}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <div className="filter-chips" role="group" aria-label="Status filter">
        {(['ALL', 'DRAFT', 'PUBLISHED'] as const).map((option) => <button
          key={option}
          type="button"
          className={status === option ? 'filter-chip active' : 'filter-chip'}
          onClick={() => { setStatus(option); setPage(1) }}
        >{option === 'ALL' ? 'All' : option === 'DRAFT' ? 'Drafts' : 'Published'}</button>)}
      </div>
      <select className="filter-sort" value={sort} onChange={(event) => { setSort(event.currentTarget.value as ContentSort); setPage(1) }} aria-label="Sort">
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="updated">Recently updated</option>
      </select>
      <span className="content-toolbar-count">{list.data?.pagination.totalItems ?? items.length} {kind === 'ARTICLE' ? 'writings' : 'thoughts'}</span>
    </div>
    {list.isError && <p className="content-list-error">The list could not be loaded. Please try again.</p>}
    {list.isPending && <p className="content-list-hint">Loading…</p>}
    {items.map((content) => <ContentRow
      key={content.id}
      content={content}
      singular={singular}
      onEdit={onEdit}
      onTransition={onTransition}
      hrefFor={hrefFor}
    />)}
    {!list.isError && !list.isPending && !items.length && <p className="content-list-hint">No {kind === 'ARTICLE' ? 'writings' : 'thoughts'} match the current filters.</p>}
    <Pager page={page} totalPages={totalPages} onChange={changePage} />
  </section>
}

function ContentRow({ content, singular, onEdit, onTransition, hrefFor }: { content: AdminContent; singular: string; onEdit: (content: AdminContent) => void; onTransition: (content: AdminContent, action: TransitionAction) => void; hrefFor: (content: AdminContent) => string }) {
  const preview = content.summary?.trim()
    ? `✦ ${content.summary.trim()}`
    : deriveExcerpt(content.body ?? '')
  return <article className="content-row" onClick={() => onEdit(content)}>
    <div>
      <div className="row-title"><span className={`status-dot ${content.status.toLowerCase()}`} />{content.title || `Untitled ${singular}`}</div>
      {preview && <p className="content-row-preview">{preview}</p>}
      <p className="content-row-meta">
        <span>{formatDate(content.publishedAt ?? content.updatedAt)}</span>
        {content.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
        <span><Eye size={12} /> {content.viewCount}</span>
        <span><Heart size={12} /> {content.likeCount}</span>
        <span><MessageCircle size={12} /> {content.commentCount}</span>
      </p>
    </div>
    <div className="row-actions">
      <span className="status-label">{content.status}</span>
      {content.status === 'PUBLISHED' && <a className="row-link" href={hrefFor(content)} target="_blank" rel="noreferrer" title="View on the site" aria-label={`View ${content.title || content.id} on the site`} onClick={(event) => event.stopPropagation()}><ArrowUpRight size={14} /></a>}
      {content.status === 'DRAFT' && <ConfirmButton label={`Publish ${content.title || content.id}`} confirmLabel="Publish now" confirmBody={`Publish this ${singular} to the public site?`} icon={<Send size={14} />} stopPropagation onConfirm={() => onTransition(content, 'publish')} />}
      {content.status === 'PUBLISHED' && <ConfirmButton label={`Unpublish ${content.title || content.id}`} confirmLabel="Unpublish" confirmBody="Take this piece off the public site? It returns to drafts." danger icon={<X size={14} />} stopPropagation onConfirm={() => onTransition(content, 'unpublish')} />}
      {content.status !== 'DELETED' && <ConfirmButton label={`Delete ${content.title || content.id}`} confirmLabel="Delete" confirmBody="Delete this piece? It leaves the public site immediately." danger icon={<Trash2 size={14} />} stopPropagation onConfirm={() => onTransition(content, 'delete')} />}
    </div>
  </article>
}
