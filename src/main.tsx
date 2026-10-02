import "@fontsource-variable/source-sans-3/wght.css";
import "@fontsource-variable/literata/wght.css";
import "./styles/base.css";
import "./styles/stage.css";
import "./styles/operator.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyStoredTheme } from "./lib/theme";

if (new URLSearchParams(window.location.search).get("view") !== "projection") applyStoredTheme();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
