/**
 * 接頭辞つきの盤面トークンから、**確かめてから** union を取り出す。
 *
 * 盤面のトークンは `field:months` `precision:fp16` のように
 * `接頭辞:値` の形をしている。パネルはこれまで接尾辞を切って
 * `as LlmField` と**言い切って**いた——**`as` は検査ではなく宣言**なので、
 * 盤面の綴りとパネルの union がずれても型は通り、**存在しない項目が
 * active に入る**。2026-08-28 の点検で 13 か所在った。
 *
 * ここが唯一のキャスト地点で、**一覧に載っていることを実行時に確かめてから**
 * 通す。載っていなければ `null` を返す。
 *
 * ## `null` が返ったとき、呼び出し側は何もしない
 *
 * **利用者の操作では起こらない。** 起こるのは**盤面の綴りとパネルの一覧が
 * ずれたとき**だけで、それは実装の食い違いであって画面の状態ではない。
 * だから利用者に見せるエラーにはしない。
 *
 * **黙って no-op にすると、ずれが静かに沈む**——それは
 * `KEY_TOKENS` と `Key::ALL` について既に踏んだ形である(`token_parity.rs`
 * が在るのはそのため)。同じ手を打つ: **盤面が出しうるトークンが 1 つ残らず
 * 解けること**を `parse.test.ts` が実際の盤面定義に対して確かめる。
 * **ずれは実行時ではなく検査で捕まえる。**
 */
export function parsePrefixed<T extends string>(
  token: string,
  prefix: string,
  allowed: readonly T[],
): T | null {
  if (!token.startsWith(prefix)) {
    return null;
  }
  const value = token.slice(prefix.length);
  // **ここが唯一のキャストで、直前の `includes` が根拠である。**
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
