import "./i18n/intl.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "@office/ui";
import { ApiError, setUnauthorizedHandler } from "./api/client.ts";
import { AuthProvider, userManager } from "./auth/auth.tsx";
import { ThemeProvider, useTheme } from "./lib/theme.tsx";
import { PreferencesSync } from "./lib/preferences.tsx";
import { createAppRouter } from "./router.tsx";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Don't retry client errors (403/404/validation); do retry flaky network/5xx a couple of times.
      retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
    },
  },
});
const router = createAppRouter(queryClient);

// Session ended server-side (revoked/expired): drop local tokens so the sign-in screen shows.
setUnauthorizedHandler(() => { void userManager.removeUser(); queryClient.clear(); });

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <PreferencesSync />
          <RouterProvider router={router} />
          <ThemedToaster />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
