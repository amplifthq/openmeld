import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { getBridge } from "./ipc";
import "./styles.css";

// Renderer entry. Mounted by index.html; the Electron wiring (preload exposing
// window.openmeld, main implementing the bridge) lands at L4.
const container = document.getElementById("root");
if (!container) {
  throw new Error("missing #root mount element");
}

createRoot(container).render(
  <StrictMode>
    <App bridge={getBridge()} />
  </StrictMode>
);
