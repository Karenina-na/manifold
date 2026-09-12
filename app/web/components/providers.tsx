"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Theme } from "@radix-ui/themes";
import { useState } from "react";
import { ThemeProvider, useTheme } from "./theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  return <ThemeProvider><RadixTheme><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></RadixTheme></ThemeProvider>;
}

// Split out because `appearance` has to be read from context, and the context
// provider must wrap this component. A hardcoded "light" left Radix controls
// (comment and like buttons) in the light palette on a dark page.
function RadixTheme({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return <Theme appearance={theme} accentColor="tomato" grayColor="sand" radius="none" hasBackground={false}>{children}</Theme>;
}
