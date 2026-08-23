"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import styles from "../app/site.module.css";

export function ErrorState({ traceId, onRetry }: { traceId: string; onRetry: () => void }) {
	return <main className={styles.errorPage}><section className={styles.errorPanel} role="alert"><span className={styles.eyebrow}>A quiet interruption</span><h1>Something needs another pass.</h1><p>Manifold could not finish this view. Your content is still safe.</p><div className={styles.errorActions}><button className={styles.primaryButton} type="button" onClick={onRetry}><RotateCcw size={15} /> Try again</button><Link href="/">Return home</Link></div><small>Reference: {traceId}</small></section></main>;
}
