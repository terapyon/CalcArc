import { useCallback, useEffect, useRef, useState } from "react";
import { type Calc, initCalc, type KeyToken, type Step } from "../calc";
import { Display } from "./Display/Display";
import { Keypad } from "./Keypad/Keypad";
import styles from "./ScientificPanel.module.css";
import { useKeyboard } from "./useKeyboard";

export function ScientificPanel() {
  const [calc, setCalc] = useState<Calc | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // press が calc の state を読むと、読み込み完了で press が作り直され、
  // useKeyboard がリスナを貼り直すことになる。貼り直しは描画の後に走るので、
  // "0" が表示されてから新しいリスナが付くまでの打鍵が失われる。
  // ref なら読み込みと同時に、つまり再描画より前に埋まる。
  const calcRef = useRef<Calc | null>(null);

  useEffect(() => {
    let cancelled = false;
    initCalc().then(
      (loaded) => {
        if (cancelled) return;
        calcRef.current = loaded;
        setCalc(loaded);
        setStep(loaded.initial());
        setVersion(loaded.version());
      },
      () => {
        // WASM が読めなければ電卓は何もできない。読み込み中の表示のまま
        // 固まらせず、起きたことを伝える。
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // 依存を空にして同一性を固定する。ここが変わると useKeyboard が
  // リスナを貼り直し、その隙間の打鍵が落ちる。
  const press = useCallback((token: KeyToken) => {
    const ready = calcRef.current;
    // 状態は不変値なので、直前の状態から次を作るだけでよい。
    setStep((previous) =>
      ready && previous ? ready.dispatch(previous.state, token) : previous,
    );
  }, []);

  useKeyboard(press);

  if (failed) {
    return (
      <p role="alert" data-testid="load-error">
        計算エンジンを読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  }

  if (!calc || !step || version === null) {
    return <p>Loading…</p>;
  }

  return (
    <main className={styles.shell}>
      <Display display={step.display} />
      <Keypad onPress={press} />
      <p className={styles.version} data-testid="core-version">
        calcarc-core {version}
      </p>
    </main>
  );
}
