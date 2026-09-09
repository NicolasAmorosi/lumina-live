import "@fontsource-variable/noto-sans";
import "./styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "@renderer/lib/i18n/locale-provider";
import { App } from "@renderer/app/App";

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
