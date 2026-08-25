import { describe, expect, it } from "vitest";
import {
  ALLOWED_CURRENCY_CODES,
  decide,
  REFRESH_AFTER_MS,
  shouldWrite,
  validate,
} from "./rates";
import { CURRENCY_TOKENS, type CurrencyRateSet } from "./types";

/**
 * **境で挙動が変わる実例の日時**(監視役の指示)。
 *
 * `2026-08-19T23:30:00Z` は **`+0900` では 2026-08-20 08:30** である
 * ——Task 5 が `date` を UTC で切ると決めたときに置いた実例と同じ瞬間。
 */
const FETCHED_AT = "2026-08-19T23:30:00.000Z";

/** 取得から **23 時間 59 分**後。UTC の暦の日は既にまたいでいる(08-19 → 08-20)。 */
const NOW_23_59 = new Date("2026-08-20T23:29:00.000Z");

/** 取得から **24 時間 01 分**後。`NOW_23_59` と同じ UTC 日・同じ `+0900` 日である。 */
const NOW_24_01 = new Date("2026-08-20T23:31:00.000Z");

/** 取得からちょうど 24 時間後。**境そのもの。** */
const NOW_EXACT = new Date("2026-08-20T23:30:00.000Z");

function set(over: Partial<CurrencyRateSet> = {}): CurrencyRateSet {
  return {
    baseCurrency: "USD",
    date: "2026-08-20",
    fetchedAt: FETCHED_AT,
    provider: "https://www.exchangerate-api.com",
    rates: { USD: "1", JPY: "158.548543", EUR: "0.857421" },
    ...over,
  };
}

/** 16 通貨ぶんの、読めるレートが揃った `rates`。壊す 1 件を差し替えて使う。 */
function fullRates(): Record<string, string> {
  const rates: Record<string, string> = {};
  for (const [index, code] of ALLOWED_CURRENCY_CODES.entries()) {
    // 綴りは 10 進リテラルの規則(裁定 4-5)に合うものだけ。
    rates[code] = `${index + 1}.25`;
  }
  return rates;
}

describe("ALLOWED_CURRENCY_CODES", () => {
  it("面の 16 通貨を大文字にしたものである(表を 2 つ持たない)", () => {
    expect(ALLOWED_CURRENCY_CODES).toEqual(
      CURRENCY_TOKENS.map((token) => token.toUpperCase()),
    );
    expect(ALLOWED_CURRENCY_CODES).toHaveLength(16);
  });
});

