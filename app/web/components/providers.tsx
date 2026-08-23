"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Theme } from "@radix-ui/themes";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  return <Theme appearance="light" accentColor="tomato" grayColor="sand" radius="none"><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></Theme>;
}
