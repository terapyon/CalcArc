import { defineConfig } from "vitest/config";

export default defineConfig({
  // **リポジトリの外ではなく「このパッケージの外」を読む許可。** vite は
  // 既定でプロジェクト根の外のファイルを配らないので、`../tools/tests/` を
  // include しても読み込めない(「ファイルが在るのに見つからない」と出る)。
  server: { fs: { allow: [".."] } },
  test: {
    // **時間帯を固定する。手元と CI を同じ条件にするためである。**
    // web 側の vite.config.ts と同じ理由づけで、値も揃える。
    env: { TZ: "UTC" },
    // **include を明示する。** 既定は `**/*.{test,spec}.*` なので、
    // 書かないと Playwright の `tests/corpus/*.spec.ts` を vitest が
    // 拾い上げる。web 側も同じ理由で明示している。
    include: [
      "tests/unit/**/*.test.ts",
      // **`tools/` のテストは `tools/tests/` に住み、runner だけここが持つ。**
      // コードとテストを同居させたうえで、パッケージ（と lockfile）を
      // 増やさないための形である(2026-08-27 のユーザー裁定)。`tools/` は
      // リリースの道具（版数の照合・証拠の組み立て・本文の貼り直し・境界の
      // 検査）で、重量級と同じく**出荷物ではなく検査の側**にある。
      "../tools/tests/**/*.test.ts",
    ],
  },
});
