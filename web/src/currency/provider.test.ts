import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_CURRENCY,
  getLatestRates,
  PROVIDER_ENDPOINT,
  PROVIDER_ID,
  parseLatestRates,
} from "./provider";

/** 実測した応答(spec §2.1 の【プロバイダの確認 2026-08-20】)を縮めたもの。 */
function body(rates: string, extra = ""): string {
  return `{"result":"success","provider":"https://www.exchangerate-api.com","documentation":"https://www.exchangerate-api.com/docs/free","terms_of_use":"https://www.exchangerate-api.com/terms","time_last_update_unix":1787184151,"time_last_update_utc":"Thu, 20 Aug 2026 00:02:31 +0000","time_next_update_utc":"Fri, 21 Aug 2026 00:11:41 +0000","time_eol_unix":0,${extra}"base_code":"USD","rates":{${rates}}}`;
}

const AT = new Date("2026-08-20T09:30:00.000Z");

describe("parseLatestRates", () => {
  it("応答を CurrencyRateSet にする", () => {
    const set = parseLatestRates(
      body(`"USD":1,"JPY":158.548543,"EUR":0.857421`),
      AT,
    );

    expect(set.baseCurrency).toBe("USD");
    expect(set.date).toBe("2026-08-20");
    expect(set.fetchedAt).toBe("2026-08-20T09:30:00.000Z");
    expect(set.provider).toBe(PROVIDER_ID);
    expect(set.rates).toEqual({
      USD: "1",
      JPY: "158.548543",
      EUR: "0.857421",
    });
  });

  it("rates の値は string である(number に化けていない)", () => {
    const set = parseLatestRates(body(`"JPY":158.548543`), AT);

    // **型で見る。** `toEqual` は "158.548543" と 158.548543 を区別するが、
    // ここは「文字列で保つ」(spec §2.1)そのものの主張なので明示的に見る。
    //
    // **件数を先に固定する。** ループだけだと、抽出が `{}` を返すようになった
    // 日にこの検査は **1 度も比較せずに緑**になる(レビューで実測——変異を
    // 当てるとこの 1 本だけが単独で緑のまま残った)。同ファイルの他の 3 本が
    // 捕まえるのでスイートに穴は空かないが、**この 1 本が何も主張しない**。
    expect(Object.keys(set.rates)).toHaveLength(1);
    let checked = 0;
    for (const rate of Object.values(set.rates)) {
      expect(typeof rate).toBe("string");
      checked += 1;
    }
    expect(checked).toBe(1);
  });

  /**
   * **f64 を 1 度も通していないことの固定。**
   *
   * ここに並ぶ 3 つは、**JSON の数値としてパースして文字列に戻すと綴りが変わる**
   * (2026-08-20 の実測):
   *
   * | 綴り | `String(JSON.parse(...))` | なぜ落ちるか |
   * |---|---|---|
   * | `0.1234567890123456789` | `0.12345678901234568` | f64 の有効桁を超える |
   * | `2.50` | `2.5` | f64 は末尾の 0 を覚えていない |
   * | `9007199254740993` | `9007199254740992` | 2^53+1。整数でも落ちる |
   *
   * **`1.0000000000000002` は使えない**——実測すると綴りのまま戻ってくるので、
   * `JSON.parse` 経由の実装でも緑になり、判別力が無い。
   */
  it("f64 を通せば変わる綴りが、そのまま残る", () => {
    const set = parseLatestRates(
      body(`"AAA":0.1234567890123456789,"BBB":2.50,"CCC":9007199254740993`),
      AT,
    );

    expect(set.rates.AAA).toBe("0.1234567890123456789");
    expect(set.rates.BBB).toBe("2.50");
    expect(set.rates.CCC).toBe("9007199254740993");
  });

  it("負・指数表記も綴りのまま拾う(落とすのは検証の仕事)", () => {
    const set = parseLatestRates(body(`"AAA":-0.5,"BBB":1e-5,"CCC":1E+3`), AT);

    expect(set.rates).toEqual({ AAA: "-0.5", BBB: "1e-5", CCC: "1E+3" });
  });

  it("数値でない値の通貨は落ちる", () => {
    const set = parseLatestRates(body(`"AAA":"1.5","BBB":null,"CCC":2.5`), AT);

    expect(set.rates).toEqual({ CCC: "2.5" });
  });

  it('文字列の中の "rates" に釣られない', () => {
    const set = parseLatestRates(
      body(
        `"JPY":158.5`,
        String.raw`"note":"see \"rates\": {\"JPY\":1} here",`,
      ),
      AT,
    );

    expect(set.rates).toEqual({ JPY: "158.5" });
  });

  it("rates が無ければ空(捨てる判断は rates.ts が持つ)", () => {
    const set = parseLatestRates(`{"base_code":"USD"}`, AT);

    expect(set.rates).toEqual({});
    expect(set.baseCurrency).toBe("USD");
  });
});

