import "@fontsource-variable/inter";
import "./styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@renderer/lib/i18n/i18n-provider";
import { App } from "@renderer/app/App";

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <I18nProvider locale="es">
      <App />
    </I18nProvider>
  </StrictMode>,
);
