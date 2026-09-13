import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  const { t } = useTranslation()
  if (totalPages <= 1) return null
  return <div className="content-pager">
    <button type="button" className="mini-button" aria-label={t('common.previousPage')} disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={14} /></button>
    <span>{t('pager.pageOf', { page, total: totalPages })}</span>
    <button type="button" className="mini-button" aria-label={t('common.nextPage')} disabled={page >= totalPages} onClick={() => onChange(page + 1)}><ChevronRight size={14} /></button>
  </div>
}
