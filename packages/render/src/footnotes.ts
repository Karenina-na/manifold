import { getRenderMessages } from "./i18n/resources";
import { escapeHtml, mdastText, type MdNode } from "./mdast";

// GFM footnotes have no first-class component in react-markdown v10, so they
// are rewritten at the mdast layer: every reference becomes an inline <sup>
// capsule (with a CSS hover popover carrying the note text) and all
// definitions are gathered into one quiet <section data-footnotes> at the end.
//
// Numbering follows the order the *definitions* appear in the source, which is
// also what vditor/lute does inside the admin editor — so the editor and the
// public render show the same numbers even when an author renumbers references
// by hand, deletes one, or uses named notes ([^note]).
//
// Anchor ids are built from that number instead of the raw identifier for the
// same reason: renaming [^3] to [^4] in both places must not move any target,
// and a note written as [^note] still gets a plain #fn-1 target.
type FootnoteDefinition = { id: string; number: number; text: string; refIds: string[] };

export function remarkFootnotes({
  backToReferenceLabel = getRenderMessages("en").footnoteBackToReference,
}: {
  backToReferenceLabel?: string;
} = {}) {
  return (tree: MdNode) => {
    const defs: FootnoteDefinition[] = [];
    const byId = new Map<string, FootnoteDefinition>();
    const refs: { id: string; node: MdNode }[] = [];

    // Collecting and pruning happen in one depth-first pass so definitions
    // keep their document order. Returning true removes a node: filtering the
    // child list is required because splicing while iterating skips siblings —
    // consecutive definitions used to leak their text into the body.
    const collect = (node: MdNode): boolean => {
      if (node.type === "footnoteDefinition") {
        const id = String(node.identifier ?? "");
        if (!byId.has(id)) {
          const def: FootnoteDefinition = { id, number: defs.length + 1, text: mdastText(node), refIds: [] };
          byId.set(id, def);
          defs.push(def);
        }
        return true;
      }
      if (node.type === "footnoteReference") {
        refs.push({ id: String(node.identifier ?? ""), node });
        return false;
      }
      if (node.children) node.children = node.children.filter((child) => !collect(child));
      return false;
    };
    collect(tree);

    const occurrences = new Map<string, number>();
    for (const { id, node } of refs) {
      const def = byId.get(id);
      // micromark only builds a reference when a definition exists; an
      // unmatched identifier stays literal text, so there is nothing to link.
      if (!def) continue;
      const occurrence = (occurrences.get(id) ?? 0) + 1;
      occurrences.set(id, occurrence);
      const refId = occurrence === 1 ? `fnref-${def.number}` : `fnref-${def.number}-${occurrence}`;
      def.refIds.push(refId);
      const popover = def.text ? `<span class="mdrFootnotePop">${escapeHtml(def.text)}</span>` : "";
      node.type = "html";
      node.value = `<sup class="mdrFootnoteRef"><a href="#fn-${def.number}" id="${refId}" data-footnote-ref>${def.number}${popover}</a></sup>`;
      delete node.children;
    }

    if (defs.length === 0) return;
    const items = defs
      .map((def) => {
        // One back-reference per reference site, so a note cited three times
        // can return the reader to each of them.
        const backrefs = def.refIds
          .map((refId) => `<a href="#${refId}" data-footnote-backref aria-label="${escapeHtml(backToReferenceLabel)}">&#8617;</a>`)
          .join("");
        return `<li id="fn-${def.number}"><p>${escapeHtml(def.text)}${backrefs ? ` ${backrefs}` : ""}</p></li>`;
      })
      .join("");
    tree.children = [...(tree.children ?? []), { type: "html", value: `<section data-footnotes><ol>${items}</ol></section>` }];
  };
}
