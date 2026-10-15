import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

// With registerType "autoUpdate", the page reloads itself as soon as a new
// deployment's service worker takes over, instead of showing the cached version.
// The installed app can stay open for days, so also check for a new version hourly.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) setInterval(() => registration.update(), 60 * 60 * 1000);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
