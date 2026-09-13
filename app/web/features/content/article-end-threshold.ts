interface ArticleEndPosition {
  atEnd: boolean;
  previousScrollY: number;
  scrollY: number;
  triggerTop: number;
  activationLine: number;
}

export function resolveArticleActionsAtEnd({ atEnd, previousScrollY, scrollY, triggerTop, activationLine }: ArticleEndPosition): boolean {
  if (!atEnd) return triggerTop <= activationLine;
  return !(scrollY < previousScrollY && triggerTop > activationLine);
}
