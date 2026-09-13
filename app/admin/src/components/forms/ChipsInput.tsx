import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function ChipsInput({ value, onChange, placeholder }: { value: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (!value.includes(trimmed)) onChange([...value, trimmed])
    setDraft('')
  }
  return <div className="chips-row">
    {value.map((chip) => <span className="chip" key={chip}>{chip}<button type="button" aria-label={t('chips.remove', { value: chip })} onClick={() => onChange(value.filter((item) => item !== chip))}>×</button></span>)}
    <input
      className="chip-input"
      value={draft}
      placeholder={placeholder ?? t('chips.placeholder')}
      onChange={(event) => {
        if (event.target.value.endsWith(',')) {
          setDraft(event.target.value.slice(0, -1))
          commit()
          return
        }
        setDraft(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Backspace' && !draft && value.length) {
          onChange(value.slice(0, -1))
        }
      }}
      onBlur={commit}
    />
  </div>
}
