import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, PasswordInput, TextInput } from '@mantine/core'
import { LayoutDashboard, FileText, LogOut, Menu, MessageCircle, Send, Settings2, SlidersHorizontal } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { clearSession, createAdminClient, readStoredSession, storeSession } from './api'
import './App.css'

type View = 'dashboard' | 'content' | 'comments' | 'now' | 'settings'
type Session = { accessToken: string; username: string; expiresAt: number }

const DashboardWorkspace = lazy(() => import('./workspaces/DashboardWorkspace'))
const ContentWorkspace = lazy(() => import('./workspaces/ContentWorkspace'))
const CommentsWorkspace = lazy(() => import('./workspaces/CommentsWorkspace'))
const NowWorkspace = lazy(() => import('./workspaces/NowWorkspace'))
const SettingsWorkspace = lazy(() => import('./SettingsWorkspace').then(({ SettingsWorkspace }) => ({ default: SettingsWorkspace })))

const loginSchema = z.object({ username: z.string().trim().min(1, 'Username is required.'), password: z.string().min(8, 'Password must be at least 8 characters.') })
type LoginForm = z.infer<typeof loginSchema>

function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const form = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: { username: 'admin', password: '' } })
  const mutation = useMutation({ mutationFn: (input: LoginForm) => createAdminClient().login(input), onSuccess: (result, input) => onLogin(storeSession({ ...result, username: input.username })) })
  return <main className="login-shell"><section className="login-panel"><div className="brand-mark">manifold<span>.</span></div><p className="kicker">Private workspace</p><h1>Make the garden legible.</h1><p className="login-copy">Manage the stream, review conversations, and keep the present moment current.</p><form onSubmit={form.handleSubmit((input) => mutation.mutate(input))} className="form-stack"><TextInput label="Username" {...form.register('username')} autoComplete="username" error={form.formState.errors.username?.message} /><PasswordInput label="Password" {...form.register('password')} autoComplete="current-password" error={form.formState.errors.password?.message} />{mutation.isError && <Alert color="red" variant="light">Could not sign in. Check the credentials and Core status.</Alert>}<Button className="button button-primary" type="submit" loading={mutation.isPending} leftSection={<Send size={16} />}>{mutation.isPending ? 'Signing in...' : 'Enter workspace'}</Button></form></section></main>
}

function Sidebar({ view, setView, onLogout, collapsed, setCollapsed }: { view: View; setView: (view: View) => void; onLogout: () => void; collapsed: boolean; setCollapsed: (value: boolean) => void }) {
  const items: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { id: 'content', label: 'Content', icon: FileText }, { id: 'comments', label: 'Comments', icon: MessageCircle }, { id: 'now', label: 'Now', icon: Settings2 }, { id: 'settings', label: 'Settings', icon: SlidersHorizontal }]
  return <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}><div className="sidebar-top"><div className="brand-mark">m<span>.</span></div><button className="icon-button" type="button" aria-label="Toggle sidebar" onClick={() => setCollapsed(!collapsed)}><Menu size={18} /></button></div><nav className="side-nav">{items.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'side-link active' : 'side-link'} type="button" onClick={() => setView(id)}><Icon size={18} /><span>{label}</span></button>)}</nav><button className="side-link side-logout" type="button" onClick={onLogout}><LogOut size={18} /><span>Sign out</span></button></aside>
}

function WorkspaceFallback() {
  return <section className="workspace"><p className="muted">Loading workspace...</p></section>
}

function App() {
  const [session, setSession] = useState<Session | null>(() => { const value = readStoredSession(); return value && value.expiresAt > Date.now() ? value : null })
  const [view, setView] = useState<View>('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  if (!session) return <LoginScreen onLogin={setSession} />
  const logout = () => { clearSession(); setSession(null) }
  return <div className="admin-shell"><Sidebar view={view} setView={setView} onLogout={logout} collapsed={collapsed} setCollapsed={setCollapsed} /><main className="admin-main"><header className="topbar"><span className="mobile-brand">manifold.</span><span className="operator"><span className="operator-dot" /> {session.username}</span></header><Suspense fallback={<WorkspaceFallback />}>{view === 'dashboard' && <DashboardWorkspace token={session.accessToken} />}{view === 'content' && <ContentWorkspace token={session.accessToken} />}{view === 'comments' && <CommentsWorkspace token={session.accessToken} />}{view === 'now' && <NowWorkspace token={session.accessToken} />}{view === 'settings' && <SettingsWorkspace token={session.accessToken} />}</Suspense></main></div>
}

export default App
