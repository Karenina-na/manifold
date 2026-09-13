import { Button, TextInput } from '@mantine/core'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { useFieldArray, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { SiteSettingsForm } from '../../features/settings/siteSettingsSchema'

type LinkRowsFieldProps = {
  form: UseFormReturn<SiteSettingsForm>
  name: 'social' | 'navigation'
  addLabel: string
  maxRows: number
}

export function LinkRowsField({ form, name, addLabel, maxRows }: LinkRowsFieldProps) {
  const { t } = useTranslation()
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name })
  const count = fields.length
  return <div className="list-stack">
    {fields.map((field, index) => <div className="list-row" key={field.id}>
      <div className="list-row-top link-row">
        <span className="list-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="list-row-fields">
          <TextInput placeholder={t('links.label')} {...form.register(`${name}.${index}.label`)} error={form.formState.errors[name]?.[index]?.label?.message} />
          <TextInput placeholder={t('links.destination')} {...form.register(`${name}.${index}.href`)} error={form.formState.errors[name]?.[index]?.href?.message} />
          <label className="link-external">
            <input type="checkbox" {...form.register(`${name}.${index}.external`)} />
            <span>{t('links.external')}</span>
          </label>
        </div>
        <div className="list-row-actions">
          <button type="button" className="mini-button" aria-label={t('common.moveUp')} disabled={index === 0} onClick={() => move(index, index - 1)}><ChevronUp size={14} /></button>
          <button type="button" className="mini-button" aria-label={t('common.moveDown')} disabled={index === count - 1} onClick={() => move(index, index + 1)}><ChevronDown size={14} /></button>
          <button type="button" className="mini-button danger" aria-label={t('common.remove')} onClick={() => remove(index)}><Trash2 size={14} /></button>
        </div>
      </div>
    </div>)}
    <Button variant="light" color="teal" leftSection={<Plus size={14} />} disabled={count >= maxRows} onClick={() => append({ label: '', href: '', external: false })}>{addLabel}</Button>
  </div>
}
