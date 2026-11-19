import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ApiError } from "./lib/api.ts";
import { applyTheme, getTheme } from "./lib/theme.ts";
import { router } from "./router.tsx";
import "./styles.css";

applyTheme(getTheme());
const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>
  </StrictMode>,
);
