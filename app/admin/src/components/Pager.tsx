import { ChevronLeft, ChevronRight } from 'lucide-react'

export function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null
  return <div className="content-pager">
    <button type="button" className="mini-button" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={14} /></button>
    <span>Page {page} of {totalPages}</span>
    <button type="button" className="mini-button" aria-label="Next page" disabled={page >= totalPages} onClick={() => onChange(page + 1)}><ChevronRight size={14} /></button>
  </div>
}
