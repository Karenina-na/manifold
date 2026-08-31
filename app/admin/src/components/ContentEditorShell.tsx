import { Button, Modal, Tabs } from '@mantine/core'
import { ArrowLeft, ArrowUpRight, Lock, LockOpen, Send, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AdminContent } from '@manifold/contracts'
import { formatDate } from '@manifold/render'
import { ConfirmButton } from './ConfirmButton'
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
  const [pendingLock, setPendingLock] = useState(false)
  const dirtyRef = useRef(false)
  useEffect(() => { dirtyRef.current = isDirty }, [isDirty])
  const editing = mode === 'edit' || mode === 'create'
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
  const contextPanel = editing
    ? contextTab
    : <fieldset className="editor-locked" disabled>{contextTab}</fieldset>

  return <section className="workspace editor-page">
    <div className="editor-topbar">
      <button type="button" className="editor-back" onClick={onBack}><ArrowLeft size={15} /> Back to {kindLabel.toLowerCase()}s</button>
      {selected && <div className="editor-status-actions">
        <span className="status-label">{selected.status}</span>
        {selected.status === 'DRAFT' && <ConfirmButton label="Publish" confirmLabel="Publish now" confirmBody={`Publish this ${kindLabel.toLowerCase()} to the public site?`} leftSection={<Send size={14} />} onConfirm={() => onTransition('publish')} />}
        {selected.status === 'PUBLISHED' && <ConfirmButton label="Unpublish" confirmLabel="Unpublish" confirmBody={`Take this ${kindLabel.toLowerCase()} off the public site? It returns to drafts.`} danger leftSection={<X size={14} />} onConfirm={() => onTransition('unpublish')} />}
        <a className="row-link" href={hrefFor(selected)} target="_blank" rel="noreferrer" title="View on the site" aria-label="View on the site"><ArrowUpRight size={15} /></a>
        <ConfirmButton label={`Delete ${kindLabel.toLowerCase()}`} confirmLabel="Delete" confirmBody={`Delete this ${kindLabel.toLowerCase()}? It leaves the public site immediately.`} danger icon={<Trash2 size={15} />} onConfirm={onDeleteConfirmed} />
      </div>}
    </div>
    <div className="page-heading editor-heading">
      <div>
        <p className="kicker">{kindLabel}{mode === 'create' ? ' · New' : ''}</p>
        <h1>{selected?.title || `A new ${kindLabel.toLowerCase()}`}</h1>
        {selected && <p className="subheading">Updated {formatDate(selected.updatedAt)} · v{selected.version}{isDirty ? ' · unsaved changes' : ''}</p>}
      </div>
      {mode !== 'create' && <Button variant={editing ? 'light' : 'default'} leftSection={editing ? <Lock size={15} /> : <LockOpen size={15} />} onClick={() => { if (editing) { if (isDirty) setPendingLock(true); else onConfirmLock() } else onEnterEdit() }}>{editing ? 'Lock' : 'Edit'}</Button>}
    </div>
    <Tabs value={activeTab} onChange={(value) => onTabChange(value ?? 'meta')} keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="meta">Meta</Tabs.Tab>
        <Tabs.Tab value="context">Context</Tabs.Tab>
        <Tabs.Tab value="render">Render</Tabs.Tab>
        {commentsTab && <Tabs.Tab value="comments">Comments</Tabs.Tab>}
      </Tabs.List>
      <Tabs.Panel value="meta" pt="md">{pinSection}{metaPanel}</Tabs.Panel>
      <Tabs.Panel value="context" pt="md">{contextPanel}</Tabs.Panel>
      <Tabs.Panel value="render" pt="md">
        <div className="editor-render">{renderTab}</div>
      </Tabs.Panel>
      {commentsTab && <Tabs.Panel value="comments" pt="md">{commentsTab}</Tabs.Panel>}
    </Tabs>
    {editing && activeTab !== 'comments' && <SaveBar formId={formId} isDirty={isDirty} isPending={isPending} saved={savedFlash} label={mode === 'edit' ? 'Save changes' : 'Save draft'} onDiscard={onDiscard} onSave={onSubmitRequest} />}
    <Modal opened={pendingLock} onClose={() => setPendingLock(false)} title="Unsaved changes" centered>
      <p>Discard unsaved changes and lock this {kindLabel.toLowerCase()}?</p>
      <div className="modal-actions">
        <Button variant="default" onClick={() => setPendingLock(false)}>Keep editing</Button>
        <Button color="red" onClick={() => { setPendingLock(false); onConfirmLock() }}>Discard and lock</Button>
      </div>
    </Modal>
    {conflict && <Modal opened onClose={conflictReload} title="Saved elsewhere" centered>
      <p>This {kindLabel.toLowerCase()} changed in another session. Reload it to continue editing.</p>
      <div className="modal-actions"><Button onClick={conflictReload}>Reload</Button></div>
    </Modal>}
  </section>
}
