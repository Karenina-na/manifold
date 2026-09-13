import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getServerI18n } from "../../../i18n/i18n-server";
import styles from "../../site.module.css";

export default async function WritingNotFound() {
  const { t } = await getServerI18n();
  return <main className={styles.page} data-route="writing"><div className={styles.shell}><section className={styles.section}><div className="articleBack"><Link href="/writing"><ArrowLeft size={15} /> {t("detail.backWriting")}</Link></div><h1>{t("detail.notFoundTitle")}</h1><p className={styles.muted}>{t("detail.notFoundBody")}</p></section></div></main>;
}
