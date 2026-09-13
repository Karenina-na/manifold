import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, PasswordInput } from '@mantine/core'
import { Check, LogOut, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { createAdminClient } from '../../lib/api'
import { activeLocale, formatDateTime } from '../../i18n/format'
import { ConfirmButton } from '../../components/common/ConfirmButton'

type SecurityForm = { currentPassword: string; newPassword: string; confirmPassword: string }

function shortSessionID(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 9)}…`
}

export function SecuritySection({ token, onLoggedOut }: { token: string; onLoggedOut: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const securitySchema = useMemo(() => z.object({
    currentPassword: z.string().min(1, t('validation.currentPasswordRequired')),
    newPassword: z.string().min(8, t('validation.newPasswordMin')),
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, { path: ['confirmPassword'], message: t('validation.passwordsMismatch') }), [t])
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const [savedFlash, setSavedFlash] = useState(false)
  const [revokedFlash, setRevokedFlash] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const form = useForm<SecurityForm>({ resolver: zodResolver(securitySchema), defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } })
  const sessions = useQuery({ queryKey: ['admin-sessions'], queryFn: () => client.adminSessions(), staleTime: 0 })
  const activeCount = sessions.data?.sessions.filter((session) => session.active).length ?? 0
  const changePassword = useMutation({
    mutationFn: (input: SecurityForm) => client.changePassword({ currentPassword: input.currentPassword, newPassword: input.newPassword }),
    onSuccess: () => {
      form.reset()
      setSavedFlash(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setSavedFlash(false), 2400)
      void queryClient.invalidateQueries({ queryKey: ['admin-sessions'] })
    },
  })
  const logoutAll = useMutation({ mutationFn: () => client.logoutAllSessions(), onSuccess: () => { setRevokedFlash(true); onLoggedOut() } })
  const revokeSession = useMutation({ mutationFn: (id: string) => client.logoutSessionById(id), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-sessions'] }) })
  return <section className="panel security-panel" id="site-security" aria-labelledby="site-security-title">
    <div className="panel-heading"><div><p className="kicker">{t('security.kicker')}</p><h2 id="site-security-title">{t('security.title')}</h2></div></div>
    <div className="security-subblock">
      <div className="security-subhead"><ShieldCheck size={15} strokeWidth={2.2} aria-hidden /><span>{t('security.change')}</span></div>
      {changePassword.isError && <Alert color="red" variant="light">{t('security.changeError')}</Alert>}
      <form id="security-password-form" noValidate onSubmit={form.handleSubmit((input) => changePassword.mutate(input))}>
        <PasswordInput label={t('security.currentPassword')} visibilityToggleButtonProps={{ 'aria-label': t('common.togglePasswordVisibility') }} {...form.register('currentPassword')} error={form.formState.errors.currentPassword?.message} />
        <div className="password-field">
          <PasswordInput label={t('security.newPassword')} placeholder={t('security.minPlaceholder')} visibilityToggleButtonProps={{ 'aria-label': t('common.togglePasswordVisibility') }} {...form.register('newPassword')} error={form.formState.errors.newPassword?.message} />
          <PasswordInput label={t('security.confirmPassword')} visibilityToggleButtonProps={{ 'aria-label': t('common.togglePasswordVisibility') }} {...form.register('confirmPassword')} error={form.formState.errors.confirmPassword?.message} />
        </div>
        <div className="password-actions"><Button type="submit" className="button button-primary" loading={changePassword.isPending} leftSection={savedFlash ? <Check size={16} /> : <ShieldCheck size={16} />}>{savedFlash ? t('security.updated') : t('security.change')}</Button></div>
      </form>
    </div>
    <hr className="panel-divider" />
    <div className="security-subblock">
      <div className="security-subhead"><LogOut size={15} strokeWidth={2.2} aria-hidden /><span>{t('security.sessions')}</span>{sessions.data && <em className="security-session-count">{t('common.count.active', { count: activeCount })}</em>}</div>
      {sessions.isError && <Alert color="red" variant="light">{t('security.sessionsError')}</Alert>}
      {revokeSession.isError && <Alert color="red" variant="light">{t('security.revokeError')}</Alert>}
      <ul className="security-sessions">
        {sessions.data?.sessions.map((session) => <li className={`security-session-row ${session.active ? '' : 'revoked'}`} key={session.id}>
          <span className="security-session-dot" aria-hidden />
          <span className="security-session-id" title={session.id}>{session.current ? t('security.thisDevice') : shortSessionID(session.id)}<small>{t('security.signedIn', { date: formatDateTime(session.createdAt, locale) })}</small></span>
          <span className="security-session-meta">
            {session.current && <span className="security-badge current">{t('security.current')}</span>}
            {session.active ? <span className="security-badge active">{t('security.active')}</span> : <span className="security-badge revoked">{t('security.revoked')}</span>}
            <small>{t('security.expires', { date: formatDateTime(session.expiresAt, locale) })}</small>
            {!session.current && session.active && <ConfirmButton label={t('security.signOutSession', { id: session.id })} confirmLabel={t('security.signOut')} confirmBody={t('security.signOutConfirm')} danger icon={<LogOut size={14} />} onConfirm={() => revokeSession.mutate(session.id)} />}
          </span>
        </li>)}
      </ul>
      {sessions.data && sessions.data.sessions.length === 0 && <p className="muted">{t('security.none')}</p>}
      <div className="form-stack-actions"><Button variant="default" type="button" onClick={() => logoutAll.mutate()} loading={logoutAll.isPending} leftSection={revokedFlash ? <Check size={16} /> : <LogOut size={16} />}>{revokedFlash ? t('security.revokedAll') : t('security.signOutEverywhere')}</Button></div>
    </div>
  </section>
}
