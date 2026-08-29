import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Badge } from '@mantine/core'
import { MessageCircle, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import type { Comment } from '@manifold/contracts'
import { createAdminClient } from '../api'

export function CommentsWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const comments = useQuery({ queryKey: ['admin-comments'], queryFn: () => client.adminComments() })
  const mutation = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'delete' | 'restore' }) => action === 'delete' ? client.deleteComment(id) : client.restoreComment(id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin-comments'] }); void queryClient.invalidateQueries({ queryKey: ['admin-overview'] }) } })
  return <section className="workspace"><div className="page-heading"><div><p className="kicker">Moderation</p><h1>Manage comments.</h1><p className="subheading">Comments are public immediately. Soft-delete anything that does not belong.</p></div><Badge className="queue-badge" leftSection={<MessageCircle size={15} />}>{comments.isLoading ? 'Loading' : `${comments.data?.data.length ?? 0} total`}</Badge></div><section className="panel moderation-panel">{comments.isLoading && <p className="muted">Loading comments...</p>}{comments.data?.data.length === 0 && <div className="empty-state"><MessageCircle size={28} /><h2>No comments yet.</h2><p>Reader responses will appear here.</p></div>}<div className="moderation-list">{comments.data?.data.map((comment: Comment) => { const authorName = comment.authorName || 'Anonymous'; const deleted = Boolean(comment.deletedAt); return <article className={`moderation-row${deleted ? ' moderation-row-deleted' : ''}`} key={comment.id}><div className="comment-avatar">{authorName.slice(0, 1).toUpperCase()}</div><div className="moderation-body"><div className="row-title">{authorName}{comment.replyToId && <span className="reply-tag">reply</span>}<span>{new Date(comment.createdAt).toLocaleDateString()}</span>{deleted && comment.deletedAt && <span>deleted {new Date(comment.deletedAt).toLocaleDateString()}</span>}</div><p>{comment.body}</p><small>Content ID: {comment.contentId}</small></div><div className="row-actions">{deleted ? <ActionIcon color="teal" variant="light" type="button" title="Restore" aria-label={`Restore comment from ${authorName}`} onClick={() => mutation.mutate({ id: comment.id, action: 'restore' })} disabled={mutation.isPending}><RotateCcw size={15} /></ActionIcon> : <ActionIcon color="red" variant="light" type="button" title="Delete" aria-label={`Delete comment from ${authorName}`} onClick={() => mutation.mutate({ id: comment.id, action: 'delete' })} disabled={mutation.isPending}><Trash2 size={15} /></ActionIcon>}</div></article> })}</div></section></section>
}

export default CommentsWorkspace
