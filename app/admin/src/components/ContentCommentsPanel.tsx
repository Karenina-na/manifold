import { Alert, Button, Modal, Textarea, TextInput } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CornerDownRight, Eye, EyeOff, MessageCircle, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AdminComment, CreateCommentInput, UpdateCommentInput } from '@manifold/contracts'
import type { ManifoldClient } from '@manifold/sdk'
import { formatDate } from '@manifold/render'
import { ConfirmButton } from './ConfirmButton'
import { Pager } from './Pager'

type ContentCommentsPanelProps = {
  client: ManifoldClient
  contentId: string
  page: number
  q: string
  focus: string
  onParamsChange: (next: { page?: number; q?: string; focus?: string }) => void
}

// Per-content comment management for the editor's Comments tab. Threads are
// paginated newest-first (Core semantics); the composer posts as the operator
// with the profile display name prefilled, so replies read as site-author
// responses on the public site. The editor page owns page/q/focus (mirrored
// into the hash) so a comment row can be deep-linked from the sidebar.
export function ContentCommentsPanel({ client, contentId, page, q, focus, onParamsChange }: ContentCommentsPanelProps) {
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['admin-profile'], queryFn: () => client.adminProfile() })
  const [search, setSearch] = useState(q)
  const [author, setAuthor] = useState('')
  const [authorTouched, setAuthorTouched] = useState(false)
  const [body, setBody] = useState('')
  const [replyTarget, setReplyTarget] = useState<AdminComment | null>(null)
  const [editTarget, setEditTarget] = useState<AdminComment | null>(null)
  const [editAuthorName, setEditAuthorName] = useState('')
  const [editAuthorUrl, setEditAuthorUrl] = useState('')
  const [editAvatarSeed, setEditAvatarSeed] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const paramsChangeRef = useRef(onParamsChange)
  useEffect(() => { paramsChangeRef.current = onParamsChange })
  const highlightTimer = useRef<number | null>(null)

  const effectiveAuthor = authorTouched ? author : (author || profile.data?.displayName || '')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search.trim() !== q) paramsChangeRef.current({ q: search.trim(), page: 1, focus: undefined })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, q])

  const comments = useQuery({
    queryKey: ['admin-comments', { contentId, q, page, focus }],
    queryFn: () => client.adminComments({ contentId, q: q || undefined, page, focus: focus || undefined }),
  })

  const items = useMemo(() => comments.data?.data ?? [], [comments.data])
  const roots = items.filter((comment) => !comment.replyToId)
  const repliesByRoot = useMemo(() => {
    const map = new Map<string, AdminComment[]>()
    for (const comment of items) {
      if (!comment.replyToId) continue
      const bucket = map.get(comment.replyToId) ?? []
      bucket.push(comment)
      map.set(comment.replyToId, bucket)
    }
    return map
  }, [items])

  // Highlight is adjusted during render when the focus prop changes; the
  // scroll and focus-strip stay in the effect below (side effects only).
  const [seenFocus, setSeenFocus] = useState<string | null>(null)
  if (focus !== seenFocus) {
    setSeenFocus(focus)
    if (focus) setHighlight(focus)
  }

  useEffect(() => {
    if (!focus || comments.isPending || !items.length) return
    const node = document.getElementById(`comment-row-${focus}`)
    node?.scrollIntoView({ block: 'center' })
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlight(null), 3000)
    paramsChangeRef.current({ focus: undefined })
  }, [focus, comments.isPending, items.length])
  useEffect(() => () => { if (highlightTimer.current) window.clearTimeout(highlightTimer.current) }, [])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-comments'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-content'] })
  }

  const create = useMutation({
    mutationFn: (input: CreateCommentInput) => client.adminCreateComment(contentId, input),
    onSuccess: () => {
      setBody('')
      setReplyTarget(null)
      setError(null)
      invalidate()
      if (!replyTarget && page !== 1) onParamsChange({ page: 1, focus: undefined })
    },
    onError: () => setError('The comment could not be posted. Try again.'),
  })
  const moderate = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'delete' | 'restore' | 'hide' | 'unhide' }) => {
      if (action === 'delete') return client.deleteComment(id)
      if (action === 'restore') return client.restoreComment(id)
      if (action === 'hide') return client.hideComment(id)
      return client.unhideComment(id)
    },
    onSuccess: invalidate,
    onError: () => setError('The comment could not be updated. Try again.'),
  })
  const updateAuthor = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCommentInput }) => client.updateCommentAuthor(id, input),
    onSuccess: () => {
      setEditTarget(null)
      setError(null)
      invalidate()
    },
    onError: () => setError('The author details could not be updated. Try again.'),
  })

  const moderateComment = (id: string, action: 'delete' | 'restore' | 'hide' | 'unhide') => moderate.mutate({ id, action })

  const beginAuthorEdit = (comment: AdminComment) => {
    setEditTarget(comment)
    setEditAuthorName(comment.authorName)
    setEditAuthorUrl(comment.authorUrl ?? '')
    setEditAvatarSeed(comment.avatarSeed)
    setError(null)
  }

  const submitAuthorEdit = () => {
    if (!editTarget || updateAuthor.isPending) return
    updateAuthor.mutate({
      id: editTarget.id,
      input: {
        authorName: editAuthorName.trim(),
        authorUrl: editAuthorUrl.trim() || null,
        avatarSeed: editAvatarSeed.trim(),
      },
    })
  }

  const submit = () => {
    if (!body.trim() || create.isPending) return
    create.mutate({ authorName: effectiveAuthor.trim() || undefined, body, replyToId: replyTarget?.id })
  }

  return <section className="panel comment-mgmt">
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
    {comments.isError && <p className="content-list-error">Comments could not be loaded. Please try again.</p>}
    {comments.isPending && <p className="content-list-hint">Loading…</p>}
    {!comments.isPending && !comments.isError && !roots.length && <p className="content-list-hint">{q ? 'No comments match this search.' : 'No comments yet — start the thread below.'}</p>}
    <div className="comment-thread-list">
      {roots.map((root) => <CommentNode
        key={root.id}
        comment={root}
        replies={repliesByRoot.get(root.id) ?? []}
        highlighted={highlight === root.id}
        onModerate={moderateComment}
        onEdit={beginAuthorEdit}
        onReply={() => setReplyTarget(root)}
      />)}
    </div>
    <Pager page={comments.data?.pagination.page ?? page} totalPages={comments.data?.pagination.totalPages ?? 1} onChange={(next) => onParamsChange({ page: next, focus: undefined })} />
    {replyTarget && <div className="comment-reply-note">
      <CornerDownRight size={13} />
      <span>Replying to <strong>{replyTarget.authorName || 'Anonymous'}</strong> · {replyTarget.body.length > 90 ? `${replyTarget.body.slice(0, 90)}…` : replyTarget.body}</span>
      <button type="button" className="mini-button" onClick={() => setReplyTarget(null)}>Cancel</button>
    </div>}
    <div className="comment-composer">
      <TextInput
        label="Author"
        description="Prefilled from your profile; left empty the comment posts as Anonymous."
        value={effectiveAuthor}
        onChange={(event) => { setAuthor(event.currentTarget.value); setAuthorTouched(true) }}
        disabled={create.isPending}
      />
      <Textarea
        label={replyTarget ? 'Reply' : 'Comment'}
        placeholder={replyTarget ? `Answer ${replyTarget.authorName || 'Anonymous'}…` : 'Write a note in this thread…'}
        value={body}
        onChange={(event) => setBody(event.currentTarget.value)}
        minRows={3}
        autosize
        disabled={create.isPending}
      />
      {error && <Alert color="red" variant="light" withCloseButton onClose={() => setError(null)}>{error}</Alert>}
      <div className="comment-composer-actions">
        <Button className="button button-primary" leftSection={<MessageCircle size={15} />} disabled={!body.trim()} loading={create.isPending} onClick={submit}>{replyTarget ? 'Post reply' : 'Post comment'}</Button>
      </div>
    </div>
    <Modal opened={Boolean(editTarget)} onClose={() => setEditTarget(null)} title="Edit author" centered>
      <div className="comment-author-editor">
        <TextInput label="Name" value={editAuthorName} onChange={(event) => setEditAuthorName(event.currentTarget.value)} disabled={updateAuthor.isPending} />
        <TextInput label="Website" value={editAuthorUrl} onChange={(event) => setEditAuthorUrl(event.currentTarget.value)} disabled={updateAuthor.isPending} />
        <TextInput label="Avatar seed" value={editAvatarSeed} onChange={(event) => setEditAvatarSeed(event.currentTarget.value)} disabled={updateAuthor.isPending} />
        <div className="modal-actions">
          <Button variant="default" onClick={() => setEditTarget(null)} disabled={updateAuthor.isPending}>Cancel</Button>
          <Button color="teal" onClick={submitAuthorEdit} loading={updateAuthor.isPending}>Save author</Button>
        </div>
      </div>
    </Modal>
  </section>
}

