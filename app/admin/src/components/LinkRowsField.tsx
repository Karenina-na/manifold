import { Button, TextInput } from '@mantine/core'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { useFieldArray, type UseFormReturn } from 'react-hook-form'
import type { SiteSettingsForm } from '../lib/siteSettingsSchema'

type LinkRowsFieldProps = {
  form: UseFormReturn<SiteSettingsForm>
  name: 'social' | 'navigation'
  addLabel: string
  maxRows: number
}

export function LinkRowsField({ form, name, addLabel, maxRows }: LinkRowsFieldProps) {
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name })
  const count = fields.length
  return <div className="list-stack">
    {fields.map((field, index) => <div className="list-row" key={field.id}>
      <div className="list-row-top link-row">
        <span className="list-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="list-row-fields">
          <TextInput placeholder="Label" {...form.register(`${name}.${index}.label`)} error={form.formState.errors[name]?.[index]?.label?.message} />
          <TextInput placeholder="Label or /path, or full URL" {...form.register(`${name}.${index}.href`)} error={form.formState.errors[name]?.[index]?.href?.message} />
          <label className="link-external">
            <input type="checkbox" {...form.register(`${name}.${index}.external`)} />
            <span>Opens in a new tab</span>
          </label>
        </div>
        <div className="list-row-actions">
          <button type="button" className="mini-button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}><ChevronUp size={14} /></button>
          <button type="button" className="mini-button" aria-label="Move down" disabled={index === count - 1} onClick={() => move(index, index + 1)}><ChevronDown size={14} /></button>
          <button type="button" className="mini-button danger" aria-label="Remove" onClick={() => remove(index)}><Trash2 size={14} /></button>
        </div>
      </div>
    </div>)}
    <Button variant="light" color="teal" leftSection={<Plus size={14} />} disabled={count >= maxRows} onClick={() => append({ label: '', href: '', external: false })}>{addLabel}</Button>
  </div>
}
