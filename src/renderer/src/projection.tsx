import "@fontsource-variable/noto-sans";
import "./styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installDropGuard } from "@renderer/lib/drop-guard";
import { ProjectionApp } from "@renderer/projection/ProjectionApp";

installDropGuard();

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <ProjectionApp />
  </StrictMode>,
);
