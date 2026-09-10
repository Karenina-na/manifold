// Minimal mdast shape shared by the remark plugins in this package: the
// plugins only need to read a handful of fields and rewrite nodes in place,
// so they stay independent of the full mdast type surface.
export type MdNode = {
  type: string;
  value?: string;
  identifier?: unknown;
  label?: unknown;
  data?: Record<string, unknown>;
  children?: MdNode[];
};

export const mdastText = (node: MdNode): string =>
  node.type === "text" ? node.value ?? "" : (node.children ?? []).map(mdastText).join("");

export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
