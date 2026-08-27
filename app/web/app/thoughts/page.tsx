import { createServerClient } from "../../lib/api";
import ThoughtArchive from "./thought-archive";

export const dynamic = "force-dynamic";

export default async function ThoughtsPage() {
  const archive = await createServerClient().thoughts({ page: 1, limit: 8 }).catch(() => null);
  return <ThoughtArchive initialArchive={archive} />;
}
