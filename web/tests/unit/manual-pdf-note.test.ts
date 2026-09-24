/**
 * 画面の注記（`PDF_NOTE`）と、マニュアル 3 冊が**同じ事実**を言っていること（0.9.8）。
 *
 * **言い換えは機械で照合できないが、事実の断片は照合できる**（設計書 §5、
 * レビュー役 calcarc-1e の指摘）。**照らすのは 3 つだけ**——**日付・判定・行き先**。
 * **文の残りは人が見る**（**同じことを言う 2 か所**として台帳に書いてある）。
 *
 * **なぜ要るか（実測）**: **2026-09-25 に、CHANGELOG がマニュアルの古い文
 * （「戻れなくなることがあります」）を引いたまま残っていた**——**マニュアルを
 * 「戻れません」に直したのに、それを説明している側を探さなかった**。
 * **片側だけ直した日に、この検査が赤くなる。**
 */
import { describe, expect, it } from "vitest";
import { PDF_NOTE, PDF_NOTE_FACTS } from "../../src/ui/Manual/ManualPage";
import { manualName, readManuals } from "./manuals";

describe("画面の注記とマニュアルの事実", () => {
  const files = readManuals();

  it("画面の 1 行は、3 つの断片から組み立てられている", () => {
    // **定数を素通しで信じない**——**文のほうを書き換えて断片を外せる**ので、
    // **組み立てた文に 3 つとも在る**ことを見る。
    for (const fact of Object.values(PDF_NOTE_FACTS)) {
      expect(PDF_NOTE, fact).toContain(fact);
    }
    expect(Object.values(PDF_NOTE_FACTS)).toHaveLength(3);
  });

  it("日本語の 2 冊は、3 つの断片をすべて持つ", () => {
    const japanese = files.filter((file) =>
      manualName(file).endsWith(".ja.md"),
    );
    expect(japanese.map(manualName)).toEqual(["detail.ja.md", "quick.ja.md"]);
    for (const file of japanese) {
      for (const fact of Object.values(PDF_NOTE_FACTS)) {
        expect(file.text, `${manualName(file)}: ${fact}`).toContain(fact);
      }
    }
  });

  it("英語の 1 冊は、日付だけを持つ（訳文は綴りが違う）", () => {
    // **英語は日本語の綴りを持たない**（`戻れません` は訳されている）。
    // **照合できるのは日付だけ**で、**判定と行き先は人が読む**
    // ——**範囲を数の隣に書く**（今日ずっと踏んでいる形）。
    const english = files.find((file) => manualName(file) === "quick.en.md");
    expect(english, "quick.en.md が無い").toBeDefined();
    expect(english?.text).toContain(PDF_NOTE_FACTS.date);
  });
});
