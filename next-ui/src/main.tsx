import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme/fonts";
import { App } from "./App";
import { RootErrorBoundary } from "./RootErrorBoundary";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
