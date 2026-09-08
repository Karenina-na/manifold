"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { MouseEvent } from "react";

type BackLinkProps = {
  href: string;
  label: string;
  canGoBack: boolean;
};

/**
 * Archive back link. When the visitor arrived from this same site it walks
 * the browser history so the archive keeps its scroll position and URL query
 * (search, tags, sort); without an in-site referrer it falls back to a plain
 * navigation to `href`.
 */
export function BackLink({ href, label, canGoBack }: BackLinkProps) {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!canGoBack) return;
    event.preventDefault();
    router.back();
  }

  return (
    <Link href={href} onClick={handleClick}>
      <ArrowLeft size={15} /> {label}
    </Link>
  );
}
