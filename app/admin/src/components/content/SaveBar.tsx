import { Button } from '@mantine/core'
import { Check, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function SaveBar({ formId, isDirty, isPending, saved, label, onDiscard, onSave }: { formId: string; isDirty: boolean; isPending: boolean; saved: boolean; label: string; onDiscard: () => void; onSave: () => void }) {
  const { t } = useTranslation()
  if (!isDirty) return null
  return <div className="save-bar">
    <span>{t('saveBar.unsaved')}</span>
    <div className="save-bar-actions">
      <Button variant="default" onClick={onDiscard}>{t('saveBar.discard')}</Button>
      {/* The form unmounts with its tab panel, so a click from another tab
          must submit through the hook handler instead of the form attribute. */}
      <Button className="button button-primary" type="submit" form={formId} onClick={() => { if (!document.getElementById(formId)) onSave() }} loading={isPending} leftSection={saved ? <Check size={16} /> : <Save size={16} />}>{saved ? t('saveBar.saved') : label}</Button>
    </div>
  </div>
}
