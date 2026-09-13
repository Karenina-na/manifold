import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Badge, TextInput } from '@mantine/core'
import { Eye, EyeOff, MessageCircle, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminComment } from '@manifold/contracts'
import { createAdminClient } from '../lib/api'
import { activeLocale, formatDate } from '../i18n/format'
import { requestNavigate } from '../lib/useHashRoute'
import { ConfirmButton } from '../components/common/ConfirmButton'
import { Pager } from '../components/common/Pager'

type CommentAction = { id: string; action: 'delete' | 'restore' | 'hide' | 'unhide' }

export function CommentsWorkspace({ token }: { token: string }) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const comments = useQuery({
    queryKey: ['admin-comments', { q, page }],
    queryFn: () => client.adminComments({ q: q || undefined, page }),
  })
  const mutation = useMutation({
    mutationFn: ({ id, action }: CommentAction) => {
      if (action === 'delete') return client.deleteComment(id)
      if (action === 'restore') return client.restoreComment(id)
      if (action === 'hide') return client.hideComment(id)
      return client.unhideComment(id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-comments'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-content'] })
    },
  })
  const rows = comments.data?.data ?? []
  const totalPages = comments.data?.pagination.totalPages ?? 1

  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">{t('comments.moderationKicker')}</p><h1>{t('comments.moderationTitle')}</h1><p className="subheading">{t('comments.moderationCopy')}</p></div><Badge className="queue-badge" leftSection={<MessageCircle size={15} />}>{comments.isLoading ? t('common.loading') : t('comments.total', { count: comments.data?.pagination.totalItems ?? 0 })}</Badge></div>
    <div className="content-toolbar">
      <TextInput
        leftSection={<Search size={14} />}
        placeholder={t('comments.search')}
        aria-label={t('comments.search')}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <span className="content-toolbar-count">{t('common.count.comments', { count: comments.data?.pagination.totalItems ?? 0 })}</span>
    </div>
    <section className="panel moderation-panel">
      {comments.isError && <p className="content-list-error">{t('comments.loadError')}</p>}
      {comments.isPending && <p className="content-list-hint">{t('common.loading')}</p>}
      {!comments.isPending && !comments.isError && !rows.length && <div className="empty-state"><MessageCircle size={28} /><h2>{q ? t('comments.noMatch') : t('comments.none')}</h2><p>{t('comments.readerEmpty')}</p></div>}
      {rows.map((comment) => <CommentRow key={comment.id} comment={comment} locale={locale} pending={mutation.isPending} onOpen={() => openEditor(comment)} onAction={(action) => mutation.mutate({ id: comment.id, action })} />)}
      <Pager page={comments.data?.pagination.page ?? page} totalPages={totalPages} onChange={setPage} />
    </section>
  </section>
}

// Rows jump into the owning editor's Comments tab; Core resolves the thread's
// page from the focus id, so no position bookkeeping lives here.
function openEditor(comment: AdminComment) {
  const section = comment.contentKind === 'ARTICLE' ? 'writings' : 'thoughts'
  requestNavigate(`#/${section}/${comment.contentId}/comments?focus=${comment.id}`)
}

function CommentRow({ comment, locale, pending, onOpen, onAction }: { comment: AdminComment; locale: ReturnType<typeof activeLocale>; pending: boolean; onOpen: () => void; onAction: (action: 'delete' | 'restore' | 'hide' | 'unhide') => void }) {
  const { t } = useTranslation()
  const authorName = comment.authorName || t('common.anonymous')
  const deleted = Boolean(comment.deletedAt)
  const hidden = comment.hidden
  const rowClass = ['moderation-row', 'comment-row', deleted && 'moderation-row-deleted', hidden && 'moderation-row-hidden'].filter(Boolean).join(' ')
  const kind = comment.contentKind === 'ARTICLE' ? t('common.writing') : t('common.thought')
  return <article className={rowClass} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter') onOpen() }} tabIndex={0} role="button" aria-label={t('comments.openThread', { kind, author: authorName })}>
    <div className="comment-avatar">{authorName.slice(0, 1).toUpperCase()}</div>
    <div className="moderation-body">
      <div className="row-title">
        {authorName}
        {comment.replyToId && <span className="reply-tag">{t('comments.replyTag')}</span>}
        <span className="kind-badge">{kind}</span>
        <span>{formatDate(comment.createdAt, locale)}</span>
        {hidden && <span className="hidden-tag">{t('common.hidden')}</span>}
        {deleted && comment.deletedAt && <span>{t('comments.deletedAt', { date: formatDate(comment.deletedAt, locale) })}</span>}
      </div>
      <p>{comment.body}</p>
      <small>{comment.contentTitle || comment.contentId}</small>
    </div>
    <div className="row-actions" onClick={(event) => event.stopPropagation()} role="presentation">
      {deleted
        ? <ActionIcon color="teal" variant="light" type="button" title={t('common.restore')} aria-label={t('comments.restoreFrom', { author: authorName })} onClick={() => onAction('restore')} disabled={pending}><RotateCcw size={15} /></ActionIcon>
        : <>
          {hidden
            ? <ActionIcon color="teal" variant="light" type="button" title={t('comments.unhide')} aria-label={t('comments.unhideFrom', { author: authorName })} onClick={() => onAction('unhide')} disabled={pending}><Eye size={15} /></ActionIcon>
            : <ConfirmButton label={t('comments.hideFrom', { author: authorName })} confirmLabel={t('comments.hide')} confirmBody={t('comments.hideBody')} icon={<EyeOff size={15} />} onConfirm={() => onAction('hide')} />}
          <ConfirmButton label={t('comments.deleteFrom', { author: authorName })} confirmLabel={t('common.delete')} confirmBody={t('comments.softDeleteBody')} danger icon={<Trash2 size={15} />} onConfirm={() => onAction('delete')} />
        </>}
    </div>
  </article>
}

export default CommentsWorkspace
