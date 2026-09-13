import { Button, Modal, Tabs } from '@mantine/core'
import { ArrowLeft, ArrowUpRight, Lock, LockOpen, Send, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminContent } from '@manifold/contracts'
import { activeLocale, formatDate } from '../../i18n/format'
import { ConfirmButton } from '../common/ConfirmButton'
import { SaveBar } from './SaveBar'
import type { TransitionAction } from './ContentListPanel'

export type EditorMode = 'create' | 'view' | 'edit'

type ContentEditorShellProps = {
  kindLabel: string
  hrefFor: (content: AdminContent) => string
  selected: AdminContent | null
  mode: EditorMode
  isDirty: boolean
  isPending: boolean
  savedFlash: boolean
  conflict: boolean
  formId: string
  onBack: () => void
  onDiscard: () => void
  onEnterEdit: () => void
  onConfirmLock: () => void
  onTransition: (action: TransitionAction) => void
  onDeleteConfirmed: () => void
  conflictReload: () => void
  metaTab: ReactNode
  contextTab: ReactNode
  renderTab: ReactNode
  commentsTab?: ReactNode
  pinSection?: ReactNode
  activeTab: string
  onTabChange: (tab: string) => void
  onSubmitRequest: () => void
}

export function ContentEditorShell({ kindLabel, hrefFor, selected, mode, isDirty, isPending, savedFlash, conflict, formId, onBack, onDiscard, onEnterEdit, onConfirmLock, onTransition, onDeleteConfirmed, conflictReload, metaTab, contextTab, renderTab, commentsTab, pinSection, activeTab, onTabChange, onSubmitRequest }: ContentEditorShellProps) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const [pendingLock, setPendingLock] = useState(false)
  const dirtyRef = useRef(false)
  useEffect(() => { dirtyRef.current = isDirty }, [isDirty])
  const editing = mode === 'edit' || mode === 'create'
  const kind = kindLabel.toLowerCase()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) {
        event.preventDefault()
        if (dirtyRef.current) onSubmitRequest()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onSubmitRequest])
  const metaPanel = <fieldset className="editor-locked" disabled={!editing}>{metaTab}</fieldset>
  const contextPanel = editing ? contextTab : <fieldset className="editor-locked" disabled>{contextTab}</fieldset>
  const statusLabel = selected ? t(`common.status.${selected.status.toLowerCase()}`) : ''

  return <section className="workspace editor-page">
    <div className="editor-topbar">
      <button type="button" className="editor-back" onClick={onBack}><ArrowLeft size={15} /> {t('editor.back', { kind })}</button>
      {selected && <div className="editor-status-actions">
        <span className="status-label">{statusLabel}</span>
        {selected.status === 'DRAFT' && <ConfirmButton label={t('editor.publish')} confirmLabel={t('editor.publishNow')} confirmBody={t('editor.publishConfirm', { kind })} leftSection={<Send size={14} />} onConfirm={() => onTransition('publish')} />}
        {selected.status === 'PUBLISHED' && <ConfirmButton label={t('editor.unpublish')} confirmLabel={t('editor.unpublish')} confirmBody={t('editor.unpublishConfirm', { kind })} danger leftSection={<X size={14} />} onConfirm={() => onTransition('unpublish')} />}
        <a className="row-link" href={hrefFor(selected)} target="_blank" rel="noreferrer" title={t('editor.viewSite')} aria-label={t('editor.viewSite')}><ArrowUpRight size={15} /></a>
        <ConfirmButton label={t('editor.deleteLabel', { kind })} confirmLabel={t('common.delete')} confirmBody={t('editor.deleteConfirm', { kind })} danger icon={<Trash2 size={15} />} onConfirm={onDeleteConfirmed} />
      </div>}
    </div>
    <div className="page-heading editor-heading"><div>
      <p className="kicker">{mode === 'create' ? t('editor.newKicker', { kind: kindLabel }) : kindLabel}</p>
      <h1>{selected?.title || t('editor.newTitle', { kind })}</h1>
      {selected && <p className="subheading">{t(isDirty ? 'editor.updatedDirty' : 'editor.updated', { date: formatDate(selected.updatedAt, locale), version: selected.version })}</p>}
    </div>
      {mode !== 'create' && <Button variant={editing ? 'light' : 'default'} leftSection={editing ? <Lock size={15} /> : <LockOpen size={15} />} onClick={() => { if (editing) { if (isDirty) setPendingLock(true); else onConfirmLock() } else onEnterEdit() }}>{editing ? t('editor.lock') : t('editor.edit')}</Button>}
    </div>
    <Tabs value={activeTab} onChange={(value) => onTabChange(value ?? 'meta')} keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="meta">{t('editor.tabs.meta')}</Tabs.Tab><Tabs.Tab value="context">{t('editor.tabs.context')}</Tabs.Tab><Tabs.Tab value="render">{t('editor.tabs.render')}</Tabs.Tab>{commentsTab && <Tabs.Tab value="comments">{t('editor.tabs.comments')}</Tabs.Tab>}
      </Tabs.List>
      <Tabs.Panel value="meta" pt="md">{pinSection}{metaPanel}</Tabs.Panel><Tabs.Panel value="context" pt="md">{contextPanel}</Tabs.Panel><Tabs.Panel value="render" pt="md"><div className="editor-render">{renderTab}</div></Tabs.Panel>{commentsTab && <Tabs.Panel value="comments" pt="md">{commentsTab}</Tabs.Panel>}
    </Tabs>
    {editing && activeTab !== 'comments' && <SaveBar formId={formId} isDirty={isDirty} isPending={isPending} saved={savedFlash} label={t(mode === 'edit' ? 'editor.saveChanges' : 'editor.saveDraft')} onDiscard={onDiscard} onSave={onSubmitRequest} />}
    <Modal opened={pendingLock} onClose={() => setPendingLock(false)} title={t('common.unsavedChanges')} centered><p>{t('editor.lockConfirm', { kind })}</p><div className="modal-actions"><Button variant="default" onClick={() => setPendingLock(false)}>{t('common.keepEditing')}</Button><Button color="red" onClick={() => { setPendingLock(false); onConfirmLock() }}>{t('editor.discardLock')}</Button></div></Modal>
    {conflict && <Modal opened onClose={conflictReload} title={t('editor.savedElsewhere')} centered><p>{t('editor.conflict', { kind })}</p><div className="modal-actions"><Button onClick={conflictReload}>{t('common.reload')}</Button></div></Modal>}
  </section>
}
