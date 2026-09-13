import { Alert, Button, Modal, Textarea, TextInput } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CornerDownRight, Eye, EyeOff, MessageCircle, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminComment, CreateCommentInput, UpdateCommentInput } from '@manifold/contracts'
import type { ManifoldClient } from '@manifold/sdk'
import { activeLocale, formatDate } from '../../i18n/format'
import { ConfirmButton } from '../common/ConfirmButton'
import { Pager } from '../common/Pager'

type ContentCommentsPanelProps = { client: ManifoldClient; contentId: string; page: number; q: string; focus: string; onParamsChange: (next: { page?: number; q?: string; focus?: string }) => void }
type Moderate = (id: string, action: 'delete' | 'restore' | 'hide' | 'unhide') => void

export function ContentCommentsPanel({ client, contentId, page, q, focus, onParamsChange }: ContentCommentsPanelProps) {
  const { t } = useTranslation()
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
  useEffect(() => { const timer = window.setTimeout(() => { if (search.trim() !== q) paramsChangeRef.current({ q: search.trim(), page: 1, focus: undefined }) }, 300); return () => window.clearTimeout(timer) }, [search, q])
  const comments = useQuery({ queryKey: ['admin-comments', { contentId, q, page, focus }], queryFn: () => client.adminComments({ contentId, q: q || undefined, page, focus: focus || undefined }) })
  const items = useMemo(() => comments.data?.data ?? [], [comments.data])
  const roots = items.filter((comment) => !comment.replyToId)
  const repliesByRoot = useMemo(() => { const map = new Map<string, AdminComment[]>(); for (const comment of items) { if (!comment.replyToId) continue; const bucket = map.get(comment.replyToId) ?? []; bucket.push(comment); map.set(comment.replyToId, bucket) } return map }, [items])
  const [seenFocus, setSeenFocus] = useState<string | null>(null)
  if (focus !== seenFocus) { setSeenFocus(focus); if (focus) setHighlight(focus) }
  useEffect(() => {
    if (!focus || comments.isPending || !items.length) return
    document.getElementById(`comment-row-${focus}`)?.scrollIntoView({ block: 'center' })
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlight(null), 3000)
    paramsChangeRef.current({ focus: undefined })
  }, [focus, comments.isPending, items.length])
  useEffect(() => () => { if (highlightTimer.current) window.clearTimeout(highlightTimer.current) }, [])
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['admin-comments'] }); void queryClient.invalidateQueries({ queryKey: ['admin-overview'] }); void queryClient.invalidateQueries({ queryKey: ['admin-content'] }) }
  const create = useMutation({ mutationFn: (input: CreateCommentInput) => client.adminCreateComment(contentId, input), onSuccess: () => { setBody(''); setReplyTarget(null); setError(null); invalidate(); if (!replyTarget && page !== 1) onParamsChange({ page: 1, focus: undefined }) }, onError: () => setError(t('comments.postError')) })
  const moderate = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'delete' | 'restore' | 'hide' | 'unhide' }) => action === 'delete' ? client.deleteComment(id) : action === 'restore' ? client.restoreComment(id) : action === 'hide' ? client.hideComment(id) : client.unhideComment(id), onSuccess: invalidate, onError: () => setError(t('comments.updateError')) })
  const updateAuthor = useMutation({ mutationFn: ({ id, input }: { id: string; input: UpdateCommentInput }) => client.updateCommentAuthor(id, input), onSuccess: () => { setEditTarget(null); setError(null); invalidate() }, onError: () => setError(t('comments.authorUpdateError')) })
  const beginAuthorEdit = (comment: AdminComment) => { setEditTarget(comment); setEditAuthorName(comment.authorName); setEditAuthorUrl(comment.authorUrl ?? ''); setEditAvatarSeed(comment.avatarSeed); setError(null) }
  const submitAuthorEdit = () => { if (editTarget && !updateAuthor.isPending) updateAuthor.mutate({ id: editTarget.id, input: { authorName: editAuthorName.trim(), authorUrl: editAuthorUrl.trim() || null, avatarSeed: editAvatarSeed.trim() } }) }
  const submit = () => { if (body.trim() && !create.isPending) create.mutate({ authorName: effectiveAuthor.trim() || undefined, body, replyToId: replyTarget?.id }) }
  const anonymous = t('common.anonymous')
  return <section className="panel comment-mgmt">
    <div className="content-toolbar"><TextInput leftSection={<Search size={14} />} placeholder={t('comments.search')} aria-label={t('comments.search')} value={search} onChange={(event) => setSearch(event.currentTarget.value)} /><span className="content-toolbar-count">{t('common.count.comments', { count: comments.data?.pagination.totalItems ?? 0 })}</span></div>
    {comments.isError && <p className="content-list-error">{t('comments.loadError')}</p>}{comments.isPending && <p className="content-list-hint">{t('common.loading')}</p>}{!comments.isPending && !comments.isError && !roots.length && <p className="content-list-hint">{t(q ? 'comments.noMatch' : 'comments.noneThread')}</p>}
    <div className="comment-thread-list">{roots.map((root) => <CommentNode key={root.id} comment={root} replies={repliesByRoot.get(root.id) ?? []} highlighted={highlight === root.id} onModerate={(id, action) => moderate.mutate({ id, action })} onEdit={beginAuthorEdit} onReply={() => setReplyTarget(root)} />)}</div>
    <Pager page={comments.data?.pagination.page ?? page} totalPages={comments.data?.pagination.totalPages ?? 1} onChange={(next) => onParamsChange({ page: next, focus: undefined })} />
    {replyTarget && <div className="comment-reply-note"><CornerDownRight size={13} /><span>{t('comments.replying', { author: replyTarget.authorName || anonymous, body: replyTarget.body.length > 90 ? `${replyTarget.body.slice(0, 90)}…` : replyTarget.body })}</span><button type="button" className="mini-button" onClick={() => setReplyTarget(null)}>{t('common.cancel')}</button></div>}
    <div className="comment-composer">
      <TextInput label={t('comments.author')} description={t('comments.authorDescription')} value={effectiveAuthor} onChange={(event) => { setAuthor(event.currentTarget.value); setAuthorTouched(true) }} disabled={create.isPending} />
      <Textarea label={t(replyTarget ? 'comments.reply' : 'comments.comment')} placeholder={replyTarget ? t('comments.answer', { author: replyTarget.authorName || anonymous }) : t('comments.write')} value={body} onChange={(event) => setBody(event.currentTarget.value)} minRows={3} autosize disabled={create.isPending} />
      {error && <Alert color="red" variant="light" withCloseButton onClose={() => setError(null)}>{error}</Alert>}
      <div className="comment-composer-actions"><Button className="button button-primary" leftSection={<MessageCircle size={15} />} disabled={!body.trim()} loading={create.isPending} onClick={submit}>{t(replyTarget ? 'comments.postReply' : 'comments.postComment')}</Button></div>
    </div>
    <Modal opened={Boolean(editTarget)} onClose={() => setEditTarget(null)} title={t('comments.editAuthor')} centered><div className="comment-author-editor"><TextInput label={t('comments.name')} value={editAuthorName} onChange={(event) => setEditAuthorName(event.currentTarget.value)} disabled={updateAuthor.isPending} /><TextInput label={t('comments.website')} value={editAuthorUrl} onChange={(event) => setEditAuthorUrl(event.currentTarget.value)} disabled={updateAuthor.isPending} /><TextInput label={t('comments.avatarSeed')} value={editAvatarSeed} onChange={(event) => setEditAvatarSeed(event.currentTarget.value)} disabled={updateAuthor.isPending} /><div className="modal-actions"><Button variant="default" onClick={() => setEditTarget(null)} disabled={updateAuthor.isPending}>{t('common.cancel')}</Button><Button color="teal" onClick={submitAuthorEdit} loading={updateAuthor.isPending}>{t('comments.saveAuthor')}</Button></div></div></Modal>
  </section>
}

