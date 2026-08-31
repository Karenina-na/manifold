import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Badge, TextInput } from '@mantine/core'
import { MessageCircle, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AdminComment } from '@manifold/contracts'
import { formatDate } from '@manifold/render'
import { createAdminClient } from '../api'
import { requestNavigate } from '../lib/useHashRoute'
import { ConfirmButton } from '../components/ConfirmButton'
import { Pager } from '../components/Pager'

type CommentAction = { id: string; action: 'delete' | 'restore' }

export function CommentsWorkspace({ token }: { token: string }) {
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
    mutationFn: ({ id, action }: CommentAction) => action === 'delete' ? client.deleteComment(id) : client.restoreComment(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-comments'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-content'] })
    },
  })
  const rows = comments.data?.data ?? []
  const totalPages = comments.data?.pagination.totalPages ?? 1

  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">Moderation</p><h1>Manage comments.</h1><p className="subheading">Comments are public immediately. Soft-delete anything that does not belong.</p></div><Badge className="queue-badge" leftSection={<MessageCircle size={15} />}>{comments.isLoading ? 'Loading' : `${comments.data?.pagination.totalItems ?? 0} total`}</Badge></div>
    <div className="content-toolbar">
      <TextInput
        leftSection={<Search size={14} />}
        placeholder="Search comments"
        aria-label="Search comments"
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <span className="content-toolbar-count">{comments.data?.pagination.totalItems ?? 0} comments</span>
    </div>
    <section className="panel moderation-panel">
      {comments.isError && <p className="content-list-error">Comments could not be loaded. Please try again.</p>}
      {comments.isPending && <p className="content-list-hint">Loading…</p>}
      {!comments.isPending && !comments.isError && !rows.length && <div className="empty-state"><MessageCircle size={28} /><h2>{q ? 'No comments match this search.' : 'No comments yet.'}</h2><p>Reader responses will appear here.</p></div>}
      {rows.map((comment) => <CommentRow key={comment.id} comment={comment} pending={mutation.isPending} onOpen={() => openEditor(comment)} onAction={(action) => mutation.mutate({ id: comment.id, action })} />)}
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

function CommentRow({ comment, pending, onOpen, onAction }: { comment: AdminComment; pending: boolean; onOpen: () => void; onAction: (action: 'delete' | 'restore') => void }) {
  const authorName = comment.authorName || 'Anonymous'
  const deleted = Boolean(comment.deletedAt)
  return <article className={deleted ? 'moderation-row moderation-row-deleted comment-row' : 'moderation-row comment-row'} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter') onOpen() }} tabIndex={0} role="button" aria-label={`Open the ${comment.contentKind === 'ARTICLE' ? 'writing' : 'thought'} thread for a comment by ${authorName}`}>
    <div className="comment-avatar">{authorName.slice(0, 1).toUpperCase()}</div>
    <div className="moderation-body">
      <div className="row-title">
        {authorName}
        {comment.replyToId && <span className="reply-tag">reply</span>}
        <span className="kind-badge">{comment.contentKind === 'ARTICLE' ? 'Writing' : 'Thought'}</span>
        <span>{formatDate(comment.createdAt)}</span>
        {deleted && comment.deletedAt && <span>deleted {formatDate(comment.deletedAt)}</span>}
      </div>
      <p>{comment.body}</p>
      <small>{comment.contentTitle || comment.contentId}</small>
    </div>
    <div className="row-actions" onClick={(event) => event.stopPropagation()} role="presentation">
      {deleted
        ? <ActionIcon color="teal" variant="light" type="button" title="Restore" aria-label={`Restore comment from ${authorName}`} onClick={() => onAction('restore')} disabled={pending}><RotateCcw size={15} /></ActionIcon>
        : <ConfirmButton label={`Delete comment from ${authorName}`} confirmLabel="Delete" confirmBody="Soft-delete this comment? It leaves the public site immediately." danger icon={<Trash2 size={15} />} onConfirm={() => onAction('delete')} />}
    </div>
  </article>
}

export default CommentsWorkspace
