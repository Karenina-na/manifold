import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@mantine/core'
import { ChevronLeft, ChevronRight, Eye, FileText, MessageCircle, PenLine, RefreshCw, ThumbsUp, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SystemStatus } from '@manifold/contracts'
import type { TFunction } from 'i18next'
import { createAdminClient } from '../lib/api'
import { activeLocale, formatDateTime, formatNumber, formatRelativeTime } from '../i18n/format'
import type { Locale } from '../i18n/locale'

const ANALYTICS_DAYS = 30
const PANEL_PAGE_SIZE = 10
const AUDIT_DEBOUNCE_MS = 250

function formatCount(value: number | undefined, locale: Locale) {
  return value === undefined ? '—' : formatNumber(value, locale)
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatUptime(seconds: number, t: TFunction) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return t('dashboard.uptimeDays', { days, hours })
  if (hours > 0) return t('dashboard.uptimeHours', { hours, minutes })
  return t('dashboard.uptimeMinutes', { minutes })
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
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
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
  // placeholderData keeps the previous page's rows while the next page loads:
  // without it the list briefly renders empty, the document collapses, and the
  // browser clamps the scroll position to the bottom.
  const audit = useQuery({ queryKey: ['admin-audit', auditPage, debouncedAuditSearch], queryFn: () => client.adminAudit({ page: auditPage, pageSize: PANEL_PAGE_SIZE, q: debouncedAuditSearch }), placeholderData: keepPreviousData })

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
        <p className="kicker">{t('dashboard.kicker')}</p>
        <h1>{t('dashboard.title')}</h1>
        <p className="subheading">{t('dashboard.copy')}</p>
      </div>
      <button className="button button-ghost" type="button" onClick={refresh}><RefreshCw size={16} /> {t('dashboard.refresh')}</button>
    </div>
    {(overview.isError || analytics.isError) && <p className="callout error">{t('dashboard.error')}</p>}
    <div className="metric-grid wide">
      <Metric label={t('dashboard.metrics.published')} value={formatCount(content?.contentCount, locale)} icon={<FileText size={18} />} />
      <Metric label={t('dashboard.metrics.drafts')} value={formatCount(content?.draftCount, locale)} icon={<PenLine size={18} />} />
      <Metric label={t('dashboard.metrics.views')} value={formatCount(content?.totalViews, locale)} icon={<Eye size={18} />} />
      <Metric label={t('dashboard.metrics.likes')} value={formatCount(content?.totalLikes, locale)} icon={<ThumbsUp size={18} />} />
      <Metric label={t('dashboard.metrics.comments')} value={formatCount(content?.totalComments, locale)} icon={<MessageCircle size={18} />} />
      <Metric label={t('dashboard.metrics.visitors')} value={formatCount(content?.activeVisitors, locale)} icon={<Users size={18} />} />
    </div>
    <div className="dash-grid">
      <ChartPanel title={t('dashboard.growth')} hint={t('dashboard.growthHint')}>
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
            <Area type="monotone" dataKey="created" name={t('dashboard.created')} stroke="#b5503a" fill="url(#createdFill)" strokeWidth={2} />
            <Area type="monotone" dataKey="published" name={t('dashboard.published')} stroke="#2f785c" fill="url(#publishedFill)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartPanel>
      <ChartPanel title={t('dashboard.viewsDays', { days: ANALYTICS_DAYS })} hint={analytics.data ? t('dashboard.uniqueVisitors', { count: formatCount(analytics.data.uniqueVisitors, locale) }) : undefined}>
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
            <Area type="monotone" dataKey="views" name={t('dashboard.views')} stroke="#b5503a" fill="url(#viewsFill)" strokeWidth={2} />
            <Area type="monotone" dataKey="uniqueVisitors" name={t('dashboard.uniqueVisitorsLabel')} stroke="#77807b" fillOpacity={0} strokeWidth={1.5} strokeDasharray="4 3" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
    <div className="dash-grid">
      <section className="panel" aria-label={t('dashboard.topContent')}>
        <div className="panel-heading"><div><p className="kicker">{t('dashboard.ranking')}</p><h2>{t('dashboard.topContent')}</h2></div><Badge color="orange" variant="light">{t('dashboard.topFive')}</Badge></div>
        {(overview.data?.topContent.length ?? 0) === 0 && <p className="muted">{t('dashboard.topEmpty')}</p>}
        <ul className="dash-list">
          {overview.data?.topContent.map((item, index) => <li key={item.id}>
            <span className="dash-main">
              <strong>{index + 1}. {item.title || item.slug || item.id}</strong>
              <span className="dash-meta">{t('dashboard.topMeta', { kind: item.kind === 'ARTICLE' ? t('common.writing') : t('common.thought'), views: formatCount(item.viewCount, locale), likes: formatCount(item.likeCount, locale), comments: formatCount(item.commentCount, locale) })}</span>
            </span>
            <span className="dash-value"><Eye size={13} /> {formatCount(item.viewCount, locale)}</span>
          </li>)}
        </ul>
      </section>
      <ChartPanel title={t('dashboard.tagDistribution')} hint={t('dashboard.tagHint')}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={tagData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="#deddd4" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#77807b' }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11, fill: '#252a28' }} tickLine={false} axisLine={false} />
            <Tooltip />
            <Bar dataKey="count" name={t('dashboard.content')} fill="#b5503a" barSize={12} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
    <div className="dash-grid">
      <section className="panel panel-stack" aria-label={t('dashboard.recentComments')}>
        <div className="panel-heading"><div><p className="kicker">{t('dashboard.community')}</p><h2>{t('dashboard.recentComments')}</h2></div><Badge color="teal" variant="light">{formatCount(commentTotal, locale)}</Badge></div>
        <input className="panel-search" type="search" value={commentSearch} placeholder={t('comments.search')} aria-label={t('comments.search')} onChange={(event) => { setCommentSearch(event.target.value); setCommentPage(1) }} />
        {commentRows.length === 0 && <p className="muted">{commentSearch ? t('dashboard.noMatchingComments') : t('dashboard.noComments')}</p>}
        <ul className="dash-list">
          {commentRows.map((comment) => <li key={comment.id}>
            <span className="dash-main">
              <strong>{comment.authorName || t('common.anonymous')}</strong>
              <span className="dash-meta">{comment.body.length > 120 ? `${comment.body.slice(0, 120)}…` : comment.body}</span>
            </span>
            <span className="dash-value">{formatRelativeTime(comment.createdAt, locale, t)}</span>
          </li>)}
        </ul>
        <PanelPager page={safeCommentPage} pageCount={commentPageCount} onPage={setCommentPage} />
      </section>
      <section className="panel panel-stack" aria-label={t('dashboard.recentActivity')}>
        <div className="panel-heading"><div><p className="kicker">{t('dashboard.audit')}</p><h2>{t('dashboard.recentActivity')}</h2></div><Badge color="gray" variant="light">{auditPagination ? t('common.count.events', { count: auditPagination.totalItems }) : '…'}</Badge></div>
        <input className="panel-search" type="search" value={auditSearch} placeholder={t('dashboard.searchActivity')} aria-label={t('dashboard.searchActivity')} onChange={(event) => { setAuditSearch(event.target.value); setAuditPage(1) }} />
        {(audit.data?.events.length ?? 0) === 0 && <p className="muted">{debouncedAuditSearch ? t('dashboard.noMatchingActivity') : t('dashboard.activityEmpty')}</p>}
        <ul className="dash-list">
          {audit.data?.events.map((event) => <li key={event.id}>
            <span className="dash-main">
              <strong>{describeEvent(event.eventName, t)}</strong>
              <span className="dash-meta">{event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ''}{event.actor !== 'anonymous' ? ` · ${event.actor}` : ''}</span>
            </span>
            <span className="dash-value">{formatRelativeTime(event.createdAt, locale, t)}</span>
          </li>)}
        </ul>
        <PanelPager page={auditPagination?.page ?? 1} pageCount={auditPagination?.totalPages ?? 1} onPage={setAuditPage} />
      </section>
    </div>
    <SystemPanel status={system.data} onRefresh={refreshSystem} refreshing={system.isFetching} />
  </section>
}

function PanelPager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  const { t } = useTranslation()
  return <div className="panel-pager">
    <button className="mini-button" type="button" disabled={page <= 1} aria-label={t('common.previousPage')} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /></button>
    <span className="dash-meta">{t('common.pageOf', { page, total: pageCount })}</span>
    <button className="mini-button" type="button" disabled={page >= pageCount} aria-label={t('common.nextPage')} onClick={() => onPage(page + 1)}><ChevronRight size={15} /></button>
  </div>
}

