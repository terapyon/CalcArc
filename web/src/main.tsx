import "./ui/tokens.css";
import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// prompt 戦略だが UI は出さない(設計書 §2)。コールバックを渡さなければ
// 新 SW は waiting に留まり、標準のライフサイクルで切り替わる。
registerSW();

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html is missing #root");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
