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

/** 375px を選んだ理由。**番人がこの文の在ることを見る。消さない。** */
export const WEBKIT_NARROW_REASON =
  "360px の iPhone は無い——Playwright 1.62.1 の端末定義で iPhone は 39 件、幅 360px は 0 件。" +
  "375px は iPhone 6〜8・SE（第 2 世代以降）・12/13 mini の幅である。" +
  "いちばん狭い 320px（初代 iPhone SE）は、どちらのエンジンでもこの検査の幅に入っていない。";

/**
 * **Chromium で測るいちばん狭い幅**(360px の Android)。E2E の中で最も狭い幅
 * であり、**マニュアルが「確かめている画面幅」として書く数字の出どころ**でも
 * ある(2026-09-11、利用者の裁定「320px は確かめない。対応幅を書いておく」)。
 */
export const CHROMIUM_NARROW_WIDTH = 360;

/** 360px の検査を、WebKit では 375px で測る。 */
export function narrowWidth(browserName: string): number {
  return browserName === "webkit" ? WEBKIT_NARROW_WIDTH : CHROMIUM_NARROW_WIDTH;
}
