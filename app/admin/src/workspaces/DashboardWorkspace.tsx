import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@mantine/core'
import { ChevronLeft, ChevronRight, Eye, FileText, MessageCircle, PenLine, RefreshCw, ThumbsUp, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SystemStatus } from '@manifold/contracts'
import { createAdminClient } from '../api'

const ANALYTICS_DAYS = 30
const PANEL_PAGE_SIZE = 10
const AUDIT_DEBOUNCE_MS = 250

const numberFormat = new Intl.NumberFormat('en')

function formatCount(value: number | undefined) {
  return value === undefined ? '—' : numberFormat.format(value)
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function DashboardWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: () => client.adminOverview() })
  const analytics = useQuery({ queryKey: ['admin-analytics', ANALYTICS_DAYS], queryFn: () => client.adminAnalyticsViews({ days: ANALYTICS_DAYS }) })
  const system = useQuery({ queryKey: ['admin-system'], queryFn: () => client.adminSystem() })
  const comments = useQuery({ queryKey: ['admin-comments', 'recent'], queryFn: () => client.adminComments({ pageSize: 50 }) })

  const [commentSearch, setCommentSearch] = useState('')
  const [commentPage, setCommentPage] = useState(1)
  const activeComments = useMemo(() => (comments.data?.data ?? []).filter((comment) => !comment.deletedAt), [comments.data])
  const filteredComments = useMemo(() => {
    const needle = commentSearch.trim().toLowerCase()
    if (!needle) return activeComments
    return activeComments.filter((comment) => comment.authorName.toLowerCase().includes(needle) || comment.body.toLowerCase().includes(needle))
  }, [activeComments, commentSearch])
  const commentPageCount = Math.max(1, Math.ceil(filteredComments.length / PANEL_PAGE_SIZE))
  const safeCommentPage = Math.min(commentPage, commentPageCount)
  const commentRows = filteredComments.slice((safeCommentPage - 1) * PANEL_PAGE_SIZE, safeCommentPage * PANEL_PAGE_SIZE)
  const commentTotal = comments.data?.pagination.totalItems ?? filteredComments.length

  const [auditSearch, setAuditSearch] = useState('')
  const [auditPage, setAuditPage] = useState(1)
  const debouncedAuditSearch = useDebouncedValue(auditSearch, AUDIT_DEBOUNCE_MS)
  const audit = useQuery({ queryKey: ['admin-audit', auditPage, debouncedAuditSearch], queryFn: () => client.adminAudit({ page: auditPage, pageSize: PANEL_PAGE_SIZE, q: debouncedAuditSearch }) })

  const content = overview.data?.content
  const trendData = overview.data?.trend.monthly.map((point) => ({ ...point, label: point.month.slice(2) })) ?? []
  const viewsData = analytics.data?.daily.map((day) => ({ ...day, label: day.date.slice(5) })) ?? []
  const tagData = overview.data?.tags ?? []
  const auditPagination = audit.data?.pagination

  const refresh = () => {
    void overview.refetch()
    void analytics.refetch()
    void system.refetch()
    void comments.refetch()
    void audit.refetch()
  }
  const refreshSystem = () => { void queryClient.invalidateQueries({ queryKey: ['admin-system'] }) }

  return <section className="workspace">
    <div className="page-heading">
      <div>
        <p className="kicker">Overview</p>
        <h1>Dashboard</h1>
        <p className="subheading">Content, traffic, activity, and system health at a glance.</p>
      </div>
      <button className="button button-ghost" type="button" onClick={refresh}><RefreshCw size={16} /> Refresh</button>
    </div>
    {(overview.isError || analytics.isError) && <p className="callout error">The dashboard could not reach Core.</p>}
    <div className="metric-grid wide">
      <Metric label="Published" value={formatCount(content?.contentCount)} icon={<FileText size={18} />} />
      <Metric label="Drafts" value={formatCount(content?.draftCount)} icon={<PenLine size={18} />} />
      <Metric label="Total views" value={formatCount(content?.totalViews)} icon={<Eye size={18} />} />
      <Metric label="Likes" value={formatCount(content?.totalLikes)} icon={<ThumbsUp size={18} />} />
      <Metric label="Comments" value={formatCount(content?.totalComments)} icon={<MessageCircle size={18} />} />
      <Metric label="Visitors now" value={formatCount(content?.activeVisitors)} icon={<Users size={18} />} />
    </div>
    <div className="dash-grid">
      <ChartPanel title="Content growth" hint="Created vs published per month">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trendData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="createdFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#b5503a" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#b5503a" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="publishedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2f785c" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#2f785c" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#deddd4" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#77807b' }} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#77807b' }} tickLine={false} axisLine={false} />
            <Tooltip />
            <Area type="monotone" dataKey="created" name="Created" stroke="#b5503a" fill="url(#createdFill)" strokeWidth={2} />
            <Area type="monotone" dataKey="published" name="Published" stroke="#2f785c" fill="url(#publishedFill)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartPanel>
      <ChartPanel title={`Views · last ${ANALYTICS_DAYS} days`} hint={analytics.data ? `${formatCount(analytics.data.uniqueVisitors)} unique visitors` : undefined}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={viewsData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#b5503a" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#b5503a" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#deddd4" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#77807b' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#77807b' }} tickLine={false} axisLine={false} />
            <Tooltip />
            <Area type="monotone" dataKey="views" name="Views" stroke="#b5503a" fill="url(#viewsFill)" strokeWidth={2} />
            <Area type="monotone" dataKey="uniqueVisitors" name="Unique visitors" stroke="#77807b" fillOpacity={0} strokeWidth={1.5} strokeDasharray="4 3" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
    <div className="dash-grid">
      <section className="panel" aria-label="Top content">
        <div className="panel-heading"><div><p className="kicker">Ranking</p><h2>Top content</h2></div><Badge color="orange" variant="light">Top 5</Badge></div>
        {(overview.data?.topContent.length ?? 0) === 0 && <p className="muted">Published content will rank here as views come in.</p>}
        <ul className="dash-list">
          {overview.data?.topContent.map((item, index) => <li key={item.id}>
            <span className="dash-main">
              <strong>{index + 1}. {item.title || item.slug || item.id}</strong>
              <span className="dash-meta">{item.kind === 'ARTICLE' ? 'Writing' : 'Thought'} · {formatCount(item.viewCount)} views · {formatCount(item.likeCount)} likes · {formatCount(item.commentCount)} comments</span>
            </span>
            <span className="dash-value"><Eye size={13} /> {formatCount(item.viewCount)}</span>
          </li>)}
        </ul>
      </section>
      <ChartPanel title="Tag distribution" hint="Top 10 by published usage">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={tagData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="#deddd4" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#77807b' }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11, fill: '#252a28' }} tickLine={false} axisLine={false} />
            <Tooltip />
            <Bar dataKey="count" name="Content" fill="#b5503a" barSize={12} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
    <div className="dash-grid">
      <section className="panel panel-stack" aria-label="Recent comments">
        <div className="panel-heading"><div><p className="kicker">Community</p><h2>Recent comments</h2></div><Badge color="teal" variant="light">{formatCount(commentTotal)}</Badge></div>
        <input className="panel-search" type="search" value={commentSearch} placeholder="Search comments" aria-label="Search comments" onChange={(event) => { setCommentSearch(event.target.value); setCommentPage(1) }} />
        {commentRows.length === 0 && <p className="muted">{commentSearch ? 'No matching comments.' : 'No comments yet.'}</p>}
        <ul className="dash-list">
          {commentRows.map((comment) => <li key={comment.id}>
            <span className="dash-main">
              <strong>{comment.authorName || 'Anonymous'}</strong>
              <span className="dash-meta">{comment.body.length > 120 ? `${comment.body.slice(0, 120)}…` : comment.body}</span>
            </span>
            <span className="dash-value">{relativeTime(comment.createdAt)}</span>
          </li>)}
        </ul>
        <PanelPager page={safeCommentPage} pageCount={commentPageCount} onPage={setCommentPage} />
      </section>
      <section className="panel panel-stack" aria-label="Recent activity">
        <div className="panel-heading"><div><p className="kicker">Audit</p><h2>Recent activity</h2></div><Badge color="gray" variant="light">{auditPagination ? `${formatCount(auditPagination.totalItems)} events` : '…'}</Badge></div>
        <input className="panel-search" type="search" value={auditSearch} placeholder="Search activity" aria-label="Search activity" onChange={(event) => { setAuditSearch(event.target.value); setAuditPage(1) }} />
        {(audit.data?.events.length ?? 0) === 0 && <p className="muted">{debouncedAuditSearch ? 'No matching activity.' : 'Activity will appear here as the garden changes.'}</p>}
        <ul className="dash-list">
          {audit.data?.events.map((event) => <li key={event.id}>
            <span className="dash-main">
              <strong>{describeEvent(event.eventName)}</strong>
              <span className="dash-meta">{event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ''}{event.actor !== 'anonymous' ? ` · ${event.actor}` : ''}</span>
            </span>
            <span className="dash-value">{relativeTime(event.createdAt)}</span>
          </li>)}
        </ul>
        <PanelPager page={auditPagination?.page ?? 1} pageCount={auditPagination?.totalPages ?? 1} onPage={setAuditPage} />
      </section>
    </div>
    <SystemPanel status={system.data} onRefresh={refreshSystem} refreshing={system.isFetching} />
  </section>
}

function PanelPager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  return <div className="panel-pager">
    <button className="mini-button" type="button" disabled={page <= 1} aria-label="Previous page" onClick={() => onPage(page - 1)}><ChevronLeft size={15} /></button>
    <span className="dash-meta">Page {page} of {pageCount}</span>
    <button className="mini-button" type="button" disabled={page >= pageCount} aria-label="Next page" onClick={() => onPage(page + 1)}><ChevronRight size={15} /></button>
  </div>
}

