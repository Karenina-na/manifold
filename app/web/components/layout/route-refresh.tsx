"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RouteRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refreshWritingArchive = () => {
      window.setTimeout(() => {
        if (window.location.pathname === "/writing") router.refresh();
      }, 0);
    };
    const refreshAfterBfcache = (event: PageTransitionEvent) => {
      if (event.persisted) refreshWritingArchive();
    };
    window.addEventListener("popstate", refreshWritingArchive);
    window.addEventListener("pageshow", refreshAfterBfcache);
    return () => {
      window.removeEventListener("popstate", refreshWritingArchive);
      window.removeEventListener("pageshow", refreshAfterBfcache);
    };
  }, [router]);
  return null;
}
