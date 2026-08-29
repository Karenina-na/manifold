"use client";

import styles from "../app/site.module.css";

type PaginationProps = { page: number; totalPages: number; onChange: (page: number) => void; disabled?: boolean; label: string };

export function Pagination({ page, totalPages, onChange, disabled = false, label }: PaginationProps) {
  return <div className={styles.paginationSurface}>
    <nav className={styles.pagination} aria-label={label}>
      <button className={styles.pageButton} type="button" onClick={() => onChange(page - 1)} disabled={disabled || page <= 1}>Previous</button>
      <span className={styles.pageStatus}>Page {page} of {totalPages}</span>
      <button className={styles.pageButton} type="button" onClick={() => onChange(page + 1)} disabled={disabled || page >= totalPages}>Next</button>
    </nav>
  </div>;
}