function describeEvent(eventName: string, t: TFunction) {
  const labels: Record<string, string> = {
    'admin.session.created': t('dashboard.events.signedIn'),
    'content.created': t('dashboard.events.contentCreated'),
    'content.updated': t('dashboard.events.contentUpdated'),
    'content.published': t('dashboard.events.contentPublished'),
    'content.unpublished': t('dashboard.events.contentUnpublished'),
    'content.deleted': t('dashboard.events.contentDeleted'),
    'content.viewed': t('dashboard.events.contentViewed'),
    'content.like.added': t('dashboard.events.likeAdded'),
    'content.like.removed': t('dashboard.events.likeRemoved'),
    'comment.created': t('dashboard.events.commentPosted'),
    'comment.deleted': t('dashboard.events.commentRemoved'),
    'comment.restored': t('dashboard.events.commentRestored'),
    'profile.updated': t('dashboard.events.profileUpdated'),
    'site.updated': t('dashboard.events.siteUpdated'),
    'thoughts.config.updated': t('dashboard.events.thoughtsUpdated'),
  }
  return labels[eventName] ?? eventName
}

function ChartPanel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  return <section className="panel">
    <div className="panel-heading">
      <div><p className="kicker">{t('dashboard.trend')}</p><h2>{title}</h2></div>
      {hint && <span className="count-badge">{hint}</span>}
    </div>
    <div className="chart-wrap">{children}</div>
  </section>
}

