import type { AgentMessage, AgentStreamEvent } from '@manifold/contracts'
import { MarkdownContent } from '@manifold/render'
import { ActionIcon, Button, Modal, Textarea } from '@mantine/core'
import { Brain, Check, CircleAlert, Copy, Eraser, RotateCcw, Send, Sparkles, Wrench } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { createAdminClient } from '../../lib/api'
import { completeAgentCommands, parseAgentCommand, type AgentCommandID } from './agent-commands'
import { createCompactionNotice, failCompactionNotice, finishCompactionNotice, restoreCompactionNotice, type AgentNotice } from './agent-notice'
import { applyAgentEvent, formatAgentPayload, groupAgentMessages, type AgentProcessItem, type AgentTurn } from './agent-transcript'

const agentDialogTitle = 'Talking'

function ToolPayload({ value }: { value: unknown }) {
  return <pre className="agent-tool-payload">{formatAgentPayload(value)}</pre>
}

function ProcessStep({ item }: { item: AgentProcessItem }) {
  const { t } = useTranslation()
  if (item.kind === 'reasoning') return <div className={`agent-step ${item.status}`}>
    <span className="agent-step-index">{item.status === 'running' ? <span className="agent-step-pulse" /> : <Check size={12} aria-hidden="true" />}</span>
    <span className="agent-step-copy"><strong>{t('agent.thinking')}</strong><small>{item.status === 'running' ? t('agent.stepInProgress') : t('agent.stepComplete')}</small>{item.message && <span className="agent-reasoning-content">{item.message}</span>}</span>
  </div>
  if (item.kind === 'error') return <div className="agent-step error"><span className="agent-step-index"><CircleAlert size={12} aria-hidden="true" /></span><span className="agent-step-copy"><strong>{t('agent.stepError')}</strong><small>{item.message}</small></span></div>
  return <details className={`agent-tool-card ${item.status}`} open={item.status === 'running'}>
    <summary><span className="agent-tool-icon"><Wrench size={13} aria-hidden="true" /></span><span className="agent-tool-name">{item.name}</span><small>{item.status === 'running' ? t('agent.runningTool') : item.status === 'error' ? t('agent.toolFailed') : t('agent.toolComplete')}</small></summary>
    <div className="agent-tool-detail"><div><strong>{t('agent.input')}</strong><ToolPayload value={item.input} /></div>{item.output !== undefined && <div><strong>{t('agent.output')}</strong><ToolPayload value={item.output} /></div>}</div>
  </details>
}

function RunTrace({ turn }: { turn: AgentTurn }) {
  const { t } = useTranslation()
  if (!turn.process.length && !turn.usage) return null
  const toolCount = turn.process.filter((item) => item.kind === 'tool').length
  const failed = turn.status === 'error' || turn.finishReason === 'error'
  const statusLabel = turn.finishReason === 'max_tokens' ? t('agent.statusTruncated') : failed ? t('agent.statusError') : turn.status === 'running' ? t('agent.statusRunning') : t('agent.statusComplete')
  const hasReasoningSummary = turn.process.some((item) => item.kind === 'reasoning' && Boolean(item.message))
  return <details className={`agent-trace ${turn.status} ${turn.finishReason === 'max_tokens' ? 'truncated' : ''}`} open={turn.status === 'running' || hasReasoningSummary}>
    <summary><span className="agent-trace-leading"><Brain size={13} aria-hidden="true" /><span>{turn.status === 'complete' && !failed ? t('agent.thoughtDone') : t('agent.trace')}</span></span><span className="agent-trace-meta">{toolCount > 0 ? `${t('agent.toolCount', { count: toolCount })} · ${statusLabel}` : statusLabel}</span></summary>
    <div className="agent-trace-body">
      {turn.process.map((item) => <ProcessStep key={item.id} item={item} />)}
      {turn.usage && <div className="agent-trace-usage"><span>{t('agent.usage', { count: turn.usage.totalTokens })}</span><span>{t('agent.usageBreakdown', { input: turn.usage.inputTokens, output: turn.usage.outputTokens })}</span></div>}
    </div>
  </details>
}

