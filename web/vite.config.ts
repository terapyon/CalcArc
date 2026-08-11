import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // Cloudflare Pages はルート配信なので base はそのまま。
  base: "/",
  plugins: [react(), wasm(), topLevelAwait()],
  build: { target: "es2022" },
});
