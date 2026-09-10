import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { useEffect, useRef } from 'react'

const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
const uploadIcon = '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
const calloutIcon = '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/></svg>'
// Per-variant callout icons mirror the renderer's semantic colors
// (packages/render/src/render.css --mdr-callout-*), so the dropdown reads
// the same way as the rendered note.
const calloutVariants = [
  { type: 'NOTE', color: '#4a7fb5', icon: '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="#4a7fb5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>' },
  { type: 'TIP', color: '#4f8f5f', icon: '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="#4f8f5f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>' },
  { type: 'IMPORTANT', color: '#8a6cb8', icon: '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="#8a6cb8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2.5 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.2l5.4-.8Z"/><path d="M12 11v4"/><path d="M12 17.5h.01"/></svg>' },
  { type: 'WARNING', color: '#c08a3e', icon: '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="#c08a3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>' },
  { type: 'CAUTION', color: '#c0504f', icon: '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="#c0504f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4"/><path d="M12 16h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>' },
] as const
const footnoteIcon = '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19h16"/><path d="M12 5 9 14"/><path d="m12 5 3 9"/></svg>'
const kbdIcon = '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2" ry="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M18 10h.01"/><path d="M9 14h6"/></svg>'
const markIcon = '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 9-9 9-9-9 9-9Z"/><path d="m7.5 7.5 9 9"/></svg>'
const diffIcon = '<svg xmlns="http://www.w3.org/2000/svg" style="stroke-width:2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h10"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>'

