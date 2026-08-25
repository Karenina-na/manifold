import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Badge } from '@mantine/core'
import { Check, MessageCircle, X } from 'lucide-react'
import { useMemo } from 'react'
import type { Comment } from '@manifold/contracts'
import { createAdminClient } from '../api'

export function CommentsWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const comments = useQuery({ queryKey: ['admin-comments'], queryFn: () => client.adminComments('PENDING') })
  const mutation = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => action === 'approve' ? client.approveComment(id) : client.rejectComment(id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin-comments'] }); void queryClient.invalidateQueries({ queryKey: ['admin-stats'] }) } })
  return <section className="workspace"><div className="page-heading"><div><p className="kicker">Moderation</p><h1>Review comments.</h1><p className="subheading">Approve or reject public responses.</p></div><Badge className="queue-badge" leftSection={<MessageCircle size={15} />}>{comments.isLoading ? 'Loading' : `${comments.data?.data.length ?? 0} pending`}</Badge></div><section className="panel moderation-panel">{comments.isLoading && <p className="muted">Loading queue...</p>}{comments.data?.data.length === 0 && <div className="empty-state"><Check size={28} /><h2>Queue is clear.</h2><p>There is nothing waiting for review.</p></div>}<div className="moderation-list">{comments.data?.data.map((comment: Comment) => { const authorName = comment.authorName || 'Anonymous'; return <article className="moderation-row" key={comment.id}><div className="comment-avatar">{authorName.slice(0, 1).toUpperCase()}</div><div className="moderation-body"><div className="row-title">{authorName}<span>{new Date(comment.createdAt).toLocaleDateString()}</span></div><p>{comment.body}</p><small>Content ID: {comment.contentId}</small></div><div className="row-actions"><ActionIcon color="teal" variant="light" type="button" title="Approve" aria-label={`Approve comment from ${authorName}`} onClick={() => mutation.mutate({ id: comment.id, action: 'approve' })} disabled={mutation.isPending}><Check size={15} /></ActionIcon><ActionIcon color="red" variant="light" type="button" title="Reject" aria-label={`Reject comment from ${authorName}`} onClick={() => mutation.mutate({ id: comment.id, action: 'reject' })} disabled={mutation.isPending}><X size={15} /></ActionIcon></div></article> })}</div></section></section>
}

export default CommentsWorkspace
