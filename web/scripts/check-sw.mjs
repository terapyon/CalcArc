// ビルド成果物が設計書 §2 の意図を実装していることの機械検査。
// 設定ミスはこの層でしか捕まらない(vite.config は意図、dist は事実)。
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "..", "dist");
const fail = (msg) => {
  console.error(`check:sw NG — ${msg}`);
  process.exit(1);
};

const swPath = resolve(dist, "sw.js");
if (!existsSync(swPath)) fail("dist/sw.js が無い(SW が生成されていない)");
const sw = readFileSync(swPath, "utf8");

// 1. 無条件の即時活性化が無いこと(設計書 §9-3b)。
//    注意: prompt モードでも SKIP_WAITING メッセージ応答として skipWaiting は
//    ガード付きで現れる。「skipWaiting が無い」は検査にならない。
//    autoUpdate 注入の痕跡は clientsClaim で見る。
if (sw.includes("clientsClaim")) {
  fail("sw.js に clientsClaim がある(autoUpdate 化の痕跡。registerType を確認)");
}
if (!sw.includes("SKIP_WAITING")) {
  fail("sw.js に SKIP_WAITING ガードが無い(prompt の形をしていない)");
}

// 2. precache に wasm が載っていること(設計書 §7。2MB 上限ドリフトの番人)。
//    ビルドが失敗しても劣化した sw.js が書き出されるのは vite-plugin-pwa
//    v1.3.0 の実装詳細であり、この検査はそれに依存しない——どの経路であれ
//    dist の実物を検査するのが役目。
if (!/\.wasm/.test(sw)) {
  fail("precache に .wasm が無い(glob か上限を確認。オフラインで計算不能になる)");
}

// 3. manifest の中身。
const manifestPath = resolve(dist, "manifest.webmanifest");
if (!existsSync(manifestPath)) fail("manifest.webmanifest が無い");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.display !== "standalone") fail(`display が ${manifest.display}`);
const sizes = (manifest.icons ?? []).map((i) => i.sizes);
for (const need of ["192x192", "512x512"]) {
  if (!sizes.includes(need)) fail(`icons に ${need} が無い`);
}
for (const icon of manifest.icons) {
  if (!existsSync(resolve(dist, icon.src))) fail(`${icon.src} が dist に無い`);
}

console.log("check:sw OK — prompt 形 / wasm precache / manifest 完備");
