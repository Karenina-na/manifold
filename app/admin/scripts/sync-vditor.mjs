import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Vditor fetches lute, toolbar icons and language packs from its configured
// cdn at runtime. Copying the subset we need into public/ keeps the admin
// editor working without any third-party origin. The render-heavy preview
// engines (katex, mermaid, highlight, …) stay out on purpose — authoritative
// rendering lives in @manifold/render.
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../node_modules/vditor/dist");
const target = join(here, "../public/vditor/dist");

rmSync(join(here, "../public/vditor"), { recursive: true, force: true });
mkdirSync(join(target, "js"), { recursive: true });
for (const part of ["js/lute", "js/icons", "js/i18n"]) {
  cpSync(join(dist, part), join(target, part), { recursive: true });
}
