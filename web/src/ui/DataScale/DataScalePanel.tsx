import { useEffect, useState } from "react";
import {
  DATA_TYPE_TOKENS,
  type DataScaleCalc,
  type DataTypeToken,
  initDataScale,
} from "../../datascale";
import styles from "./DataScalePanel.module.css";

// u128 の 10 進最大 39 桁 + 1。これを超える入力はコアが Overflow /
// SyntaxError として教えるので、ここでは切り詰めるだけでよい。
const MAX_DIGITS = 40;

export function DataScalePanel() {
  const [calc, setCalc] = useState<DataScaleCalc | null>(null);
  const [failed, setFailed] = useState(false);
  const [count, setCount] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [dtype, setDtype] = useState<DataTypeToken>("float32");

  useEffect(() => {
    let cancelled = false;
    initDataScale().then(
      (loaded) => {
        if (!cancelled) setCalc(loaded);
      },
      () => {
        // WASM が読めなければ何も計算できない。読み込み中のまま
        // 固まらせず、起きたことを伝える(App と同じ流儀)。
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p role="alert" data-testid="datascale-load-error">
        計算エンジンを読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  }

  // 結果は保持しない。空欄は SyntaxError ではなく中立なので、両方埋まって
  // いるときだけ計算する(設計書 §6)。state に持つと、入力とずれた古い
  // 結果を表示しうる二重管理になる。
  const result =
    calc && count !== "" && dimensions !== ""
      ? calc.compute(count, dimensions, dtype)
      : null;

  return (
    <section className={styles.panel} aria-label="データスケール計算">
      <div className={styles.field}>
        <label htmlFor="datascale-count">件数</label>
        <input
          id="datascale-count"
          inputMode="numeric"
          autoComplete="off"
          maxLength={MAX_DIGITS}
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="datascale-dimensions">次元数</label>
        <input
          id="datascale-dimensions"
          inputMode="numeric"
          autoComplete="off"
          maxLength={MAX_DIGITS}
          value={dimensions}
          onChange={(event) => setDimensions(event.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="datascale-dtype">データ型</label>
        <select
          id="datascale-dtype"
          value={dtype}
          onChange={(event) => setDtype(event.target.value as DataTypeToken)}
        >
          {DATA_TYPE_TOKENS.map((token) => (
            <option key={token} value={token}>
              {token}
            </option>
          ))}
        </select>
      </div>
      {/* <output> の暗黙ロールは status なので role 属性は付けない
          (biome/a11y/noRedundantRoles)。getByRole("status") で引ける
          ことは Display.tsx の main と同じ仕組み。 */}
      <output className={styles.result}>
        {result?.error ? (
          <p data-error={result.error}>Math ERROR</p>
        ) : (
          <>
            {result?.bytesGrouped !== null &&
              result?.bytesGrouped !== undefined && (
                <p>{result.bytesGrouped} bytes</p>
              )}
            {result?.decimal !== null && result?.decimal !== undefined && (
              <p>{result.decimal}</p>
            )}
            {result?.binary !== null && result?.binary !== undefined && (
              <p>{result.binary}</p>
            )}
          </>
        )}
      </output>
    </section>
  );
}