function CommentActions({ id, deleted, hidden, onModerate, onEdit, onReply }: { id: string; deleted: boolean; hidden: boolean; onModerate: Moderate; onEdit: () => void; onReply?: () => void }) {
  const { t } = useTranslation()
  return <div className="comment-node-actions">{onReply && !deleted && <Button size="compact-xs" variant="default" leftSection={<CornerDownRight size={12} />} onClick={onReply}>{t('comments.reply')}</Button>}{!deleted && <Button size="compact-xs" variant="default" leftSection={<Pencil size={12} />} onClick={onEdit}>{t('comments.editAuthor')}</Button>}{deleted ? <ConfirmButton label={t('common.restore')} confirmLabel={t('common.restore')} confirmBody={t('comments.restoreBody')} leftSection={<RotateCcw size={13} />} onConfirm={() => onModerate(id, 'restore')} /> : <>{hidden ? <Button size="compact-xs" variant="light" color="teal" leftSection={<Eye size={13} />} onClick={() => onModerate(id, 'unhide')}>{t('comments.unhide')}</Button> : <ConfirmButton label={t('comments.hide')} confirmLabel={t('comments.hide')} confirmBody={t('comments.hideBody')} icon={<EyeOff size={13} />} onConfirm={() => onModerate(id, 'hide')} />}<ConfirmButton label={t('common.delete')} confirmLabel={t('common.delete')} confirmBody={t('comments.deleteBody')} danger icon={<Trash2 size={13} />} onConfirm={() => onModerate(id, 'delete')} /></>}</div>
}

