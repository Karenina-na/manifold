"use client";

import styles from "../../app/site.module.css";
import { useLocale } from "../layout/i18n-provider";

type PaginationProps = { page: number; totalPages: number; onChange: (page: number) => void; disabled?: boolean; label: string };

export function Pagination({ page, totalPages, onChange, disabled = false, label }: PaginationProps) {
  const { t } = useLocale();
  return <div className={styles.paginationSurface}>
    <nav className={styles.pagination} aria-label={label}>
      <button className={styles.pageButton} type="button" onClick={() => onChange(page - 1)} disabled={disabled || page <= 1}>{t("common.previous")}</button>
      <span className={styles.pageStatus}>{t("common.pageOf", { page, total: totalPages })}</span>
      <button className={styles.pageButton} type="button" onClick={() => onChange(page + 1)} disabled={disabled || page >= totalPages}>{t("common.next")}</button>
    </nav>
  </div>;
}
