import "./ui/tokens.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// SW の登録は UpdateToast が持つ(設計書 §1)。ここでも registerSW() を呼ぶと
// 登録が 2 度走り、更新の購読を持たない側が先に登録してしまう。

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html is missing #root");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
