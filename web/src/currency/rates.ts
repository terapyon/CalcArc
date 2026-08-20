/**
 * 更新方針(U-4 設計書 §4.2・§4.3)。
 *
 * **このファイルは I/O を持たない。** `fetch` は `provider.ts`、IndexedDB は
 * `cache.ts` にあり、ここにあるのは**いまの時刻・キャッシュ・取得結果を
 * 受け取って「何をするか」を返す純関数**だけである。分けてあるので、
 * **24 時間の境も検証の規則も、ネットワークもブラウザも使わずに vitest で回せる。**
 *
 * **`decide` は現在時刻を引数で受け取る**——中で `new Date()` を読むと、
 * 24 時間の境が「テストを走らせた瞬間」に依存して主張できなくなる。
 *
 * **React を import しない。** `web/src/calc/` と同じ境界に置く。
 */

import { CURRENCY_TOKENS, type CurrencyRateSet } from "./types";

/**
 * これを過ぎたら背後で取りに行く(spec §4.2 の「24 時間」)。
 *
 * **境は `fetchedAt`(瞬間)で切る。`date` では切らない**——`date` は UTC の
 * **日**で時刻を持たないので、「23:59 では取りに行かず 24:01 では行く」を
 * 日付から判定することはできない(`provider.ts` の `utcDate` の 3 番目の理由)。
 * 端末の時間帯も暦の日も判定に入らない。
 */
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * 面に出す 16 通貨の ISO コード。**`rates` の鍵と同じ綴り(大文字)である。**
 *
 * **表を 2 つ持たない**——並びも綴りも `CURRENCY_TOKENS`(= Rust の
 * `Currency::ALL`、`token_parity.rs` が見張っている)から起こす。
 * `validate` の `allowed` に渡す既定値であり、盤面もここを読めばよい。
 */
export const ALLOWED_CURRENCY_CODES: readonly string[] = CURRENCY_TOKENS.map(
  (token) => token.toUpperCase(),
);

/**
 * **`use` なら描いてよい。`refresh` が立っていても描くのを待たない**(§4.2)。
 *
 * `refresh` は「背後で取りに行け」であって「いま出せない」ではない。
 * **取得に失敗しても `use` のままである**——失敗は `decide` に届かないので、
 * 呼び出し側は古いセットをそのまま使い続ける(§5「致命的にしない」)。
 */
export type RateDecision =
  | { kind: "use"; set: CurrencyRateSet; refresh: boolean }
  /** キャッシュ無し。**エラーではなく §5 の案内**を出す。 */
  | { kind: "none" };

/**
 * 何をするかを決める(§4.2)。
 *
 * ```text
 * キャッシュが無い  → none(§5 の案内)
 * キャッシュがある  → use。ここで通信を待たない
 *                    24 時間以内 → refresh: false
 *                    24 時間超  → refresh: true(背後で取りに行く)
 * ```
 *
 * **`now` は引数である。** 中で現在時刻を読むと境をテストできない。
 */
export function decide(
  cached: CurrencyRateSet | null,
  now: Date,
): RateDecision {
  if (cached === null) return { kind: "none" };
  // **キャッシュがあれば必ず `use`。** 古くても捨てない——捨てた瞬間に
  // 「取得に失敗したら換算できない」になり、§5 が禁じた形になる。
  return { kind: "use", set: cached, refresh: isStale(cached, now) };
}

/**
 * 取りに行くべきか。**`fetchedAt` からの経過で切る。**
 *
 * `fetchedAt` が読めないときと、**`now` より未来のとき**は取りに行く
 * ——どちらも「いつ取ったか」を知らない状態であり、放っておくと
 * 二度と更新されない(未来の時刻は経過が負のまま動かない)。
 */
