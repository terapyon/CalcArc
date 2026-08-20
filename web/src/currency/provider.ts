/**
 * 為替レートの取得(U-4 設計書 §2.1)。
 *
 * **このファイルだけが `fetch` を持つ。** IndexedDB は `cache.ts`、更新方針は
 * `rates.ts` にある。ここは **I/O だけ**で、取ってきたものが妥当かどうかの
 * 判断は持たない(§4.3 の検証は `rates.ts` の仕事)。
 *
 * **React を import しない。** `web/src/calc/` と同じ境界に置く。
 */

import type { CurrencyProvider, CurrencyRateSet } from "./types";

/**
 * ExchangeRate-API の Open Access エンドポイント(spec §2.1 の
 * 【プロバイダの確認 2026-08-20】で選定)。
 *
 * **キーもトークンも URL に無い**(§0.0-6)。**金額を乗せる場所も無い**
 * (§0.0-1)——GET するのはレート表 1 枚で、換算はこの端末で行う。
 */
export const PROVIDER_ENDPOINT = "https://open.er-api.com/v6/latest/";

/** `CurrencyRateSet.provider` の既定値。応答の `provider` が読めないときに使う。 */
export const PROVIDER_ID = "https://www.exchangerate-api.com";

/**
 * 要求する基準通貨。**どれでも換算結果は同じ**——core は必ず基準通貨を
 * 経由する(spec §3)。spec §2.1 の実測が `USD` なので綴りを揃えてある。
 */
export const DEFAULT_BASE_CURRENCY = "USD";

/**
 * **帰属表示は出さない選択肢が無い**(spec §2.1 実装時義務 3)。文言とリンク先は
 * プロバイダのドキュメントが指定したものそのままである。**置き場は §7 が
 * 予約したレート日付の行の隣**で、描くのは Task 7。ここに置くのは、
 * 「どのプロバイダから取ったか」を知っているのがこのファイルだからである。
 */
export const PROVIDER_ATTRIBUTION = {
  href: "https://www.exchangerate-api.com",
  text: "Rates By Exchange Rate API",
} as const;

export interface GetLatestRatesOptions {
  /** 要求する基準通貨。既定は {@link DEFAULT_BASE_CURRENCY}。 */
  base?: string;
  /** 差し替え用。既定は `globalThis.fetch`。テストはここを渡してネットワークに出ない。 */
  fetchImpl?: typeof fetch;
  /** `fetchedAt` に打つ時刻。既定は取得直後の現在時刻。 */
  now?: () => Date;
}

/**
 * レート表を 1 枚取ってくる。
 *
 * **失敗は例外で返す**(ネットワーク断・非 2xx・本文が JSON でない)。
 * 失敗したときに何をするかは `rates.ts` と盤面の判断で、spec §5 は
 * 「致命的にしない——古いキャッシュで換算が続く」と決めている。
 *
 * **中身の妥当性は見ない。** `base_code` や `time_last_update_utc` が読めなければ
 * 空文字を入れて返す——**「基準通貨か日付が読めないセットは丸ごと捨てる」は
 * §4.3 の判断であって I/O の判断ではない**。ここで捨ててしまうと、
 * 同じ規則がキャッシュ由来のセットと取得由来のセットで 2 か所に分かれる。
 */
export async function getLatestRates(
  options: GetLatestRatesOptions = {},
): Promise<CurrencyRateSet> {
  const base = options.base ?? DEFAULT_BASE_CURRENCY;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const url = `${PROVIDER_ENDPOINT}${encodeURIComponent(base)}`;

  // **Cookie を送らない。** 送るものが無いことを明示しておく(§0.0-1 の隣の話)。
  // 独自ヘッダは付けない——付けると CORS の preflight が要る。
  const response = await doFetch(url, { credentials: "omit" });
  if (!response.ok) {
    // 429 も含めてここに来る。spec §2.1 は「20 分待てば解ける」と書いており、
    // 呼び出し側から見れば「今回は取れなかった」以上の意味を持たない。
    throw new Error(`currency provider responded ${response.status}`);
  }

  // **`json()` ではなく `text()`。** 生の綴りが要る(下の parseLatestRates)。
  const body = await response.text();
  const now = (options.now ?? (() => new Date()))();
  return parseLatestRates(body, now);
}

/** `CurrencyProvider`(spec §2.1)としての姿。`rates.ts` と盤面はこれを受け取る。 */
export const exchangeRateApi: CurrencyProvider = {
  getLatestRates: () => getLatestRates(),
};

/**
 * 応答の生テキストから `CurrencyRateSet` を組み立てる。**I/O を持たない**ので
 * テストから直接呼べる。
 *
 * **`rates` の値は `JSON.parse` の戻り値から取らない。** 応答の `rates` は
 * 引用符の無い JSON 数値(`"JPY": 158.548543`)なので、パース結果から取ると
 * そこで `f64` を 1 度通ってしまう——spec §2.1 が禁じていることそのものである
 * (`parseFloat` して文字列に戻すのも同じ)。**生テキストから数値リテラルの
 * 綴りをそのまま切り出す。**
 *
 * 文字列のフィールド(`base_code` など)は `JSON.parse` から取ってよい。
 * **文字列は `f64` を通らない。**
 */
