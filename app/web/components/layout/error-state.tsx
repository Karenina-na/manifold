"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import styles from "../../app/site.module.css";
import { useLocale } from "./i18n-provider";

export function ErrorState({ traceId, onRetry }: { traceId: string; onRetry: () => void }) {
	const { t } = useLocale();
	return <main className={styles.errorPage}><section className={styles.errorPanel} role="alert"><span className={styles.eyebrow}>{t("error.label")}</span><h1>{t("error.title")}</h1><p>{t("error.body")}</p><div className={styles.errorActions}><button className={styles.primaryButton} type="button" onClick={onRetry}><RotateCcw size={15} /> {t("common.tryAgain")}</button><Link href="/">{t("common.returnHome")}</Link></div><small>{t("common.reference", { traceId })}</small></section></main>;
}
