import "@fontsource-variable/noto-sans";
import "./styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProjectionApp } from "@renderer/projection/ProjectionApp";

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <ProjectionApp />
  </StrictMode>,
);
