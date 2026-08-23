import Link from "next/link";
import { ArrowLeft, ArrowUpRight, GitBranch } from "lucide-react";
import { createServerClient } from "../../lib/api";
import styles from "../site.module.css";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await createServerClient().projects().catch(() => null);
  return <main className={styles.page}><div className={styles.shell}><section className={styles.section}><Link href="/"><ArrowLeft size={15} /> Back home</Link><div className={styles.hero} style={{ paddingTop: 40 }}><div><span className={styles.eyebrow}>The workshop</span><h1>Things being <em>made.</em></h1></div><p className={styles.heroLead}>Small tools, experiments, and longer-running systems that make the garden more useful.</p></div>{projects ? <div className={styles.projectGrid}>{projects.data.map((project) => <article className={styles.projectCard} key={project.id}><div><h3>{project.name}</h3><p>{project.description || project.summary}</p><div className={styles.tags}>{project.techStack.map((tech) => <span className={styles.tag} key={tech}>{tech}</span>)}</div></div><footer><span>{project.status}</span><span>{project.repositoryUrl && <a href={project.repositoryUrl} target="_blank" rel="noreferrer"><GitBranch size={14} /> Source</a>}{project.homepageUrl && <a href={project.homepageUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={14} /> Visit</a>}</span></footer></article>)}</div> : <p className={styles.errorBanner}>Projects are unavailable at the moment.</p>}</section></div></main>;
}
