import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, Modal, PasswordInput, TextInput } from '@mantine/core'
import { LayoutDashboard, FileText, Image as ImageIcon, LogOut, Menu, MessageCircle, Feather, Send, SlidersHorizontal, Sparkles, User } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { clearSession, createAdminClient, readStoredSession, storeSession, unauthorizedEvent, type Session } from '../lib/api'
import { LanguageSwitcher } from '../components/common/LanguageSwitcher'
import { navigate, requestNavigate, setNavConfirm, useHashRoute } from '../lib/useHashRoute'
import './App.css'

type View = 'dashboard' | 'profile' | 'writings' | 'thoughts' | 'media' | 'comments' | 'settings'

const DashboardWorkspace = lazy(() => import('../workspaces/DashboardWorkspace'))
const ProfileWorkspace = lazy(() => import('../workspaces/ProfileWorkspace'))
const WritingsWorkspace = lazy(() => import('../workspaces/WritingsWorkspace'))
const ThoughtsWorkspace = lazy(() => import('../workspaces/ThoughtsWorkspace'))
const MediaWorkspace = lazy(() => import('../workspaces/MediaWorkspace'))
const CommentsWorkspace = lazy(() => import('../workspaces/CommentsWorkspace'))
const SettingsWorkspace = lazy(() => import('../features/settings/SettingsWorkspace').then(({ SettingsWorkspace }) => ({ default: SettingsWorkspace })))
const AgentDialog = lazy(() => import('../components/agent/AgentDialog').then(({ AgentDialog }) => ({ default: AgentDialog })))

type LoginForm = { username: string; password: string }

function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const { t } = useTranslation()
  const loginSchema = useMemo(() => z.object({ username: z.string().trim().min(1, t('validation.requiredUsername')), password: z.string().min(8, t('validation.passwordMin')) }), [t])
  const form = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: { username: 'admin', password: '' } })
  const mutation = useMutation({ mutationFn: (input: LoginForm) => createAdminClient().login(input), onSuccess: (result, input) => onLogin(storeSession({ ...result, username: input.username })) })
  return <main className="login-shell">
    <section className="login-panel">
      <div className="login-toolbar"><div className="brand-mark">manifold<span>.</span></div><LanguageSwitcher /></div>
      <p className="kicker">{t('login.kicker')}</p>
      <h1>{t('login.title')}</h1>
      <p className="login-copy">{t('login.copy')}</p>
      <form onSubmit={form.handleSubmit((input) => mutation.mutate(input))} className="form-stack">
        <TextInput label={t('login.username')} {...form.register('username')} autoComplete="username" error={form.formState.errors.username?.message} />
        <PasswordInput label={t('login.password')} visibilityToggleButtonProps={{ 'aria-label': t('common.togglePasswordVisibility') }} {...form.register('password')} autoComplete="current-password" error={form.formState.errors.password?.message} />
        {mutation.isError && <Alert color="red" variant="light">{t('login.error')}</Alert>}
        <Button className="button button-primary" type="submit" loading={mutation.isPending} leftSection={<Send size={16} />}>{mutation.isPending ? t('login.signingIn') : t('login.submit')}</Button>
      </form>
    </section>
  </main>
}

function Sidebar({ view, onNavigate, onLogout, collapsed, setCollapsed }: { view: View; onNavigate: (view: View) => void; onLogout: () => void; collapsed: boolean; setCollapsed: (value: boolean) => void }) {
  const { t } = useTranslation()
  const items: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [{ id: 'dashboard', label: t('common.dashboard'), icon: LayoutDashboard }, { id: 'profile', label: t('common.profile'), icon: User }, { id: 'writings', label: t('common.writings'), icon: FileText }, { id: 'thoughts', label: t('common.thoughts'), icon: Feather }, { id: 'media', label: t('common.media'), icon: ImageIcon }, { id: 'comments', label: t('common.comments'), icon: MessageCircle }, { id: 'settings', label: t('common.settings'), icon: SlidersHorizontal }]
  return <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <div className="sidebar-top">
      <div className="brand-mark">m<span>.</span></div>
      <button className="icon-button" type="button" aria-label={t('nav.toggle')} onClick={() => setCollapsed(!collapsed)}><Menu size={18} /></button>
    </div>
    <nav className="side-nav">
      {items.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'side-link active' : 'side-link'} type="button" aria-label={label} title={collapsed ? label : undefined} onClick={() => onNavigate(id)}><Icon size={18} /><span>{label}</span></button>)}
    </nav>
    <button className="side-link side-logout" type="button" aria-label={t('nav.signOut')} title={collapsed ? t('nav.signOut') : undefined} onClick={onLogout}><LogOut size={18} /><span>{t('nav.signOut')}</span></button>
  </aside>
}

