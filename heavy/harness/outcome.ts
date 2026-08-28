/**
 * **境界の結果の形を開く。ここだけが tag の形を知っている。**
 *
 * `crates/calcarc-wasm/src/outcome.rs` が 2026-08-28（T-3）に結果型を
 * `Outcome<T>` にした——`{"kind":"ok", …payload}` と
 * `{"kind":"error","code":X}`。**payload のフィールドは camelCase** である。
 *
 * **旧い形は `kind` を持たなかった**（payload が平らに並び、エラーは
 * `{"error":"Overflow"}`）。**ここで外すのは tag だけ**で、名前の変換は
 * 比較側が前から持っている。**期待値（committed な golden）は 1 バイトも
 * 動かさない**——新しい形へ寄せると、再現性検査と検出力の下限が全部動く。
 *
 * **`outcome.rs` が「tag の形を知っているのはこのファイルだけ」と書いているのと
 * 同じ考え方である。** 読む側でも、形を知る場所を 1 つに閉じる。
 *
 * ## なぜ素通しに戻さないか
 *
 * この欠陥は「**境界が変わったのにハーネスが気づかなかった**」ことそのもの
 * だった。E2E は緑で、`web` は追随済みで、**重量級だけが 5,500 件全滅**して
 * いた。翻訳を入れて終わりにすると、**次に形が変わった日も気づかない。**
 * だから**知らない形は黙って通さず、ここで落とす。**
 */

/**
 * 境界が返した 1 件から、**tag を外す**。
 *
 * **名前は変えない。** camelCase → snake_case の変換は比較側
 * （`tests/corpus/calls.ts` の `normalise`）が既に持っており、`months` → `n` の
 * ような例外表も向こうに在る。**ここで変換すると 2 か所が同じ仕事をし、
 * `tests/corpus/certificates.ts` のように camelCase のまま読む者が壊れる**
 * （2026-08-28、実際に壊して気づいた）。
 *
 * @param raw wasm が返した値（`{kind:"ok"|"error", …}`）
 * @returns payload をそのまま平らにしたもの。エラーは `{error: コード}`
 */
export function openOutcome(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(
      `heavy-harness: 境界が返した形が読めない（オブジェクトではない）: ${JSON.stringify(raw)}`,
    );
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (kind === undefined) {
    throw new Error(
      `heavy-harness: 境界の結果に kind が無い。契約が変わったのでは: ${JSON.stringify(raw)}`,
    );
  }
  if (kind === "error") {
    const code = record.code;
    if (typeof code !== "string") {
      throw new Error(
        `heavy-harness: kind=error なのに code が無い: ${JSON.stringify(raw)}`,
      );
    }
    return { error: code };
  }
  if (kind !== "ok") {
    throw new Error(
      `heavy-harness: 知らない kind ${JSON.stringify(kind)}。契約が変わったのでは`,
    );
  }
  const opened: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(record)) {
    if (name === "kind") {
      continue;
    }
    opened[name] = value;
  }
  return opened;
}