export function parseLatestRates(
  body: string,
  fetchedAt: Date,
): CurrencyRateSet {
  const doc: unknown = JSON.parse(body);
  const root: Record<string, unknown> =
    typeof doc === "object" && doc !== null
      ? (doc as Record<string, unknown>)
      : {};

  return {
    baseCurrency: typeof root.base_code === "string" ? root.base_code : "",
    date: utcDate(root.time_last_update_utc),
    fetchedAt: fetchedAt.toISOString(),
    rates: extractRateLiterals(body),
    provider: typeof root.provider === "string" ? root.provider : PROVIDER_ID,
  };
}

/**
 * 生テキストの `"rates"` オブジェクトから、値の綴りをそのまま取り出す。
 *
 * **正規表現で切り出す**(`JSON.parse` の reviver の `context.source` は採らない
 * ——理由は 2026-08-20 の実測: Chrome 114 / Firefox 135 / **Safari 18.4** 以降で
 * しか使えず、このアプリはスマートフォン第一で `tsconfig` の target も ES2022 である)。
 *
 * **拾うのは JSON の数値リテラルだけ。** 文字列やオブジェクトが入っていた通貨は
 * 落ちる——**どのみち 10 進として読めないものは §4.3 が落とす**ので、
 * ここで判断を足していることにはならない。
 *
 * **指数表記も綴りのまま拾う。** `1e-5` は spec §3 のリテラル規則
 * (`-?\d+(\.\d+)?`)に合わないので `rates.ts` が落とすが、**落とすのは
 * 検証の仕事**であり、取得側が黙って形を変えてはいけない。
 */
function extractRateLiterals(body: string): Record<string, string> {
  const open = /[{,]\s*"rates"\s*:\s*\{/.exec(body);
  if (open === null) return {};

  const start = open.index + open[0].length;
  const end = objectEnd(body, start);
  if (end === null) return {};

  const out: Record<string, string> = {};
  const member =
    /"([^"\\]*)"\s*:\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const inner = body.slice(start, end);
  let hit = member.exec(inner);
  while (hit !== null) {
    const key = hit[1];
    const literal = hit[2];
    if (key !== undefined && literal !== undefined) out[key] = literal;
    hit = member.exec(inner);
  }
  return out;
}

/**
 * `start`(開き波括弧の直後)から対応する閉じ波括弧の位置を返す。
 * **文字列の中の波括弧を数えない**ようにエスケープを見る。
 */
function objectEnd(body: string, start: number): number | null {
  let depth = 1;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const RFC_1123 =
  /^[A-Za-z]{3},\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(GMT|UTC|[+-]\d{4})$/;

/**
 * `time_last_update_utc`(RFC 1123。例 `"Thu, 20 Aug 2026 00:02:31 +0000"`)から
 * `YYYY-MM-DD` を作る。読めなければ空文字——**捨てる判断は §4.3 が持つ**。
 *
 * **日付は UTC で切る。ローカル時刻では切らない。** 理由は 3 つある。
 *
 * 1. **この日付はレート表の身元である。** プロバイダは UTC の 1 日に 1 回
 *    表を差し替える(実測: `time_next_update_utc` は翌日の 00 時台)。
 *    端末の時間帯で切ると、**同じ表が端末ごとに違う日付になる**。
 * 2. **`shouldWrite` が `date` の一致で書き戻しを止める**(§4.2 / Task 6)。
 *    ローカルで切ると、時間帯をまたいで移動しただけで同じ表の日付が動き、
 *    中身が同じキャッシュを書き直すことになる。
 * 3. **24 時間の判定は `fetchedAt`(瞬間)で行う**ので、`date` を UTC で
 *    切っても境の判定とはずれない——**日付は「いつのレートか」の表示と
 *    同一性の判定にだけ使う**(§0.0-3・§5)。
 */
function utcDate(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const hit = RFC_1123.exec(raw.trim());
  if (hit === null) return "";

  const [, day, month, year, hour, minute, second, zone] = hit;
  if (
    day === undefined ||
    month === undefined ||
    year === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    zone === undefined
  ) {
    return "";
  }
  const monthIndex = MONTHS.indexOf(month as (typeof MONTHS)[number]);
  if (monthIndex < 0) return "";

  const offsetMinutes =
    zone === "GMT" || zone === "UTC"
      ? 0
      : (zone.startsWith("-") ? -1 : 1) *
        (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));

  const ms =
    Date.UTC(
      Number(year),
      monthIndex,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) -
    offsetMinutes * 60_000;
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * **`time_eol_unix` は持たない**(申し送りへの回答)。
 *
 * 実測値は `0`(= 廃止予定なし)で、**今日この端末で警告に使えるものが無い**。
 * `CurrencyRateSet` は spec §2.1 が形を決めた型で、cache・`rates.ts`・盤面の
 * 3 つが読む。**読み手のいないフィールドを増やすと、§4.3 の検証にも
 * §4.4 のキャッシュ版にも「何もしない分岐」が 1 つずつ増える。**
 * 必要になったら足して `RATES_SCHEMA_VERSION` を上げればよい——
 * **レートは捨てても取り直せる**(§4.4)ので、足すときの代償は小さい。
 */