function WorkspaceFallback() {
  const { t } = useTranslation()
  return <section className="workspace"><p className="muted">{t('nav.loadingWorkspace')}</p></section>
}

function App() {
  const { t } = useTranslation()
  const [session, setSession] = useState<Session | null>(() => { const value = readStoredSession(); return value && value.expiresAt > Date.now() ? value : null })
  const route = useHashRoute()
  const [collapsed, setCollapsed] = useState(false)
  const [pendingNav, setPendingNav] = useState<string | null>(null)
  const [agentOpened, setAgentOpened] = useState(false)
  const view = (route.segments[0] ?? 'dashboard') as View
  useEffect(() => {
    setNavConfirm((to) => setPendingNav(to))
    return () => setNavConfirm(null)
  }, [])
  useEffect(() => {
    const logout = () => { clearSession(); setSession(null); setAgentOpened(false) }
    window.addEventListener(unauthorizedEvent, logout)
    return () => window.removeEventListener(unauthorizedEvent, logout)
  }, [])
  const requestView = (next: View) => {
    if (next === view && route.segments.length === 1) return
    requestNavigate(`#/${next}`)
  }
  if (!session) return <LoginScreen onLogin={setSession} />
  const logout = () => {
    const token = session.accessToken
    setAgentOpened(false)
    clearSession()
    setSession(null)
    if (token) void createAdminClient(token).logoutSession().catch(() => {})
  }
  const subSegments = route.segments.slice(1)
  return <div className="admin-shell">
    <Sidebar view={view} onNavigate={requestView} onLogout={logout} collapsed={collapsed} setCollapsed={setCollapsed} />
    <main className="admin-main">
      <header className="topbar">
        <span className="mobile-brand">manifold.</span>
        <button className="agent-trigger" type="button" onClick={() => setAgentOpened(true)} aria-label={t('agent.open')}><Sparkles size={15} /><span>{t('agent.title')}</span></button>
        <LanguageSwitcher />
        <span className="operator"><span className="operator-dot" /> {session.username}</span>
      </header>
      <Suspense fallback={<WorkspaceFallback />}>
        {view === 'dashboard' && <DashboardWorkspace token={session.accessToken} />}
        {view === 'profile' && <ProfileWorkspace token={session.accessToken} />}
        {view === 'writings' && <WritingsWorkspace token={session.accessToken} segments={subSegments} query={route.query} />}
        {view === 'thoughts' && <ThoughtsWorkspace token={session.accessToken} segments={subSegments} query={route.query} />}
        {view === 'media' && <MediaWorkspace token={session.accessToken} segments={subSegments} />}
        {view === 'comments' && <CommentsWorkspace token={session.accessToken} />}
        {view === 'settings' && <SettingsWorkspace token={session.accessToken} onLoggedOut={logout} />}
      </Suspense>
      {agentOpened && <Suspense fallback={null}><AgentDialog token={session.accessToken} opened onClose={() => setAgentOpened(false)} /></Suspense>}
    </main>
    {pendingNav !== null && <Modal opened onClose={() => setPendingNav(null)} title={t('app.unsavedTitle')} closeButtonProps={{ 'aria-label': t('common.closeDialog') }} centered>
      <p>{t('app.unsavedLeave')}</p>
      <div className="modal-actions">
        <Button variant="default" onClick={() => setPendingNav(null)}>{t('common.keepEditing')}</Button>
        <Button color="red" onClick={() => { const target = pendingNav; setPendingNav(null); navigate(target) }}>{t('app.discardLeave')}</Button>
      </div>
    </Modal>}
  </div>
}

export default App