function describeEvent(eventName: string) {
  const labels: Record<string, string> = {
    'admin.session.created': 'Signed in',
    'content.created': 'Content created',
    'content.updated': 'Content updated',
    'content.published': 'Content published',
    'content.unpublished': 'Content unpublished',
    'content.deleted': 'Content deleted',
    'content.viewed': 'Content viewed',
    'content.like.added': 'Like added',
    'content.like.removed': 'Like removed',
    'comment.created': 'Comment posted',
    'comment.deleted': 'Comment removed',
    'comment.restored': 'Comment restored',
    'profile.updated': 'Profile updated',
    'site.updated': 'Site composition updated',
    'thoughts.config.updated': 'Thoughts config updated',
  }
  return labels[eventName] ?? eventName
}

function ChartPanel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <section className="panel">
    <div className="panel-heading">
      <div><p className="kicker">Trend</p><h2>{title}</h2></div>
      {hint && <span className="count-badge">{hint}</span>}
    </div>
    <div className="chart-wrap">{children}</div>
  </section>
}

function SystemPanel({ status, onRefresh, refreshing }: { status: SystemStatus | undefined; onRefresh: () => void; refreshing: boolean }) {
  return <section className="panel" aria-label="System health">
    <div className="panel-heading">
      <div><p className="kicker">System</p><h2>Core health</h2></div>
      <div className="panel-heading-actions">
        {status && <Badge color="teal" variant="light" leftSection={<span className="status-dot published" />}>Healthy</Badge>}
        {!status && <span className="muted">System metrics unavailable.</span>}
        <button className="mini-button" type="button" aria-label="Refresh system status" onClick={onRefresh}><RefreshCw size={14} className={refreshing ? 'spin' : undefined} /></button>
      </div>
    </div>
    {status && <div className="system-donuts">
      <SystemDonut label="CPU" percent={status.resources.cpuPercent} />
      <SystemDonut label="Memory" percent={status.resources.memUsedPercent} />
      <SystemDonut label="Disk" percent={status.resources.diskUsedPercent} />
    </div>}
    <div className="system-grid">
      <SystemCell label="Version" value={status?.version ?? '—'} />
      <SystemCell label="Uptime" value={status ? formatUptime(status.uptimeSeconds) : '—'} />
      <SystemCell label="Host" value={status ? [status.host.hostname, status.host.platform].filter(Boolean).join(' · ') : '—'} />
      <SystemCell label="CPU" value={status ? `${status.resources.cpuCores} cores · ${status.resources.cpuPercent.toFixed(1)}%` : '—'} />
      <SystemCell label="Memory" value={status ? `${formatBytes(status.resources.memUsedBytes)} / ${formatBytes(status.resources.memTotalBytes)} · ${status.resources.memUsedPercent.toFixed(1)}%` : '—'} />
      <SystemCell label="Disk" value={status ? `${formatBytes(status.resources.diskUsedBytes)} / ${formatBytes(status.resources.diskTotalBytes)} · ${status.resources.diskUsedPercent.toFixed(1)}%` : '—'} />
      <SystemCell label="Load average" value={status ? `${status.resources.loadAvg1.toFixed(2)} / ${status.resources.loadAvg5.toFixed(2)} / ${status.resources.loadAvg15.toFixed(2)}` : '—'} />
      <SystemCell label="Process RSS" value={status ? formatBytes(status.runtime.sysRssBytes) : '—'} />
      <SystemCell label="Heap" value={status ? formatBytes(status.runtime.heapAllocBytes) : '—'} />
      <SystemCell label="Goroutines" value={status ? String(status.runtime.numGoroutine) : '—'} />
      <SystemCell label="Database" value={status ? formatBytes(status.database.sizeBytes) : '—'} />
      <SystemCell label="Content cache" value={status ? `${status.caches.contentEntries} entries` : '—'} />
      <SystemCell label="Audit events" value={status ? formatCount(status.auditEventCount) : '—'} />
      <SystemCell label="Started at" value={status ? new Date(status.startedAt).toLocaleString('en') : '—'} />
    </div>
  </section>
}

function SystemCell({ label, value }: { label: string; value: string }) {
  return <div className="system-cell"><strong>{value}</strong><span>{label}</span></div>
}

function SystemDonut({ label, percent }: { label: string; percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const data = [
    { name: 'Used', value: clamped },
    { name: 'Free', value: Math.max(0, 100 - clamped) },
  ]
  return <div className="system-donut">
    <div className="system-donut-chart">
      <ResponsiveContainer width="100%" height={96}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={30} outerRadius={43} startAngle={90} endAngle={-270} strokeWidth={0} isAnimationActive={false}>
            <Cell fill="#b5503a" />
            <Cell fill="#e8e6dd" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <span className="system-donut-value">{clamped.toFixed(1)}%</span>
    </div>
    <span className="system-donut-label">{label}</span>
  </div>
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return <article className="metric-card"><span className="metric-icon">{icon}</span><strong>{value}</strong><span>{label}</span></article>
}

export default DashboardWorkspace
