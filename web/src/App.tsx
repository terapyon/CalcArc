import { useCallback, useEffect, useState } from "react";
import styles from "./App.module.css";
import { type Calc, initCalc, type KeyToken, type Step } from "./calc";
import { Display } from "./ui/Display/Display";
import { Keypad } from "./ui/Keypad/Keypad";

export function App() {
  const [calc, setCalc] = useState<Calc | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initCalc().then(
      (loaded) => {
        if (cancelled) return;
        setCalc(loaded);
        setStep(loaded.initial());
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

  const press = useCallback(
    (token: KeyToken) => {
      // 状態は不変値なので、直前の状態から次を作るだけでよい。
      setStep((previous) =>
        calc && previous ? calc.dispatch(previous.state, token) : previous,
      );
    },
    [calc],
  );

  if (failed) {
    return (
      <p role="alert" data-testid="load-error">
        計算エンジンを読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  }

  if (!calc || !step) {
    return <p>Loading…</p>;
  }

  return (
    <main className={styles.shell}>
      <Display display={step.display} />
      <Keypad onPress={press} />
      <p className={styles.version} data-testid="core-version">
        calcarc-core {calc.version()}
      </p>
    </main>
  );
}