function CommentNode({ comment, replies, highlighted, onModerate, onEdit, onReply }: { comment: AdminComment; replies: AdminComment[]; highlighted: boolean; onModerate: Moderate; onEdit: (comment: AdminComment) => void; onReply: () => void }) {
  const { t, i18n } = useTranslation(); const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const deleted = Boolean(comment.deletedAt); const hidden = comment.hidden; const authorName = comment.authorName || t('common.anonymous')
  return <article id={`comment-row-${comment.id}`} className={['comment-node', highlighted && 'comment-focus', hidden && 'comment-node-hidden'].filter(Boolean).join(' ')}><div className="comment-avatar" aria-hidden="true">{authorName.slice(0, 1).toUpperCase()}</div><div className="comment-node-body"><div className="row-title"><strong>{authorName}</strong><span>{formatDate(comment.createdAt, locale)}</span>{hidden && <span className="hidden-tag">{t('common.hidden')}</span>}{deleted && <span className="deleted-tag">{t('common.deleted')}</span>}</div><p>{comment.body}</p><CommentActions id={comment.id} deleted={deleted} hidden={hidden} onModerate={onModerate} onEdit={() => onEdit(comment)} onReply={onReply} />{replies.length > 0 && <div className="comment-replies">{replies.map((reply) => <CommentReply key={reply.id} reply={reply} onModerate={onModerate} onEdit={onEdit} />)}</div>}</div></article>
}

function CommentReply({ reply, onModerate, onEdit }: { reply: AdminComment; onModerate: Moderate; onEdit: (comment: AdminComment) => void }) {
  const { t, i18n } = useTranslation(); const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const deleted = Boolean(reply.deletedAt); const hidden = reply.hidden; const authorName = reply.authorName || t('common.anonymous')
  return <div id={`comment-row-${reply.id}`} className={['comment-reply', deleted && 'comment-reply-deleted', hidden && 'comment-reply-hidden'].filter(Boolean).join(' ')}><div className="comment-avatar small" aria-hidden="true">{authorName.slice(0, 1).toUpperCase()}</div><div className="comment-node-body"><div className="row-title"><strong>{authorName}</strong><span>{formatDate(reply.createdAt, locale)}</span>{hidden && <span className="hidden-tag">{t('common.hidden')}</span>}{deleted && <span className="deleted-tag">{t('common.deleted')}</span>}</div><p>{reply.body}</p><CommentActions id={reply.id} deleted={deleted} hidden={hidden} onModerate={onModerate} onEdit={() => onEdit(reply)} /></div></div>
}