function SystemPanel({ status, onRefresh, refreshing }: { status: SystemStatus | undefined; onRefresh: () => void; refreshing: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  return <section className="panel" aria-label={t('dashboard.coreHealth')}>
    <div className="panel-heading">
      <div><p className="kicker">{t('dashboard.system')}</p><h2>{t('dashboard.coreHealth')}</h2></div>
      <div className="panel-heading-actions">
        {status && <Badge color="teal" variant="light" leftSection={<span className="status-dot published" />}>{t('dashboard.healthy')}</Badge>}
        {!status && <span className="muted">{t('dashboard.unavailable')}</span>}
        <button className="mini-button" type="button" aria-label={t('dashboard.refreshSystem')} onClick={onRefresh}><RefreshCw size={14} className={refreshing ? 'spin' : undefined} /></button>
      </div>
    </div>
    {status && <div className="system-donuts">
      <SystemDonut label={t('dashboard.cpu')} percent={status.resources.cpuPercent} />
      <SystemDonut label={t('dashboard.memory')} percent={status.resources.memUsedPercent} />
      <SystemDonut label={t('dashboard.disk')} percent={status.resources.diskUsedPercent} />
    </div>}
    <div className="system-grid">
      <SystemCell label={t('dashboard.version')} value={status?.version ?? '—'} />
      <SystemCell label={t('dashboard.uptime')} value={status ? formatUptime(status.uptimeSeconds, t) : '—'} />
      <SystemCell label={t('dashboard.host')} value={status ? [status.host.hostname, status.host.platform].filter(Boolean).join(' · ') : '—'} />
      <SystemCell label={t('dashboard.cpu')} value={status ? `${t('dashboard.cores', { count: status.resources.cpuCores })} · ${status.resources.cpuPercent.toFixed(1)}%` : '—'} />
      <SystemCell label={t('dashboard.memory')} value={status ? `${formatBytes(status.resources.memUsedBytes)} / ${formatBytes(status.resources.memTotalBytes)} · ${status.resources.memUsedPercent.toFixed(1)}%` : '—'} />
      <SystemCell label={t('dashboard.disk')} value={status ? `${formatBytes(status.resources.diskUsedBytes)} / ${formatBytes(status.resources.diskTotalBytes)} · ${status.resources.diskUsedPercent.toFixed(1)}%` : '—'} />
      <SystemCell label={t('dashboard.loadAverage')} value={status ? `${status.resources.loadAvg1.toFixed(2)} / ${status.resources.loadAvg5.toFixed(2)} / ${status.resources.loadAvg15.toFixed(2)}` : '—'} />
      <SystemCell label={t('dashboard.processRss')} value={status ? formatBytes(status.runtime.sysRssBytes) : '—'} />
      <SystemCell label={t('dashboard.heap')} value={status ? formatBytes(status.runtime.heapAllocBytes) : '—'} />
      <SystemCell label={t('dashboard.goroutines')} value={status ? String(status.runtime.numGoroutine) : '—'} />
      <SystemCell label={t('dashboard.database')} value={status ? formatBytes(status.database.sizeBytes) : '—'} />
      <SystemCell label={t('dashboard.contentCache')} value={status ? t('common.count.entries', { count: status.caches.contentEntries }) : '—'} />
      <SystemCell label={t('dashboard.auditEvents')} value={status ? t('common.count.events', { count: status.auditEventCount }) : '—'} />
      <SystemCell label={t('dashboard.startedAt')} value={status ? formatDateTime(status.startedAt, locale) : '—'} />
    </div>
  </section>
}

function SystemCell({ label, value }: { label: string; value: string }) {
  return <div className="system-cell"><strong>{value}</strong><span>{label}</span></div>
}

function SystemDonut({ label, percent }: { label: string; percent: number }) {
  const { t } = useTranslation()
  const clamped = Math.min(100, Math.max(0, percent))
  const data = [
    { name: t('dashboard.used'), value: clamped },
    { name: t('dashboard.free'), value: Math.max(0, 100 - clamped) },
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
