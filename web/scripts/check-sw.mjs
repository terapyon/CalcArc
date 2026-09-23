// ビルド成果物が設計書 §2 の意図を実装していることの機械検査。
// 設定ミスはこの層でしか捕まらない(vite.config は意図、dist は事実)。
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "..", "dist");
const fail = (msg) => {
  console.error(`check:sw NG — ${msg}`);
  process.exit(1);
};

/**
 * `denylist:[…]` の中身を正規表現として読み出す。
 *
 * **文字クラスの中の `/` で切らない。** 除外はいま `/\.[^/]+$/` の形で、
 * **`[^/]` の中に `/` が在る**——素朴に `/` で分けると、壊れた綴りを
 * `new RegExp` に渡して例外になる。
 */
function denylistPatterns(text) {
  const head = "denylist:[";
  const at = text.indexOf(head);
  if (at < 0) return [];
  const out = [];
  let i = at + head.length;
  while (i < text.length && text[i] !== "]") {
    if (text[i] !== "/") {
      i += 1; // 区切りの `,` と空白
      continue;
    }
    let j = i + 1;
    let inClass = false;
    let source = "";
    while (j < text.length) {
      const c = text[j];
      if (c === "\\") {
        source += c + text[j + 1];
        j += 2;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
      source += c;
      j += 1;
    }
    let k = j + 1;
    let flags = "";
    while (k < text.length && /[a-z]/.test(text[k])) {
      flags += text[k];
      k += 1;
    }
    out.push(new RegExp(source, flags));
    i = k;
  }
  return out;
}

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

// 3. navigation fallback に除外があること。
//    これが無いと、アドレスバーに /ogp.png と打ったときに SW が
//    index.html を返し、画像やアイコンが直接開けなくなる。curl では
//    SW を通らないので、この層でしか捕まらない。
if (!sw.includes("denylist")) {
  fail(
    "sw.js の navigation fallback に除外が無い(navigateFallbackDenylist を確認。/ogp.png のような実ファイルが index.html にすり替わる)",
  );
}

// 3b. **マニュアルの PDF が、その除外に実際に当たること**(0.9.3)。
//     `/manual/calcarc-<版>-<冊>.pdf` を開くのは **navigation リクエスト**
//     である(**0.9.6 からリンク集の PDF はまたここを指す**——0.9.5 のあいだ
//     だけ GitHub の Release を指していた)。除外に当たらないと
//     **SW が index.html を返し、Cloudflare の Function まで届かない**
//     ——**実体の無い PDF の 404 も、実体のある PDF そのものも出せなくなる**。
//     **「denylist という字が在る」では足りない**: 除外の中身が
//     `/^\/ogp\.png$/` のように狭まった日、上の検査は緑のままである。
const patterns = denylistPatterns(sw);
if (patterns.length === 0) {
  fail("sw.js の denylist から正規表現を 1 つも読み出せない(綴りが変わった)");
}
const manualPdf = "/manual/calcarc-0.0.0-quick-ja.pdf";
if (!patterns.some((re) => re.test(manualPdf))) {
  fail(
    `${manualPdf} が navigation fallback の除外に当たらない(SW がアプリの殻を返し、PDF が開けない)`,
  );
}

// 3c. **マニュアルの本文が precache に在ること**(0.9.6)。**本文は別の塊**
//     (`virtual:manuals`。動的 import なので本体とは別ファイル)で、**そこに
//     入っていなければ「オフラインでは読めないマニュアル」になる**——
//     **オフラインで読めることは、塊を分ける判断の条件だった**(監視役の裁定
//     2026-09-23)。**塊の名前は内容ハッシュ付き**なので、綴りで探さず
//     **`_virtual_manuals` を含む precache の行**を見る。
const manualChunk = /"(assets\/[^"]*_virtual_manuals[^"]*\.js)"/.exec(sw);
if (manualChunk === null) {
  fail(
    "マニュアルの本文の塊が precache に無い(オフラインでマニュアルが読めない。vite.config.ts の manualsPlugin と ManualPage の動的 import を確認)",
  );
}
if (manualChunk !== null && !existsSync(resolve(dist, manualChunk[1]))) {
  fail(`${manualChunk[1]} が dist に無い(precache が実在しないファイルを指す)`);
}

// 4. manifest の中身。
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
// 設計書 §3 の固定値。名乗りと更新境界・配色トークンの重複(vite.config.ts の
// コメント参照)がビルド成果物まで届いているかを見る。
if (manifest.name !== "CalcArc") fail(`name が ${manifest.name}`);
if (manifest.short_name !== "CalcArc") fail(`short_name が ${manifest.short_name}`);
if (manifest.lang !== "ja") fail(`lang が ${manifest.lang}`);
if (manifest.start_url !== "/") fail(`start_url が ${manifest.start_url}`);
if (manifest.scope !== "/") fail(`scope が ${manifest.scope}`);
if (manifest.theme_color !== "#f2f2f7") fail(`theme_color が ${manifest.theme_color}`);
if (manifest.background_color !== "#f2f2f7")
  fail(`background_color が ${manifest.background_color}`);
if (!manifest.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"))
  fail("512x512 の maskable アイコン(purpose)が無い");

console.log("check:sw OK — prompt 形 / wasm precache / manifest 完備");
