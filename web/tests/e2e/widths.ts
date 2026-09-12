/**
 * **WebKit で測る「狭い端末」の幅**(2026-09-11、利用者の裁定。門 1 の設計書 §1.5)。
 *
 * `finance-layout.spec.ts` の 360px の 2 本(複利の説明の行数と、複利の面の
 * 余白)は、WebKit では 375px で測る。**360px の iPhone は無い**ので、
 * 「WebKit × 360px」は実在する端末に当たらない組み合わせだった。
 * **Chromium は 360px のまま**(360px の Android の幅)。文言は変えていない。
 *
 * **これは「エンジンのほかは同じ条件」(`tools/tests/webkit-gate.test.ts`)
 * から外れる唯一の点である。** だから幅も理由もここ 1 か所に置き、
 * 呼んでよいのは上の 2 本だけにする——番人がその数と理由を見る。
 */
export const WEBKIT_NARROW_WIDTH = 375;

/**
 * **WebKit の狭い幅で測る高さ**(2026-09-12、利用者の了承)。812 は iPhone 13 mini・
 * X・11 Pro の**画面**の高さ(Playwright 1.62.1 の端末定義の `screen`)——ホーム画面
 * から開いたときの高さである。幅だけ 375 にして高さを Android の 800 のまま据え置くと、
 * **実在しない 375×800 を測ることになる**:キーの高さは幅に比例して伸びるので、
 * 375px では 360px よりパネルが 16.45px 高く、どのエンジンでも余白が 5.83px しか
 * 残らなかった(Chromium の 375×800 も同じ値。WebKit の差ではなかった)。
 */
export const WEBKIT_NARROW_HEIGHT = 812;

/** 375px を選んだ理由。**番人がこの文の在ることを見る。消さない。** */
export const WEBKIT_NARROW_REASON =
  "360px の iPhone は無い——Playwright 1.62.1 の端末定義で iPhone は 39 件、幅 360px は 0 件。" +
  "375px は iPhone 6〜8・SE（第 2 世代以降）・12/13 mini の幅である。" +
  "高さの 812 は iPhone 13 mini・X・11 Pro の、ホーム画面から開いたときの高さ——375×800 は Android の高さを写しただけの、実在しない寸法だった。" +
  "いちばん狭い 320px（初代 iPhone SE）は、どちらのエンジンでもこの検査の幅に入っていない。";

/**
 * **Chromium で測るいちばん狭い幅**(360px の Android)。E2E の中で最も狭い幅
 * であり、**マニュアルが「確かめている画面幅」として書く数字の出どころ**でも
 * ある(2026-09-11、利用者の裁定「320px は確かめない。対応幅を書いておく」)。
 */
export const CHROMIUM_NARROW_WIDTH = 360;

/**
 * **iPhone の Safari のタブの見える大きさ**(Playwright 1.62.1 の端末定義の
 * `viewport`。2026-09-12 に `devices` を読んで写した)。
 *
 * 予算の検査(390×844・360×800)は**画面の高さ**——ホーム画面から開いたときに
 * 近い——であって、**Safari のタブの高さを 1 度も測っていなかった。** タブで
 * 開くと、どの機種でも 1 画面に収まらずスクロールする(手元の Chromium で
 * 127〜165px)。**約束は「崩れない」だけ**(利用者の裁定 2026-09-12)——
 * スクロールすれば、すべての表示とキーが見えて押せる。その番人
 * (`short-screens.spec.ts`)がこの 4 つを使う。
 */
export const SAFARI_VIEWPORTS = [
  { device: "iPhone 13/14", width: 390, height: 664 },
  { device: "iPhone 16e", width: 390, height: 651 },
  { device: "iPhone SE (3rd gen)", width: 375, height: 667 },
  { device: "iPhone 13 mini", width: 375, height: 629 },
] as const;

/** 360×800 の検査を、WebKit では 375×812 で測る。Chromium は 360×800 のまま。 */
export function narrowSize(browserName: string): {
  width: number;
  height: number;
} {
  return browserName === "webkit"
    ? { width: WEBKIT_NARROW_WIDTH, height: WEBKIT_NARROW_HEIGHT }
    : { width: CHROMIUM_NARROW_WIDTH, height: 800 };
}