function CommentNode({ comment, replies, highlighted, onModerate, onEdit, onReply }: {
  comment: AdminComment
  replies: AdminComment[]
  highlighted: boolean
  onModerate: (id: string, action: 'delete' | 'restore' | 'hide' | 'unhide') => void
  onEdit: (comment: AdminComment) => void
  onReply: () => void
}) {
  const deleted = Boolean(comment.deletedAt)
  const hidden = comment.hidden
  const authorName = comment.authorName || 'Anonymous'
  const className = ['comment-node', highlighted && 'comment-focus', hidden && 'comment-node-hidden'].filter(Boolean).join(' ')
  return <article id={`comment-row-${comment.id}`} className={className}>
    <div className="comment-avatar" aria-hidden="true">{authorName.slice(0, 1).toUpperCase()}</div>
    <div className="comment-node-body">
      <div className="row-title">
        <strong>{authorName}</strong>
        <span>{formatDate(comment.createdAt)}</span>
        {hidden && <span className="hidden-tag">hidden</span>}
        {deleted && <span className="deleted-tag">deleted</span>}
      </div>
      <p>{comment.body}</p>
      <div className="comment-node-actions">
        {!deleted && <Button size="compact-xs" variant="default" leftSection={<CornerDownRight size={12} />} onClick={onReply}>Reply</Button>}
        {!deleted && <Button size="compact-xs" variant="default" leftSection={<Pencil size={12} />} onClick={() => onEdit(comment)}>Edit author</Button>}
        {deleted
          ? <ConfirmButton label="Restore" confirmLabel="Restore" confirmBody="Make this comment visible on the public site again." leftSection={<RotateCcw size={13} />} onConfirm={() => onModerate(comment.id, 'restore')} />
          : <>
            {hidden
              ? <Button size="compact-xs" variant="light" color="teal" leftSection={<Eye size={13} />} onClick={() => onModerate(comment.id, 'unhide')}>Unhide</Button>
              : <ConfirmButton label="Hide" confirmLabel="Hide" confirmBody="Hide this comment from the public site? Its replies remain visible." icon={<EyeOff size={13} />} onConfirm={() => onModerate(comment.id, 'hide')} />}
            <ConfirmButton label="Delete" confirmLabel="Delete" confirmBody="Delete this comment? It leaves the public site immediately." danger icon={<Trash2 size={13} />} onConfirm={() => onModerate(comment.id, 'delete')} />
          </>}
      </div>
        {replies.length > 0 && <div className="comment-replies">
        {replies.map((reply) => <CommentReply key={reply.id} reply={reply} onModerate={onModerate} onEdit={onEdit} />)}
      </div>}
    </div>
  </article>
}

