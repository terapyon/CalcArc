import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // **時間帯を固定する。手元と CI を同じ条件にするためである。**
    // web 側の vite.config.ts と同じ理由づけで、値も揃える。
    env: { TZ: "UTC" },
    // **include を明示する。** 既定は `**/*.{test,spec}.*` なので、
    // 書かないと Playwright の `tests/corpus/*.spec.ts` を vitest が
    // 拾い上げる。web 側も同じ理由で明示している。
    include: ["tests/unit/**/*.test.ts"],
  },
});