// Instant-rendering (MarkText-like) markdown editor. The editor is a writing
// aid only — it produces plain Markdown source; sanitization happens at the
// render boundary in @manifold/render.
export function MarkdownEditor({ value, onChange, disabled, placeholder, onUploadImage }: { value: string; onChange: (next: string) => void; disabled?: boolean; placeholder?: string; onUploadImage?: (file: File) => Promise<string> }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const readyRef = useRef(false)
  const emittedRef = useRef(value)
  const initialValueRef = useRef(value)
  const initialPlaceholderRef = useRef(placeholder)
  const valueRef = useRef(value)
  const disabledRef = useRef(Boolean(disabled))
  const onChangeRef = useRef(onChange)
  const onUploadRef = useRef(onUploadImage)

  useEffect(() => { onUploadRef.current = onUploadImage }, [onUploadImage])

  // Wrap the current selection (or insert a placeholder at the caret) with
  // GFM extensions the renderer supports: callouts, footnotes, kbd/mark and
  // diff blocks. These buttons only write Markdown source — the render
  // boundary in @manifold/render owns sanitization.
  //
  // vditor's own getSelection/updateValue route content through HTML
  // (execCommand insertHTML / template parsing), which lets the IR engine
  // drop unknown inline tags such as <mark>/<kbd> — the "click does nothing"
  // symptom. So we splice plain text instead: replace the live selection with
  // a text node kept alive for vditor's input handler, or insert HTML-escaped
  // text at the caret when nothing is selected.
  const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const wrapSelection = (editor: Vditor, prefix: string, suffix: string, placeholder: string) => {
    const irElement = editor.vditor.ir?.element
    const selection = window.getSelection()
    const selectedInEditor = Boolean(
      irElement &&
        selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        irElement.contains(selection.anchorNode),
    )
    if (selectedInEditor) {
      const range = selection!.getRangeAt(0)
      const text = `${prefix}${range.toString()}${suffix}`
      range.deleteContents()
      range.insertNode(document.createTextNode(text))
      range.collapse(false)
      const nextSelection = window.getSelection()
      nextSelection?.removeAllRanges()
      nextSelection?.addRange(range)
      irElement!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    } else {
      editor.insertValue(escapeHtml(`${prefix}${placeholder}${suffix}`))
    }
  }

  // Append plain markdown text at the very end of the IR document (used for
  // footnote definitions). Spliced as a text node kept alive for vditor's
  // input handler, mirroring wrapSelection's approach.
  const appendToEnd = (editor: Vditor, text: string) => {
    const irElement = editor.vditor.ir?.element
    if (!irElement) return
    const range = document.createRange()
    range.selectNodeContents(irElement)
    range.collapse(false)
    range.insertNode(document.createTextNode(text))
    const nextSelection = window.getSelection()
    nextSelection?.removeAllRanges()
    nextSelection?.addRange(range)
    irElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
  const gfmToolbar = (editor: () => Vditor | null) => {
    const ed = () => editor()
    return [
      {
        // One dropdown for the five callout types. The parent keeps a no-op
        // click because vditor's Custom handler calls click unconditionally
        // and would otherwise raise a TypeError before the submenu toggle.
        name: 'callout', icon: calloutIcon, tip: 'Callout', click: () => {},
        toolbar: calloutVariants.map(({ type, icon }) => ({
          name: `callout-${type.toLowerCase()}`,
          // vditor renders level-2 items through Custom, which overwrites the
          // button content with `icon` — so the variant name travels inside
          // the icon markup itself.
          icon: `${icon}<span style="margin-left:6px">${type[0]}${type.slice(1).toLowerCase()}</span>`,
          tip: `${type[0]}${type.slice(1).toLowerCase()} callout`,
          click: () => {
            const instance = ed(); if (!instance) return
            const selected = instance.getSelection()
            if (selected) instance.updateValue(`> [!${type}] ${selected}`)
            else instance.insertValue(`> [!${type}] `)
          },
        })),
      },
      {
        name: 'footnote', icon: footnoteIcon, tip: 'Footnote',
        click: () => {
          const instance = ed(); if (!instance) return
          // Number footnotes from the live source so repeated inserts never
          // collide (the editor may already contain [^2] from a prior run);
          // the reference lands at the caret and the definition is appended
          // to the end of the document instead of mid-paragraph.
          const source = instance.getValue() ?? ''
          let max = 0
          for (const match of source.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(match[1]))
          const n = max + 1
          const selected = instance.getSelection()
          if (selected) instance.updateValue(`${selected}[^${n}]`)
          else instance.insertValue(`[^${n}]`)
          appendToEnd(instance, `\n\n[^${n}]: `)
        },
      },
      {
        name: 'kbd', icon: kbdIcon, tip: 'Keyboard key',
        click: () => { const instance = ed(); if (instance) wrapSelection(instance, '<kbd>', '</kbd>', '⌘K') },
      },
      {
        name: 'mark', icon: markIcon, tip: 'Highlight',
        click: () => { const instance = ed(); if (instance) wrapSelection(instance, '<mark>', '</mark>', 'highlighted') },
      },
      {
        name: 'diff', icon: diffIcon, tip: 'Diff block',
        click: () => {
          const instance = ed(); if (!instance) return
          instance.insertValue('```diff\n+ added line\n- removed line\n plain line\n```\n')
        },
      },
    ]
  }

  // vditor's handler return value is only a tip string, never content —
  // uploads insert their markdown through insertValue ourselves.
  const uploadFiles = async (files: File[]) => {
    const onUpload = onUploadRef.current
    const editor = vditorRef.current
    if (!onUpload || !editor) return
    const snippets: string[] = []
    for (const file of files) {
      if (!allowedImageTypes.has(file.type)) {
        editor.tip(`Unsupported image type: ${file.name || file.type}`)
        continue
      }
      try {
        const url = await onUpload(file)
        const alt = file.name.replace(/[[\]()]/g, '').trim() || 'image'
        snippets.push(`![${alt}](${url})`)
      } catch (error) {
        editor.tip(error instanceof Error ? error.message : 'Image upload failed.')
      }
    }
    if (snippets.length) editor.insertValue(snippets.join('\n') + '\n')
  }

  useEffect(() => {
    onChangeRef.current = onChange
    valueRef.current = value
    if (readyRef.current && vditorRef.current && value !== emittedRef.current) {
      emittedRef.current = value
      vditorRef.current.setValue(value ?? '')
    }
  }, [onChange, value])

  useEffect(() => {
    disabledRef.current = Boolean(disabled)
    if (readyRef.current && vditorRef.current) {
      if (disabled) vditorRef.current.disabled()
      else vditorRef.current.enable()
    }
  }, [disabled])

  useEffect(() => {
    const host = hostRef.current
    if (!host || vditorRef.current) return
    // Vditor initializes asynchronously; enable/setValue/destroy throw until
    // its after() callback fires, so every interaction is gated on readiness.
    const destroyed = { current: false }
    let editor: Vditor
    const editorOptions: IOptions & { mark?: boolean } = {
      mode: 'ir',
      // Enable lute's <mark> rendering so inserted highlight markup is
      // visible inside the IR editor instead of lingering as plain text.
      mark: true,
      // Assets (lute, icons, i18n) are served from public/vditor — see
      // scripts/sync-vditor.mjs. No third-party origin at runtime.
      cdn: '/vditor',
      value: initialValueRef.current,
      placeholder: initialPlaceholderRef.current,
      cache: { enable: false },
      counter: { enable: true },
      // vditor debounces its input callback by undoDelay (default 800ms);
      // a short delay keeps form state close behind the keystrokes so a
      // fast save never captures a stale body.
      undoDelay: 60,
      toolbar: [
        'headings', 'bold', 'italic', 'strike', '|',
        'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
        'quote', 'line', 'code', 'inline-code', 'link', 'table', '|',
        ...gfmToolbar(() => vditorRef.current),
        '|', 'undo', 'redo', '|',
        'fullscreen', 'edit-mode', 'export', 'help',
        ...(onUploadRef.current ? [{ name: 'upload-image', icon: uploadIcon, tip: 'Upload image', click: () => inputRef.current?.click() }] : []),
      ],
      upload: onUploadRef.current ? {
        accept: UPLOAD_ACCEPT,
        multiple: true,
        handler: (files) => { void uploadFiles(files); return null },
      } : undefined,
      after: () => {
        if (destroyed.current) return
        readyRef.current = true
        const latest = valueRef.current ?? ''
        if (latest !== emittedRef.current) {
          emittedRef.current = latest
          editor.setValue(latest)
        }
        if (disabledRef.current) editor.disabled()
        else editor.enable()
      },
      input: (next) => {
        emittedRef.current = next ?? ''
        onChangeRef.current(emittedRef.current)
      },
    }
    editor = new Vditor(host, editorOptions)
    vditorRef.current = editor
    return () => {
      destroyed.current = true
      readyRef.current = false
      vditorRef.current = null
      try {
        editor.destroy()
      } catch {
        host.replaceChildren()
      }
    }
  }, [])
  // The editor mounts once per editor page; value changes flow through setValue.

  return <>
    <input
      ref={inputRef}
      type="file"
      accept={UPLOAD_ACCEPT}
      multiple
      hidden
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        void uploadFiles(files)
      }}
    />
    <div className={disabled ? 'vditor-host editor-locked' : 'vditor-host'} ref={hostRef} />
  </>
}