function CommentReply({ reply, onModerate, onEdit }: { reply: AdminComment; onModerate: (id: string, action: 'delete' | 'restore' | 'hide' | 'unhide') => void; onEdit: (comment: AdminComment) => void }) {
  const deleted = Boolean(reply.deletedAt)
  const hidden = reply.hidden
  const authorName = reply.authorName || 'Anonymous'
  const className = ['comment-reply', deleted && 'comment-reply-deleted', hidden && 'comment-reply-hidden'].filter(Boolean).join(' ')
  return <div id={`comment-row-${reply.id}`} className={className}>
    <div className="comment-avatar small" aria-hidden="true">{authorName.slice(0, 1).toUpperCase()}</div>
    <div className="comment-node-body">
      <div className="row-title">
        <strong>{authorName}</strong>
        <span>{formatDate(reply.createdAt)}</span>
        {hidden && <span className="hidden-tag">hidden</span>}
        {deleted && <span className="deleted-tag">deleted</span>}
      </div>
      <p>{reply.body}</p>
      <div className="comment-node-actions">
        {!deleted && <Button size="compact-xs" variant="default" leftSection={<Pencil size={12} />} onClick={() => onEdit(reply)}>Edit author</Button>}
        {deleted
          ? <ConfirmButton label="Restore" confirmLabel="Restore" confirmBody="Make this comment visible on the public site again." leftSection={<RotateCcw size={13} />} onConfirm={() => onModerate(reply.id, 'restore')} />
          : <>
            {hidden
              ? <Button size="compact-xs" variant="light" color="teal" leftSection={<Eye size={13} />} onClick={() => onModerate(reply.id, 'unhide')}>Unhide</Button>
              : <ConfirmButton label="Hide" confirmLabel="Hide" confirmBody="Hide this comment from the public site? Its replies remain visible." icon={<EyeOff size={13} />} onConfirm={() => onModerate(reply.id, 'hide')} />}
            <ConfirmButton label="Delete" confirmLabel="Delete" confirmBody="Delete this comment? It leaves the public site immediately." danger icon={<Trash2 size={13} />} onConfirm={() => onModerate(reply.id, 'delete')} />
          </>}
      </div>
    </div>
  </div>
}
