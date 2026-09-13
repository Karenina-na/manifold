export type CenteredAsideInput = {
  viewportHeight: number;
  scrollTop: number;
  slotTop: number;
  slotHeight: number;
  asideHeight: number;
  navClearance: number;
};

export function computeCenteredAsideOffset({ viewportHeight, scrollTop, slotTop, slotHeight, asideHeight, navClearance }: CenteredAsideInput): number {
  const desiredViewportTop = Math.max(navClearance, (viewportHeight - asideHeight) / 2);
  const targetDocumentTop = scrollTop + desiredViewportTop;
  const maxOffset = Math.max(0, slotHeight - asideHeight);
  return Math.min(maxOffset, Math.max(0, targetDocumentTop - slotTop));
}