function AgentNoticeView({ notice }: { notice: AgentNotice }) {
  const { t } = useTranslation()
  const running = notice.status === 'running'
  const failed = notice.status === 'error'
  const title = running ? t('agentNotice.compactRunning') : failed ? t('agent.compactError') : notice.compacted ? t('agentNotice.compactComplete') : t('agentNotice.compactNoop')
  const state = notice.compaction
  const detail = running ? t('agentNotice.compactProgress') : failed ? t('agentNotice.compactTryAgain') : notice.compacted ? t('agentNotice.compactCompleteDetail', { count: state?.compactedMessages ?? 0, recentTurns: state?.recentTurns ?? 0 }) : t('agentNotice.compactNoopDetail', { recentTurns: state?.recentTurns ?? 0 })
  return <article className={`agent-turn agent-compaction-turn ${notice.status}`}>
    <div className={`agent-compaction-card ${notice.status}`} role={failed ? 'alert' : 'status'} aria-live="polite" aria-busy={running}>
      <details open={running}>
        <summary><span className="agent-compaction-leading"><code className="agent-notice-command">{t('agentNotice.compactCommand')}</code><span className="agent-notice-icon">{running ? <Sparkles size={14} aria-hidden="true" /> : failed ? <CircleAlert size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}</span><strong>{title}</strong></span><small>{state?.summary ? t('agentNotice.summaryAvailable') : t('agentNotice.summaryPending')}</small></summary>
        <div className="agent-compaction-body"><p>{detail}</p>{state?.summary && <div className="agent-compaction-summary"><strong>{t('agentNotice.summaryLabel')}</strong><MarkdownContent content={state.summary} /></div>}</div>
      </details>
    </div>
  </article>
}

function MessageActions({ message, undoTarget, disabled = false, copied, undoing = false, onCopy, onUndo }: { message: AgentMessage; undoTarget?: AgentMessage; disabled?: boolean; copied: boolean; undoing?: boolean; onCopy: (message: AgentMessage) => void; onUndo?: (message: AgentMessage) => void }) {
  const { t } = useTranslation()
  return <div className="agent-message-actions">
    <button type="button" aria-label={t('agentActions.copyMessage')} title={t('agentActions.copyMessage')} onClick={() => onCopy(message)}><Copy size={12} aria-hidden="true" /><span>{copied ? t('common.copied') : t('agentActions.copy')}</span></button>
    {undoTarget && onUndo && <button type="button" aria-label={t('agentActions.undoMessage')} title={t('agentActions.undoMessage')} disabled={disabled} onClick={() => onUndo(undoTarget)}><RotateCcw size={12} aria-hidden="true" /><span>{undoing ? t('agentActions.undoing') : t('agentActions.undo')}</span></button>}
  </div>
}

