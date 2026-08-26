import { createServerClient } from "../../lib/api";
import WritingArchive from "./writing-archive";

export const dynamic = "force-dynamic";

export default async function WritingPage() {
  const feed = await createServerClient().content({ limit: 100, kind: "ARTICLE" }).catch(() => null);
  return <WritingArchive items={feed?.data ?? null} />;
}
