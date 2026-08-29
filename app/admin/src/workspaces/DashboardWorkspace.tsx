import { useQuery } from '@tanstack/react-query'
import { BarChart3, FileText, MessageCircle, RefreshCw, Settings2 } from 'lucide-react'
import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { createAdminClient } from '../api'

export function DashboardWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const query = useQuery({ queryKey: ['admin-stats'], queryFn: () => client.adminStats() })
  const stats = query.data?.content
  const chartData = stats ? [{ name: 'Writings', value: stats.articleCount }, { name: 'Thoughts', value: stats.thoughtCount }] : []
  return <section className="workspace"><div className="page-heading"><div><p className="kicker">Overview</p><h1>Dashboard</h1><p className="subheading">Published content and review status.</p></div><button className="button button-ghost" type="button" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</button></div>{query.isError && <p className="callout error">The dashboard could not reach Core.</p>}<div className="metric-grid"><Metric label="Published pieces" value={stats?.contentCount ?? '—'} icon={<FileText size={18} />} /><Metric label="Words in garden" value={stats?.wordCount ?? '—'} icon={<BarChart3 size={18} />} /><Metric label="Writings" value={stats?.articleCount ?? '—'} icon={<Settings2 size={18} />} /><Metric label="Thoughts" value={stats?.thoughtCount ?? '—'} icon={<MessageCircle size={18} />} /></div><div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><p className="kicker">Composition</p><h2>Published by type</h2></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#deded5" /><XAxis dataKey="name" axisLine={false} tickLine={false} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} /><Tooltip /><Bar dataKey="value" fill="#b54d37" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div></section><section className="panel quick-panel"><div className="panel-heading"><div><p className="kicker">Operator queue</p><h2>Next actions</h2></div></div><ul className="action-list"><li><MessageCircle size={17} /><span><strong>{stats?.thoughtCount ?? 0}</strong> thoughts growing in the garden</span></li><li><FileText size={17} /><span><strong>{stats?.contentCount ?? 0}</strong> published pieces visible to readers</span></li><li><Settings2 size={17} /><span>Current status is editable from the Now view</span></li></ul></section></div></section>
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) { return <article className="metric-card"><span className="metric-icon">{icon}</span><strong>{value}</strong><span>{label}</span></article> }

export default DashboardWorkspace