function isStale(cached: CurrencyRateSet, now: Date): boolean {
  const fetchedAt = Date.parse(cached.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return true;
  const age = now.getTime() - fetchedAt;
  if (!Number.isFinite(age)) return true;
  return age > REFRESH_AFTER_MS || age < 0;
}

/**
 * 書き戻すべきか(§4.2 / 設計書 §11.1)。
 *
 * **`date` が変わっていなければ書かない。** `fetchedAt` だけが動く書き込みを
 * 毎回するのは無駄である。
 *
 * **比較は UTC 日どうしになる**——`date` は `provider.ts` が UTC で切って
 * いるので、端末の時間帯が変わっても同じ表は同じ日付である。
 *
 * **`baseCurrency` は比べない。** 基準通貨は `provider.ts` の定数で、
 * 変わるとしたらコードの変更としてである。**利用者が基準通貨を選べるように
 * するなら、ここの比較を増やすこと**——同じ日付で基準だけ違う表を、
 * 中身が同じとみなして書き戻さなくなる。
 */
export function shouldWrite(
  cached: CurrencyRateSet | null,
  fetched: CurrencyRateSet,
): boolean {
  if (cached === null) return true;
  return cached.date !== fetched.date;
}

/**
 * 10 進リテラルの規則(計画の裁定 4-5)。
 *
 * **値と同じ規則をレートにも当てる**——規則を 2 つ持たない。`\d` は
 * JavaScript では `u` フラグが無くても **ASCII の 0-9 だけ**なので、
 * 全角数字やアラビア数字はここで落ちる。
 *
 * **指数表記(`1e-5`)はここに合わない。** プロバイダの応答に混じることが
 * あり(`provider.ts` は綴りを変えずにそのまま渡してくる)、**その通貨だけ
 * 落ちる**のが正しい——取得側で綴りを書き換えるのは spec §3 違反である。
 */
const DECIMAL_LITERAL = /^-?\d+(\.\d+)?$/;

/** `date` は画面に `Rate: 2026-08-14` の形で出る(§5)ので、形まで見る。 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 取得したもの・保存されていたものを検査する(§4.3)。
 *
 * **項目ごとに検査し、読めるものだけ使う**——既存の設定の復元(P-1 §5)と
 * 同じ流儀である。
 *
 * - **通貨 1 つのレートが 10 進として読めない → その通貨だけ落とす。**
 *   他は生き残る。面ではそのキーを押せなくする(§7)
 * - **`baseCurrency` か `date` が読めない → `null`**(セット全体を捨てる)。
 *   基準通貨が無ければどのレートも意味を持たない
 * - **`allowed` に無い通貨 → 落とす**(面に無いものは使わない)
 *
 * **空文字は「読めない」の入口である**——`provider.ts` は読めなかった
 * フィールドを捨てずに空文字で返す。捨てる判断はここだけが持つ
 * (取得由来とキャッシュ由来で規則が 2 か所に分かれないように)。
 *
 * **`baseCurrency` が `allowed` にあるかは見ない。** 換算は
 * `value × to_rate / from_rate` で基準通貨を約分してしまう(spec §3)ので、
 * 基準がこちらの面に無い通貨でも結果は変わらない。
 *
 * **読めるレートが 1 つも残らなければセットごと捨てる。** 日付だけ出て
 * 全部のキーが押せない画面より、**§5 の「レートがありません」の案内**の
 * ほうが読める。
 */
export function validate(
  raw: unknown,
  allowed: readonly string[],
): CurrencyRateSet | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;

  const baseCurrency = candidate.baseCurrency;
  if (typeof baseCurrency !== "string" || baseCurrency === "") return null;

  const date = candidate.date;
  if (typeof date !== "string" || !ISO_DATE.test(date)) return null;

  const rawRates = candidate.rates;
  if (
    typeof rawRates !== "object" ||
    rawRates === null ||
    Array.isArray(rawRates)
  ) {
    return null;
  }

  const permitted = new Set(allowed);
  const rates: Record<string, string> = {};
  for (const [code, rate] of Object.entries(rawRates)) {
    if (!permitted.has(code)) continue;
    if (typeof rate !== "string" || !DECIMAL_LITERAL.test(rate)) continue;
    // **綴りをそのまま持つ。** ここで `Number` を通したら、レートを 10 進の
    // 文字列で運んでいる意味が無くなる(spec §2.1)。
    rates[code] = rate;
  }
  if (Object.keys(rates).length === 0) return null;

  return {
    baseCurrency,
    date,
    // **`fetchedAt` が読めなくてもセットは捨てない**(§4.3 が全体を捨てると
    // 書いたのは `baseCurrency` と `date` の 2 つだけ)。読めなければ空文字にし、
    // `decide` が「取りに行く」側に倒す。
    fetchedAt:
      typeof candidate.fetchedAt === "string" ? candidate.fetchedAt : "",
    provider: typeof candidate.provider === "string" ? candidate.provider : "",
    rates,
  };
}
