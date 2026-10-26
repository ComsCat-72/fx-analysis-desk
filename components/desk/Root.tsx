"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import App from "./App";

/** The dashboard is a client-only app (it reads the browser's saved token, theme and instrument). */
export default function Root() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 } } }));
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <QueryClientProvider client={qc}>{mounted ? <App /> : null}</QueryClientProvider>;
}