describe("date は UTC で切る", () => {
  it("UTC の日付になる(端末の時間帯で動かない)", () => {
    // 2026-08-20 08:30 +0900 は UTC では 2026-08-19 23:30。
    // **UTC で切るので 08-19。** ローカルで切っていれば 08-20 になる。
    const raw = `{"time_last_update_utc":"Thu, 20 Aug 2026 08:30:00 +0900","base_code":"USD","rates":{"USD":1}}`;

    expect(parseLatestRates(raw, AT).date).toBe("2026-08-19");
  });

  it("GMT 綴りも読む", () => {
    const raw = `{"time_last_update_utc":"Thu, 20 Aug 2026 00:02:31 GMT","base_code":"USD","rates":{"USD":1}}`;

    expect(parseLatestRates(raw, AT).date).toBe("2026-08-20");
  });

  it("読めない日付は空文字(捨てる判断は rates.ts が持つ)", () => {
    const raw = `{"time_last_update_utc":"soon","base_code":"USD","rates":{"USD":1}}`;

    expect(parseLatestRates(raw, AT).date).toBe("");
  });

  it("日付が無ければ空文字", () => {
    expect(parseLatestRates(`{"base_code":"USD","rates":{}}`, AT).date).toBe(
      "",
    );
  });
});

describe("読めないフィールド", () => {
  it("base_code が無ければ空文字(丸ごと捨てるのは rates.ts)", () => {
    expect(parseLatestRates(`{"rates":{"USD":1}}`, AT).baseCurrency).toBe("");
  });

  it("provider が無ければ既定の識別子", () => {
    expect(parseLatestRates(`{"rates":{"USD":1}}`, AT).provider).toBe(
      PROVIDER_ID,
    );
  });

  it("JSON でなければ例外(失敗は例外で返す)", () => {
    expect(() => parseLatestRates("<html>429</html>", AT)).toThrow();
  });
});

describe("getLatestRates", () => {
  it("キーを含まない URL を GET し、金額を送らない", async () => {
    let seen: { url: string; init: RequestInit | undefined } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(body(`"USD":1,"JPY":158.5`), { status: 200 });
    }) as unknown as typeof fetch;

    const set = await getLatestRates({ fetchImpl, now: () => AT });

    expect(seen).not.toBeNull();
    const call = seen as unknown as { url: string; init?: RequestInit };
    expect(call.url).toBe(`${PROVIDER_ENDPOINT}${DEFAULT_BASE_CURRENCY}`);
    // **キーもトークンも無い**(§0.0-6)。**本文が無い**(§0.0-1)。
    expect(call.url).not.toMatch(/key|token|apikey/i);
    expect(call.init?.body).toBeUndefined();
    expect(call.init?.credentials).toBe("omit");
    expect(set.rates.JPY).toBe("158.5");
  });

  it("基準通貨を指定できる", async () => {
    let url = "";
    const fetchImpl = (async (u: string) => {
      url = u;
      return new Response(body(`"EUR":1`), { status: 200 });
    }) as unknown as typeof fetch;

    await getLatestRates({ base: "EUR", fetchImpl, now: () => AT });

    expect(url).toBe(`${PROVIDER_ENDPOINT}EUR`);
  });

  it("非 2xx は例外(429 も含む)", async () => {
    const fetchImpl = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;

    await expect(getLatestRates({ fetchImpl })).rejects.toThrow(/429/);
  });

  it("fetchedAt は取得側が打つ", async () => {
    const fetchImpl = (async () =>
      new Response(body(`"USD":1`), {
        status: 200,
      })) as unknown as typeof fetch;

    const set = await getLatestRates({ fetchImpl, now: () => AT });

    expect(set.fetchedAt).toBe(AT.toISOString());
  });
});