function Turn({ turn, running, copiedMessageID, undoingMessageID, onCopy, onUndo }: { turn: AgentTurn; running: boolean; copiedMessageID: string; undoingMessageID: string; onCopy: (message: AgentMessage) => void; onUndo: (message: AgentMessage) => void }) {
  const { t } = useTranslation()
  const assistant = turn.assistant
  return <article className={`agent-turn ${turn.status}`}>
    {turn.user && <div className="agent-user-row"><div className="agent-avatar user-avatar">{t('agent.youShort')}</div><div className="agent-user-copy"><div className="agent-message-meta"><span>{t('agent.you')}</span><time dateTime={turn.user.createdAt}>{new Date(turn.user.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><div className="agent-user-bubble"><div>{turn.user.content}</div><MessageActions message={turn.user} undoTarget={turn.user} disabled={running || Boolean(undoingMessageID)} copied={copiedMessageID === turn.user.id} undoing={undoingMessageID === turn.user.id} onCopy={onCopy} onUndo={onUndo} /></div></div></div>}
    {assistant && <div className="agent-answer-row"><div className="agent-avatar assistant-avatar"><Sparkles size={15} aria-hidden="true" /></div><div className="agent-answer-copy"><div className="agent-message-meta"><span>{t('agent.assistant')}</span>{turn.status === 'running' && <span className="agent-live-dot">{t('agent.statusRunning')}</span>}</div><RunTrace turn={turn} />{assistant.content ? <div className="agent-answer-content"><MarkdownContent content={assistant.content} /><MessageActions message={assistant} copied={copiedMessageID === assistant.id} onCopy={onCopy} /></div> : turn.status === 'running' ? <div className="agent-answer-placeholder" aria-label={t('agent.statusRunning')}><span /><span /><span /></div> : turn.status === 'error' ? <div className="agent-answer-error">{t('agent.runError')}</div> : null}</div></div>}
    {!assistant && turn.status === 'error' && <div className="agent-answer-row"><div className="agent-avatar assistant-avatar"><Sparkles size={15} aria-hidden="true" /></div><div className="agent-answer-copy"><div className="agent-message-meta"><span>{t('agent.assistant')}</span></div><div className="agent-answer-error">{t('agent.incomplete')}</div></div></div>}
  </article>
}

export function AgentDialog({ token, opened, onClose }: { token: string; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const client = useRef(createAdminClient(token))
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [turns, setTurns] = useState<AgentTurn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [copiedMessageID, setCopiedMessageID] = useState('')
  const [undoingMessageID, setUndoingMessageID] = useState('')
  const [actionError, setActionError] = useState('')
  const [compaction, setCompaction] = useState<AgentNotice | null>(null)
  const [actionRunning, setActionRunning] = useState<AgentCommandID | ''>('')
  const [commandMenuFocused, setCommandMenuFocused] = useState(false)
  const [activeCommandIndex, setActiveCommandIndex] = useState(0)

  useEffect(() => { client.current = createAdminClient(token) }, [token])
  useEffect(() => () => { abortRef.current?.abort() }, [])
  useEffect(() => { if (!opened) abortRef.current?.abort() }, [opened])
  useEffect(() => {
    if (!opened) return
    let active = true
    client.current.agentMessages()
      .then(({ messages, compaction: savedCompaction }) => { if (active) { setTurns(groupAgentMessages(messages)); setCompaction(savedCompaction ? restoreCompactionNotice('compact-history', savedCompaction) : null) } })
      .catch(() => { if (active) setLoadError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [opened])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: running || Boolean(actionRunning) ? 'smooth' : 'auto' }) }, [turns, compaction, running, actionRunning])
  useEffect(() => { if (opened) requestAnimationFrame(() => inputRef.current?.focus()) }, [opened])

  const applyEvent = (event: AgentStreamEvent, turnID: string) => {
    setTurns((items) => items.map((turn) => turn.id === turnID ? applyAgentEvent(turn, event) : turn))
  }

  async function clear() {
    if (running || actionRunning || undoingMessageID) return
    setActionRunning('clear')
    try {
      await client.current.clearAgentMessages()
      setTurns([])
      setCompaction(null)
      setCopiedMessageID('')
      setActionError('')
    } catch {
      setActionError(t('agent.clearError'))
    } finally {
      setActionRunning('')
    }
  }

  async function compact() {
    if (running || actionRunning || undoingMessageID) return
    setActionRunning('compact')
    setActionError('')
    const noticeID = `compact-${Date.now()}`
    setCompaction(createCompactionNotice(noticeID))
    try {
      const result = await client.current.compactAgentMessages()
      setCompaction((notice) => notice?.id === noticeID ? finishCompactionNotice(notice, result) : notice)
    } catch {
      setActionError(t('agent.compactError'))
      setCompaction((notice) => notice?.id === noticeID ? failCompactionNotice(notice) : notice)
    } finally {
      setActionRunning('')
    }
  }

  function close() {
    abortRef.current?.abort()
    setLoading(true)
    setLoadError(false)
    onClose()
  }

  async function executeCommand(command: AgentCommandID) {
    setInput('')
    setCommandMenuFocused(false)
    if (command === 'quit') {
      close()
      return
    }
    if (command === 'clear') {
      await clear()
      return
    }
    await compact()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const message = input.trim()
    if (!message || running || actionRunning || undoingMessageID) return
    const command = parseAgentCommand(message)
    if (command) {
      await executeCommand(command)
      return
    }
    const stamp = new Date().toISOString()
    const turnID = `turn-${Date.now()}`
    const userID = `${turnID}-user`
    const assistantID = `${turnID}-assistant`
    setActionError('')
    setInput('')
    setTurns((items) => [...items, { id: turnID, user: { id: userID, role: 'user', content: message, createdAt: stamp }, assistant: { id: assistantID, role: 'assistant', content: '', createdAt: stamp }, process: [], status: 'running', persisted: false }])
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller
    let terminal = false
    try {
      for await (const streamEvent of client.current.runAgent({ message }, { signal: controller.signal })) {
        if (streamEvent.type === 'run.completed' || streamEvent.type === 'run.error') terminal = true
        applyEvent(streamEvent, turnID)
      }
      if (!terminal && !controller.signal.aborted) setTurns((items) => items.map((turn) => turn.id === turnID ? { ...turn, status: 'error', finishReason: 'error', process: [...turn.process, { id: `${turnID}-stream`, kind: 'error', message: t('agent.streamEnded') }] } : turn))
    } catch {
      if (!controller.signal.aborted) setTurns((items) => items.map((turn) => turn.id === turnID ? { ...turn, status: 'error', finishReason: 'error', process: [...turn.process, { id: `${turnID}-network`, kind: 'error', message: t('agent.runError') }] } : turn))
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunning(false)
    }
  }

  const copyMessage = async (message: AgentMessage) => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(message.content)
      setCopiedMessageID(message.id)
      setActionError('')
    } catch {
      setActionError(t('agentActions.copyError'))
    }
  }

  const undoMessage = async (message: AgentMessage) => {
    const turnIndex = turns.findIndex((turn) => turn.user?.id === message.id)
    if (turnIndex < 0 || running || actionRunning || undoingMessageID) return
    const turn = turns[turnIndex]
    setUndoingMessageID(message.id)
    setActionError('')
    try {
      if (turn && !turn.persisted) {
        setTurns((items) => items.slice(0, turnIndex))
        setInput(message.content)
      } else {
        const result = await client.current.undoAgentMessage(message.id)
        setTurns(groupAgentMessages(result.messages))
        setInput(result.draft)
      }
      setCopiedMessageID('')
      requestAnimationFrame(() => inputRef.current?.focus())
    } catch {
      setActionError(t('agentActions.undoError'))
    } finally {
      setUndoingMessageID('')
    }
  }

  const title = <div className="agent-modal-title"><span className="agent-title-orb"><Sparkles size={17} aria-hidden="true" /></span><span className="agent-title-copy"><span className="agent-title-kicker">{t('agent.title')}</span><strong id="agent-dialog-title">{agentDialogTitle}</strong><small>{t('agent.description')}</small></span></div>
  const hasConversation = turns.length > 0 || Boolean(compaction)
  const commandSuggestions = commandMenuFocused ? completeAgentCommands(input) : []
  const selectedCommand = commandSuggestions[activeCommandIndex] ?? commandSuggestions[0]
  const busy = running || Boolean(actionRunning) || Boolean(undoingMessageID)

  const selectCommand = (command: (typeof commandSuggestions)[number]) => {
    setInput(command.name)
    setActiveCommandIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return <Modal opened={opened} onClose={close} centered size="auto" title={title} transitionProps={{ transition: 'slide-down', duration: 460, timingFunction: 'cubic-bezier(.16,1,.3,1)' }} overlayProps={{ backgroundOpacity: 0.22, blur: 14 }} closeOnClickOutside classNames={{ root: 'agent-modal-root', content: 'agent-modal-content', header: 'agent-modal-header', title: 'agent-modal-heading', body: 'agent-modal-body', overlay: 'agent-modal-overlay' }} closeButtonProps={{ 'aria-label': t('agent.close') }}>
    <div className="agent-shell">
      <div className="agent-toolbar"><div className="agent-toolbar-copy"><span className="agent-session-mark" /><span>{t('agent.sessionLabel')}</span><small>{t('agent.sessionMemory')}</small></div><div className="agent-toolbar-actions"><span className={`agent-run-status ${busy ? 'running' : ''}`}>{busy ? t('agent.statusRunning') : t('agent.statusReady')}</span><ActionIcon variant="subtle" color="gray" aria-label={t('agent.clear')} title={t('agent.clear')} disabled={busy || Boolean(undoingMessageID) || !hasConversation} onClick={() => void clear()}><Eraser size={16} /></ActionIcon></div></div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{busy ? t('agent.statusRunning') : t('agent.statusReady')}</span>
      <div className="agent-transcript" role="log" aria-busy={busy}>
        {actionError && <div className="agent-action-error" role="alert"><CircleAlert size={14} aria-hidden="true" />{actionError}</div>}
        {loading && <div className="agent-loading"><span className="agent-loading-orb"><Sparkles size={18} aria-hidden="true" /></span><span>{t('common.loading')}</span></div>}
        {!loading && loadError && <div className="agent-empty agent-error-state"><CircleAlert size={22} aria-hidden="true" /><strong>{t('agent.loadError')}</strong><span>{t('agent.tryAgain')}</span></div>}
        {!loading && !loadError && !hasConversation && <div className="agent-empty"><span className="agent-empty-orb"><Sparkles size={22} aria-hidden="true" /></span><strong>{t('agent.emptyTitle')}</strong></div>}
        {compaction && <AgentNoticeView notice={compaction} />}
        {!loading && !loadError && turns.map((turn) => <Turn key={turn.id} turn={turn} running={busy} copiedMessageID={copiedMessageID} undoingMessageID={undoingMessageID} onCopy={(message) => void copyMessage(message)} onUndo={(message) => void undoMessage(message)} />)}
        <div ref={endRef} />
      </div>
      <form className="agent-composer" onSubmit={submit}>
        <div className="agent-composer-input">
          {commandSuggestions.length > 0 && <div id="agent-command-menu" className="agent-command-menu" role="listbox" aria-label={t('agentCommands.menu')}>
            {commandSuggestions.map((command) => <button key={command.id} id={`agent-command-${command.id}`} type="button" role="option" tabIndex={-1} aria-selected={selectedCommand?.id === command.id} className={selectedCommand?.id === command.id ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => selectCommand(command)}><code>{command.name}</code><span>{command.id === 'compact' ? t('agentCommands.compact') : command.id === 'quit' ? t('agentCommands.quit') : t('agentCommands.clear')}</span></button>)}
          </div>}
          <Textarea ref={inputRef} role="combobox" value={input} onChange={(event) => { setInput(event.currentTarget.value); setActiveCommandIndex(0) }} onFocus={() => setCommandMenuFocused(true)} onBlur={() => setCommandMenuFocused(false)} placeholder={t('agent.placeholder')} aria-label={t('agent.placeholder')} aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={commandSuggestions.length > 0} aria-controls={commandSuggestions.length > 0 ? 'agent-command-menu' : undefined} aria-activedescendant={selectedCommand ? `agent-command-${selectedCommand.id}` : undefined} autosize minRows={2} maxRows={5} maxLength={4000} disabled={busy} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (commandSuggestions.length > 0 && event.key === 'ArrowDown') { event.preventDefault(); setActiveCommandIndex((index) => (index + 1) % commandSuggestions.length); return }
            if (commandSuggestions.length > 0 && event.key === 'ArrowUp') { event.preventDefault(); setActiveCommandIndex((index) => (index - 1 + commandSuggestions.length) % commandSuggestions.length); return }
            if (commandSuggestions.length > 0 && event.key === 'Escape') { event.preventDefault(); setCommandMenuFocused(false); return }
            if (selectedCommand && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !parseAgentCommand(input)))) { event.preventDefault(); selectCommand(selectedCommand); return }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
          }} />
          <span className="agent-composer-hint">{input.length > 0 ? `${input.length}/4000` : t('agent.composerHint')}</span>
        </div>
        <Button type="submit" className="button button-primary agent-send" loading={busy} disabled={!input.trim()} leftSection={<Send size={15} />}>{busy ? t('agent.running') : t('agent.send')}</Button>
      </form>
    </div>
  </Modal>
}

export default AgentDialog
