import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "pnpm build && pnpm preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: "mobile",
      // スマートフォン第一(base-spec §42)。既定の viewport を縦持ちにする。
      use: { viewport: { width: 390, height: 844 }, isMobile: false },
    },
  ],
});
