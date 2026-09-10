import { describe, expect, it } from "vitest";
import { FIELD_LABELS } from "../Finance/FinancePanel";
import {
  COMPOUND_FIELD_SECTION,
  DEPOSIT_FOR_FIELD_SECTION,
  FINANCE_SECTIONS,
  PERIODS_FOR_FIELD_SECTION,
  PERIODS_SECTION,
  TAX_SECTION,
} from "./finance";

// Finance のキー集合そのものの検査。区画名は E2E のセレクタである(設計書 §3)。

function section(ariaLabel: string) {
  const found = FINANCE_SECTIONS.find((s) => s.ariaLabel === ariaLabel);
  if (!found) throw new Error(`no section named ${ariaLabel}`);
  return found;
}

describe("Finance のキー集合", () => {
  it("names its sections the way the design fixed them", () => {
    // 勝手に変えない——E2E がこの名前で引く。
    expect(FINANCE_SECTIONS.map((s) => s.ariaLabel)).toEqual([
      "計算の種類",
      "入力する項目",
      "数字と演算のキー",
    ]);
  });

  it("lays the number pad out five by five, like Scientific", () => {
    // **3 つのタブで AC・DEL の位置とキーの寸法を揃える**(設計書 §4)。
    // タブを行き来して AC の場所が変わるのは、押し間違いが入力のやり直しに
    // 直結する。
    const pad = section("数字と演算のキー");
    expect(pad.columns).toBe(5);
    expect(pad.height).toBe("square");
    expect(pad.keys.map((k) => k.label)).toEqual([
      "(",
      ")",
      "—",
      "DEL",
      "AC",
      "7",
      "8",
      "9",
      "÷",
      "万",
      "4",
      "5",
      "6",
      "×",
      "億",
      "1",
      "2",
      "3",
      "−",
      "—",
      "0",
      "000",
      ".",
      "+",
      "=",
    ]);
    // DEL と AC は最上段の右 2 つ——Scientific と同じ位置である。
    expect(pad.keys[3]?.token).toBe("del");
    expect(pad.keys[4]?.token).toBe("ac");
  });

  it("keeps the mode row double and the field row half", () => {
    // **高さが違うのが意図である**——同じ高さの 2 行は対等に見え、高さが
    // 違うほうが階層に見える(上が主、下が従。設計書 §11.3)。上段は
    // 2 行のラベルを 3 つ持つので 34px には入らない(実測 42px)。
    expect(section("計算の種類").height).toBe("double");
    expect(section("入力する項目").height).toBe("half");
    expect(COMPOUND_FIELD_SECTION.height).toBe("half");
    // ローン 3 + 複利 1 + 複利の逆算 2 (設計書 §11)。
    expect(section("計算の種類").keys).toHaveLength(6);
    expect(section("計算の種類").columns).toBe(6);
    // 月額は月額モードでは答だが、他の 2 モードでは入力である(設計書 §6)。
    expect(section("入力する項目").keys).toHaveLength(6);
    expect(section("入力する項目").columns).toBe(6);
  });

  it("swaps exactly one key for the target field", () => {
    expect(DEPOSIT_FOR_FIELD_SECTION.keys).toHaveLength(6);
    expect(DEPOSIT_FOR_FIELD_SECTION.columns).toBe(6);
    expect(DEPOSIT_FOR_FIELD_SECTION.ariaLabel).toBe("入力する項目");
    expect(DEPOSIT_FOR_FIELD_SECTION.keys.map((k) => k.token)).toEqual([
      "field:principal",
      "field:target",
      "field:rate",
      "field:months",
      "field:periods",
      "field:tax",
    ]);
    expect(PERIODS_FOR_FIELD_SECTION.keys.map((k) => k.token)).toEqual([
      "field:principal",
      "field:deposit",
      "field:rate",
      "field:target",
      "field:periods",
      "field:tax",
    ]);
  });

  it("gives every key an accessible name", () => {
    for (const s of FINANCE_SECTIONS) {
      for (const key of s.keys) {
        expect(key.ariaLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it("marks the cells that hold no key as reserved slots", () => {
    // **格子の形を崩さない**ために無効なボタンを描く(裁定 Q3)。
    // 金額と件数に負の値は無いので `+/−` は置かない。
    const pad = section("数字と演算のキー");
    const reserved = pad.keys.filter((k) => k.token === null);
    expect(reserved).toHaveLength(2);
    for (const key of reserved) {
      expect(key.label).toBe("—");
    }
  });

  // ---- 上段のラベル(設計書 §10)。**3 本まとめて置く理由が §10.4.0 にある**
  // ——**群を分けているのは語であり、色はそれを補強するだけである。**
  // 註は腐るが、**片方だけ動かすと赤くなる**なら腐らない。

  it("never spells a mode the same way as a field", () => {
    // **上段の「月額」「期間」が下段の項目キーと同じ語で、役が逆だった**
    // ——上は求める、下は入力する(設計書 §10.1)。**区別は `ariaLabel` に
    // だけ在って、目で見る人には無かった。** 系統 B は 6 つを
    // 「求めるものの名詞」に揃えてこれを消した(利用者裁定 2026-09-10)。
    //
    // **改行を取り除いて比べる**——`返済\n月額` と `月額` の違いは折り返し
    // 位置ではなく語であり、`\n` を残すと `返済\n月額` が `月額` と別物に
    // 見えてしまう(**「月額」に戻す変異を素通しする**)。
    const strip = (label: string) => label.replaceAll("\n", "");
    const modes = section("計算の種類").keys.map((k) => strip(k.label));
    const fields = [
      section("入力する項目"),
      COMPOUND_FIELD_SECTION,
      DEPOSIT_FOR_FIELD_SECTION,
      PERIODS_FOR_FIELD_SECTION,
    ].flatMap((s) => s.keys.map((k) => strip(k.label)));

    // **何件見たかを主張する。** 集合が空でも「共通要素なし」は緑になる
    // ——**0 件どうしを比べて緑になる形を作らない。**
    expect(modes.length).toBeGreaterThanOrEqual(6);
    expect(new Set(fields).size).toBeGreaterThanOrEqual(10);

    const clash = modes.filter((label) => fields.includes(label));
    expect(clash, `上段と下段で同じ語: ${clash.join(" / ")}`).toEqual([]);
  });

  it("fixes the line break in the data for every label that wraps", () => {
    // **6 列だと 1 枠 54.33px(390px 幅)/ 49.33px(360px 幅)しか無く、
    // 1 行に入るのは 3 文字まで**(設計書 §10.3 の実測)。4 文字以上は必ず
    // 折り返すので、**折り返し位置をデータで固定する**——自動折り返しに
    // 任せると「必要積」「立」のように語の途中で割れる。
    //
    // **6 列の行だけを見る。** 数字面(`PAD`)は 5 列で 1 枠が広く、この
    // 制約に掛からない。
    const rows = [
      section("計算の種類"),
      section("入力する項目"),
      COMPOUND_FIELD_SECTION,
      DEPOSIT_FOR_FIELD_SECTION,
      PERIODS_FOR_FIELD_SECTION,
    ];
    for (const row of rows) expect(row.columns).toBe(6);

    const wrapping: string[] = [];
    let seen = 0;
    for (const row of rows) {
      for (const key of row.keys) {
        seen += 1;
        if (key.label.replaceAll("\n", "").length < 4) continue;
        wrapping.push(key.label);
        expect(
          key.label,
          `${key.ariaLabel} は 4 文字以上なのに改行位置を持たない`,
        ).toContain("\n");
      }
    }

    // **何件見たかを主張する。** 4 文字以上が 1 つも無ければ上の `for` は
    // **1 度も比較せずに緑を返す**(このリポジトリで何度か踏んでいる形)。
    // 上段の 6 つは系統 B で全部 4 文字以上になった(設計書 §10.4.0)。
    expect(seen).toBeGreaterThanOrEqual(30);
    expect(wrapping.length).toBeGreaterThanOrEqual(6);
  });

  it("has no reserved slots in the mode and field rows", () => {
    // 予約スロットは数字面の 2 マスだけ。モード行と項目行のキーは全部働く。
    for (const name of ["計算の種類", "入力する項目"]) {
      for (const key of section(name).keys) {
        expect(key.token).not.toBeNull();
      }
    }
  });
  it("keeps every spelling the user approved, letter for letter", () => {
    // **★ 承認されたのは組み立て規則ではなく綴りそのもの**である
    // (設計書 `2026-09-03-finance-convention.md` §10.4.0・§11.4・§5.4.4)。
    // **この 1 本が、承認済みの綴りを 1 か所で全部持つ。**
    //
    // **なぜ要るか。** 2026-09-10、項目キーを `周期他` → `方式` に差し替えたら
    // **vitest 473 本・E2E 24 本が 1 本も鳴らなかった**(実測)。上の検査は
    // 「重複が無い」「4 文字以上は改行を持つ」「枠に収まる」を見ていて、
    // **どの綴りであるかは見ていない**——**承認されていない `周期他` が
    // 1 日入っていても、誰も言わなかった。**
    //
    // **1 つだけ守らない。** 1 つだけ名指しすると、名指ししていない残りが
    // 「守られている」と読まれる。**承認済みは 11 個(キー 10・chip の見出し 1)
    // で、11 個ともここに置く。**
    //
    // **期待値はこのテストが自分で持つ**——`finance.ts` から組み立てると、
    // 両方が同時に変わっても緑になる。
    const APPROVED: Record<string, string> = {
      // 上段(系統 B。利用者裁定 2026-09-10)
      "mode:payment": "返済\n月額",
      "mode:principal": "借入\n可能額",
      "mode:term": "返済\n期間",
      "mode:compound": "複利\n残高",
      "mode:deposit-for": "必要\n積立額",
      "mode:periods-for": "必要\n年数",
      // 下段(盤面のキー 1 行だけ。読み上げ名は「ボーナス」のまま)
      "field:bonus": "賞与",
      // 周期の面を開く項目キー(「周期他」は裁定を受けていなかった)
      "field:periods": "方式",
      // 積立の位置(カシオの日本語マニュアルと同じ語)
      "timing:end": "期末",
      "timing:start": "期首",
      // 入力済みの chip の見出し(#13 の裁定、2026-09-10)。**キーではない**が、
      // 「押したキー(方式)と同じ語にする」が裁定の中身なので、同じ表に置く。
      "chip:periods": "方式",
    };

    const everyKey = [
      ...FINANCE_SECTIONS,
      COMPOUND_FIELD_SECTION,
      DEPOSIT_FOR_FIELD_SECTION,
      PERIODS_FOR_FIELD_SECTION,
      PERIODS_SECTION,
      TAX_SECTION,
    ].flatMap((sec) => sec.keys);
    // chip の見出しは盤面のキーに無いので、`FinancePanel.tsx` の表から引く。
    const chips: Record<string, string> = {
      "chip:periods": FIELD_LABELS.periods,
    };

    const seen: string[] = [];
    for (const [token, expected] of Object.entries(APPROVED)) {
      const chip = chips[token];
      const labels =
        chip !== undefined
          ? [chip]
          : everyKey.filter((k) => k.token === token).map((k) => k.label);
      // **1 つも見つからない綴りを「一致した」と数えない。**
      expect(labels.length, `${token} のキーが見つからない`).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label, `${token} の綴りが承認済みと違う`).toBe(expected);
      }
      seen.push(token);
    }
    // **何件見たかを主張する**——表を 1 行消しても緑にならないように。
    expect(seen.length).toBe(11);
  });
});
