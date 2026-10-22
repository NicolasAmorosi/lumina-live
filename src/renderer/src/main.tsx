// The wdth+wght file, not the default wght-only one: titles and the wordmark use
// the ExtraCondensed cut of this same family (`font-stretch-extra-condensed`).
import "@fontsource-variable/noto-sans/wdth.css";
import "./styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installDropGuard } from "@renderer/lib/drop-guard";
import { LocaleProvider } from "@renderer/lib/i18n/locale-provider";
import { App } from "@renderer/app/App";

installDropGuard();

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
