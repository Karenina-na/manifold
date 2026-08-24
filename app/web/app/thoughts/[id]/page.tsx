import { notFound } from "next/navigation";
import { createServerClient } from "../../../lib/api";
import WritingDetailPage from "../../writing/[slug]/page";

export const dynamic = "force-dynamic";

export default async function ThoughtDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const content = await createServerClient().contentBySlug(id).catch(() => null);
  if (!content) notFound();
  return <WritingDetailPage params={Promise.resolve({ slug: id })} />;
}