describe("decide", () => {
  it("キャッシュが無ければ none(§5 の案内へ倒す)", () => {
    expect(decide(null, NOW_23_59)).toEqual({ kind: "none" });
  });

  it("キャッシュがあれば、まず use。通信を待たない", () => {
    const cached = set();
    const decision = decide(cached, NOW_23_59);

    expect(decision.kind).toBe("use");
    // **同じセットをそのまま描いてよい**——加工も待ちも挟まない。
    expect(decision).toEqual({ kind: "use", set: cached, refresh: false });
  });

  it("23:59 では取りに行かない(境の手前)", () => {
    const decision = decide(set(), NOW_23_59);

    expect(decision).toMatchObject({ kind: "use", refresh: false });
    // **暦の日ではなく瞬間で切っている**ことの実例: この 23:59 は
    // UTC の日を 1 回またいでいる(2026-08-19 → 2026-08-20)のに、
    // それでも取りに行かない。
    expect(FETCHED_AT.slice(0, 10)).toBe("2026-08-19");
    expect(NOW_23_59.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(NOW_23_59.getTime() - Date.parse(FETCHED_AT)).toBe(
      23 * 60 * 60 * 1000 + 59 * 60 * 1000,
    );
  });

  it("24:01 では取りに行く(境の向こう)", () => {
    const decision = decide(set(), NOW_24_01);

    expect(decision).toMatchObject({ kind: "use", refresh: true });
    expect(NOW_24_01.getTime() - Date.parse(FETCHED_AT)).toBe(
      24 * 60 * 60 * 1000 + 60 * 1000,
    );
  });

  it("境の 2 件は、UTC 日でもローカル日でも同じ日に居る", () => {
    // **暦の日で切っていたら、この 2 件は同じ答えになる。** 実際には
    // 片方だけ取りに行く——**判定に使っているのは経過時間だけ**である。
    expect(NOW_23_59.toISOString().slice(0, 10)).toBe(
      NOW_24_01.toISOString().slice(0, 10),
    );
    const jst = (at: Date) =>
      new Date(at.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(jst(NOW_23_59)).toBe("2026-08-21");
    expect(jst(NOW_24_01)).toBe("2026-08-21");

    expect(decide(set(), NOW_23_59)).toMatchObject({ refresh: false });
    expect(decide(set(), NOW_24_01)).toMatchObject({ refresh: true });
  });

  it("ちょうど 24 時間なら「24 時間以内」に含める", () => {
    expect(NOW_EXACT.getTime() - Date.parse(FETCHED_AT)).toBe(REFRESH_AFTER_MS);
    expect(decide(set(), NOW_EXACT)).toMatchObject({ refresh: false });
  });

  it("fetchedAt が読めなければ取りに行く。それでも use のままである", () => {
    let checked = 0;
    for (const fetchedAt of ["", "きのう", "2026-08-19", "23:30"]) {
      expect(decide(set({ fetchedAt }), NOW_23_59)).toMatchObject({
        kind: "use",
        refresh: true,
      });
      checked += 1;
    }
    expect(checked).toBe(4);
  });

  it("時間帯の無い綴りは、端末の時間帯によらず読めない扱いである", () => {
    // **ここには当初 `2026-08-19 23:30` が「読めない綴り」として並んでいた。
    // 読める綴りだった。** ECMAScript は日付と時刻があって時間帯が無い綴りを
    // **端末のローカル時刻**として読む——`Date.parse` の戻り値が端末で変わる。
    //
    // **2026-08-25 に CI が教えてくれた。** JST の手元では
    // `2026-08-19T14:30Z` と読まれて経過 32.98 時間 → 取りに行く（緑）。
    // UTC の CI では `2026-08-19T23:30Z` と読まれて経過 23.98 時間 →
    // 行かない（赤）。**同じ検査が、時間帯で反対の答を出していた。**
    //
    // いま `isStale` は時間帯の指定が無い綴りを読めない扱いにするので、
    // **どちらの端末でも `refresh: true`** である。この検査は
    // **`ISO_WITH_ZONE` の門を外すと、UTC でだけ赤くなる**
    // ——だから下で「素の `Date.parse` なら端末で割れる」ことも固定する。
    const localLooking = "2026-08-19 23:30";
    expect(decide(set({ fetchedAt: localLooking }), NOW_23_59)).toMatchObject({
      kind: "use",
      refresh: true,
    });

    // **判別力の担保。** この綴りが「そもそも誰にも読めない」なら、上の主張は
    // 門があっても無くても緑で、何も見張っていない。**素の `Date.parse` では
    // 読めてしまう**ことをここで固定する——読めるからこそ門が要る。
    expect(Number.isFinite(Date.parse(localLooking))).toBe(true);

    // **時間帯の指定があれば、綴りが同じ瞬間を指す。** `Z` と `+09:00` は
    // 9 時間ずれた別の瞬間で、どちらも端末に依存しない。
    expect(Date.parse("2026-08-19T23:30:00Z")).toBe(
      Date.parse("2026-08-20T08:30:00+09:00"),
    );
  });

  it("fetchedAt が未来なら取りに行く(経過が負のまま固まらない)", () => {
    const future = set({ fetchedAt: "2026-09-01T00:00:00.000Z" });
    expect(decide(future, NOW_23_59)).toMatchObject({
      kind: "use",
      refresh: true,
    });
  });
});

describe("取得の失敗を致命的にしない(§5)", () => {
  it("取りに行って失敗しても、古いキャッシュで換算が続く", async () => {
    // `decide` は I/O を持たないので**失敗を知らない**。主張する形はこうなる:
    // **「refresh: true を返しても kind は use のままで、渡ってくるのは
    // 古いセットそのもの」**——つまり、失敗しても描くものが手元にある。
    const cached = set();
    const first = decide(cached, NOW_24_01);
    expect(first).toEqual({ kind: "use", set: cached, refresh: true });

    // 呼び出し側の形を、この場で組み立てて回す。
    let fetches = 0;
    let writes = 0;
    let shown: CurrencyRateSet | null = first.kind === "use" ? first.set : null;
    const provider = {
      getLatestRates(): Promise<CurrencyRateSet> {
        fetches += 1;
        return Promise.reject(new Error("offline"));
      },
    };

    if (first.kind === "use" && first.refresh) {
      try {
        const fetched = await provider.getLatestRates();
        if (shouldWrite(cached, fetched)) writes += 1;
        shown = fetched;
      } catch {
        // 何もしない。**古いままで良い**(§5)。
      }
    }

    // スパイが本当に配線されていること(0 回で緑にならない)。
    expect(fetches).toBe(1);
    expect(writes).toBe(0);
    // **換算に使うセットは失敗の前後で同じ。**
    expect(shown).toBe(cached);
    expect(shown?.rates.JPY).toBe("158.548543");

    // **もう一度尋ねても捨てられていない。**
    expect(decide(shown, NOW_24_01)).toEqual({
      kind: "use",
      set: cached,
      refresh: true,
    });
  });
});

describe("shouldWrite", () => {
  it("date が同じなら書き戻さない(fetchedAt だけが動く書き込みをしない)", () => {
    const cached = set({ fetchedAt: FETCHED_AT });
    const fetched = set({ fetchedAt: "2026-08-20T23:31:00.000Z" });

    expect(cached.date).toBe(fetched.date);
    expect(cached.fetchedAt).not.toBe(fetched.fetchedAt);
    expect(shouldWrite(cached, fetched)).toBe(false);
  });

  it("date が変わったら書き戻す", () => {
    expect(shouldWrite(set(), set({ date: "2026-08-21" }))).toBe(true);
  });

  it("キャッシュが無ければ書く", () => {
    expect(shouldWrite(null, set())).toBe(true);
  });

  it("比較は UTC 日どうしである(同じ表は端末の時間帯で動かない)", () => {
    // `date` を作るのは `provider.ts` で、UTC で切っている。ここは
    // **その日付の文字列を比べるだけ**であり、時間帯を持ち込まない。
    const cached = set({ date: "2026-08-19", fetchedAt: FETCHED_AT });
    const fetched = set({
      date: "2026-08-19",
      fetchedAt: NOW_24_01.toISOString(),
    });
    expect(shouldWrite(cached, fetched)).toBe(false);
  });
});

describe("validate", () => {
  it("1 通貨だけ壊れたセットで、その 1 つだけが落ちて残りが生きる", () => {
    const rates = fullRates();
    rates.THB = "not a number";
    const result = validate(set({ rates }), ALLOWED_CURRENCY_CODES);

    expect(result).not.toBeNull();
    if (result === null) return;

    // **件数で主張する。**
    expect(Object.keys(result.rates)).toHaveLength(
      ALLOWED_CURRENCY_CODES.length - 1,
    );
    expect(result.rates.THB).toBeUndefined();

    // 残った 15 件が、綴りまでそのまま生きていること。
    // **比較の回数に下限を持たせる**(1 度も比較しないループにしない)。
    let compared = 0;
    for (const code of ALLOWED_CURRENCY_CODES) {
      if (code === "THB") continue;
      expect(result.rates[code]).toBe(rates[code]);
      compared += 1;
    }
    expect(compared).toBe(15);
  });

  it("指数表記(1e-5)の通貨が落ちる。他は生き残る", () => {
    const rates = fullRates();
    // `provider.ts` は綴りを変えずにそのまま渡してくる(spec §3)。
    rates.VND = "1e-5";
    const result = validate(set({ rates }), ALLOWED_CURRENCY_CODES);

    expect(result?.rates.VND).toBeUndefined();
    expect(Object.keys(result?.rates ?? {})).toHaveLength(
      ALLOWED_CURRENCY_CODES.length - 1,
    );
    expect(result?.rates.JPY).toBe(rates.JPY);
  });

  it("10 進として読めない綴りを、種類ごとに落とす", () => {
    let checked = 0;
    for (const bad of [
      "1e-5",
      "1E5",
      "+1.5",
      " 1.5",
      "1.5 ",
      "1.",
      ".5",
      "1,5",
      "Infinity",
      "NaN",
      "",
      "１.５", // 全角。裁定 4-5 は ASCII のみ
      "١٢٣", // アラビア数字
    ]) {
      const result = validate(
        set({ rates: { ...fullRates(), JPY: bad } }),
        ALLOWED_CURRENCY_CODES,
      );
      expect(
        result?.rates.JPY,
        `落ちるはず: ${JSON.stringify(bad)}`,
      ).toBeUndefined();
      expect(Object.keys(result?.rates ?? {})).toHaveLength(15);
      checked += 1;
    }
    expect(checked).toBe(13);
  });

  it("10 進として読める綴りは通す(符号つきも、裁定 4-5 の規則どおり)", () => {
    let checked = 0;
    for (const good of ["1", "0", "155.23", "158.548543", "-0.5", "0.00"]) {
      const result = validate(
        set({ rates: { ...fullRates(), JPY: good } }),
        ALLOWED_CURRENCY_CODES,
      );
      // **綴りがそのまま残る**(`Number` を通していない)。
      expect(result?.rates.JPY).toBe(good);
      checked += 1;
    }
    expect(checked).toBe(6);
  });

  it("レートの値が文字列でなければ、その通貨だけ落ちる", () => {
    const result = validate(
      set({ rates: { ...fullRates(), EUR: 0.857421 } as never }),
      ALLOWED_CURRENCY_CODES,
    );
    expect(result?.rates.EUR).toBeUndefined();
    expect(Object.keys(result?.rates ?? {})).toHaveLength(15);
  });

  it("知らない通貨は落とす(面に無いものは使わない)", () => {
    const rates = { ...fullRates(), XBT: "0.000015", ZZZ: "1", jpy: "158.5" };
    const result = validate(set({ rates }), ALLOWED_CURRENCY_CODES);

    expect(Object.keys(result?.rates ?? {})).toHaveLength(
      ALLOWED_CURRENCY_CODES.length,
    );
    for (const unknown of ["XBT", "ZZZ", "jpy"]) {
      expect(result?.rates[unknown]).toBeUndefined();
    }
  });

  it("allowed を狭めれば、そのぶんだけ残る", () => {
    const result = validate(set({ rates: fullRates() }), ["JPY", "USD"]);
    expect(Object.keys(result?.rates ?? {}).sort()).toEqual(["JPY", "USD"]);
  });

  it("baseCurrency が無いセットは丸ごと捨てる", () => {
    const { baseCurrency: _drop, ...without } = set();
    expect(validate(without, ALLOWED_CURRENCY_CODES)).toBeNull();
    // `provider.ts` は読めなかったフィールドを**空文字**で返す(捨てるのは
    // こちらの仕事)。**空文字が「読めない」の入口である。**
    expect(
      validate(set({ baseCurrency: "" }), ALLOWED_CURRENCY_CODES),
    ).toBeNull();
    expect(
      validate(set({ baseCurrency: 3 as never }), ALLOWED_CURRENCY_CODES),
    ).toBeNull();
    // 読めるセットは通る——**捨てる条件が広すぎないこと。**
    expect(validate(set(), ALLOWED_CURRENCY_CODES)).not.toBeNull();
  });

  it("date が読めないセットは丸ごと捨てる", () => {
    const { date: _drop, ...without } = set();
    expect(validate(without, ALLOWED_CURRENCY_CODES)).toBeNull();
    let checked = 0;
    for (const bad of ["", "2026/08/20", "20 Aug 2026", "2026-8-20"]) {
      expect(validate(set({ date: bad }), ALLOWED_CURRENCY_CODES)).toBeNull();
      checked += 1;
    }
    expect(checked).toBe(4);
  });

  it("読めるレートが 1 つも残らなければ捨てる(§5 の案内へ倒す)", () => {
    expect(
      validate(
        set({ rates: { XBT: "1", JPY: "1e-5" } }),
        ALLOWED_CURRENCY_CODES,
      ),
    ).toBeNull();
    expect(validate(set({ rates: {} }), ALLOWED_CURRENCY_CODES)).toBeNull();
    expect(
      validate(set({ rates: null as never }), ALLOWED_CURRENCY_CODES),
    ).toBeNull();
  });

  it("セットの形になっていないものは捨てる", () => {
    let checked = 0;
    for (const bad of [null, undefined, 3, "set", [], [set()]]) {
      expect(validate(bad, ALLOWED_CURRENCY_CODES)).toBeNull();
      checked += 1;
    }
    expect(checked).toBe(6);
  });

  it("fetchedAt と provider が読めなくてもセットは捨てない", () => {
    const { fetchedAt: _a, provider: _b, ...without } = set();
    const result = validate(without, ALLOWED_CURRENCY_CODES);

    expect(result).not.toBeNull();
    expect(result?.fetchedAt).toBe("");
    expect(result?.provider).toBe("");
    // 読めない `fetchedAt` は「取りに行く」側に倒れる。
    expect(result === null ? null : decide(result, NOW_23_59)).toMatchObject({
      kind: "use",
      refresh: true,
    });
  });
});
