import { useCallback, useEffect, useRef, useState } from "react";
import { type Calc, initCalc, type KeyToken, type Step } from "../calc";
import { Display } from "./Display/Display";
import { Keypad } from "./Keypad/Keypad";
import { SCIENTIFIC_SECTIONS } from "./Keypad/scientific";
import styles from "./ScientificPanel.module.css";
import { useKeyboard } from "./useKeyboard";
import { loadSettings, updateSettings } from "./useSetting";

export function ScientificPanel() {
  const [calc, setCalc] = useState<Calc | null>(null);
  const [step, setStep] = useState<Step | null>(null);
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
        // **設定を復元する。** EngineState には触らない——角度と極形式は
        // どちらも自分の欄だけを入れ替えるトグルなので、初期状態に
        // キーを送れば届く(P-1 設計書 §4)。復元後の状態は定義上
        // 「利用者が押して到達できる状態」になる。
        //
        // **記法(ENG)はここに無い**(【変更 2026-08-25、0.4.0】)。
        // ENG はモードではなくなり、**ENG 以外のどのキーでも通常表記に
        // 戻る**——`eng` を送って復元しても、利用者の次の 1 打鍵で消える。
        const wanted = loadSettings().scientific;
        let restored = loaded.initial();
        if (restored.display.angle !== wanted.angle) {
          restored = loaded.dispatch(restored.state, "angle_toggle");
        }
        if (restored.display.form !== wanted.form) {
          restored = loaded.dispatch(restored.state, "polar_toggle");
        }
        setStep(restored);
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

  // **書き戻しは effect に置く。** setStep の更新関数の中に副作用を書くと、
  // StrictMode(main.tsx で有効)が更新関数を 2 度呼ぶので書き込みも 2 度
  // 走る。値が同じなので実害は出ないが、副作用の置き場所として正しくない
  // ——React は更新関数を純粋なものとして扱う。
  //
  // ref に直前の署名を持ち、**変わったときだけ書く**。打鍵のたびに書くと、
  // 保存しないと決めた入力の変化にも反応することになる。
  const savedScientific = useRef<string | null>(null);
  useEffect(() => {
    if (!step) return;
    const { angle, form, notation } = step.display;
    const signature = `${angle}/${form}/${notation}`;
    // **復元直後の 1 回目は書かない。** 読んだ物をそのまま書き戻すことに
    // なり、一度も設定を触っていない利用者にも保存キーが生まれる。
    if (savedScientific.current === null) {
      savedScientific.current = signature;
      return;
    }
    if (savedScientific.current === signature) return;
    savedScientific.current = signature;
    updateSettings((current) => ({
      ...current,
      scientific: { angle, form, notation },
    }));
  }, [step]);

  useKeyboard(press);

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
    <div className={styles.shell}>
      <Display display={step.display} />
      <Keypad sections={SCIENTIFIC_SECTIONS} onPress={press} />
    </div>
  );
}
