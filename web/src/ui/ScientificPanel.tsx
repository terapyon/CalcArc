import { useCallback, useEffect, useRef, useState } from "react";
import { type Calc, initCalc, type KeyToken, type Step } from "../calc";
import { clearAll, type HistoryEntry, pushEntry, removeAt } from "../history";
import { Display } from "./Display/Display";
import { History } from "./History/History";
import { Keypad } from "./Keypad/Keypad";
import { SCIENTIFIC_SECTIONS } from "./Keypad/scientific";
import styles from "./ScientificPanel.module.css";
import { loadHistory, saveHistory } from "./useHistory";
import { useKeyboard } from "./useKeyboard";
import { loadSettings, updateSettings } from "./useSetting";

/** 答の文字列を数字キーへ写すときの単一桁トークン。添字が桁そのもの。 */
const DIGIT_TOKENS: readonly KeyToken[] = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
];

function digitToken(ch: string): KeyToken | null {
  return DIGIT_TOKENS[Number(ch)] ?? null;
}

/**
 * 履歴の答(表示文字列)を、呼び戻すためのキー列に写す。
 *
 * **答は表示文字列であって、打鍵の記録ではない。** 桁区切りのカンマ・
 * 小数点・先頭の符号・指数(`e`)のいずれも持ちうる(設計書 §5 ★)。
 * ここは 4 つの形——整数・小数・負・指数——だけを扱う。
 *
 * **写せない形は `null` を返す**——指数部に符号が付く等、先頭以外に `-` が
 * 現れる形は今回のスコープ外(Task 10 ブリーフ「見つけたら、それを回避する
 * 仕掛けを作らない」)。呼び出し側は「触らない」で応じる。
 */
function mapAnswerToKeys(answer: string): KeyToken[] | null {
  const stripped = answer.replace(/,/g, "");
  let negative = false;
  let body = stripped;
  if (body.startsWith("-")) {
    negative = true;
    body = body.slice(1);
  }
  // 先頭以外に符号が残っているのは、指数部が負である等、今回の対象外の形。
  if (body.includes("-")) return null;

  const eIndex = body.indexOf("e");
  const mantissa = eIndex === -1 ? body : body.slice(0, eIndex);
  const exponent = eIndex === -1 ? null : body.slice(eIndex + 1);
  if (!/^[0-9]+(\.[0-9]+)?$/.test(mantissa)) return null;
  if (exponent !== null && !/^[0-9]+$/.test(exponent)) return null;

  const keys: KeyToken[] = [];
  for (const ch of mantissa) {
    if (ch === ".") {
      keys.push("dot");
      continue;
    }
    const token = digitToken(ch);
    if (token === null) return null;
    keys.push(token);
  }
  // **符号はここで送る**——指数を開く前。`neg` は「いま入力中の欄」に
  // 効く(`crates/calcarc-core/tests/engine_table.rs:125`)ので、指数を
  // 開いたあとに送ると仮数ではなく指数の符号になってしまう。
  if (negative) keys.push("neg");
  if (exponent !== null) {
    keys.push("exp");
    for (const ch of exponent) {
      const token = digitToken(ch);
      if (token === null) return null;
      keys.push(token);
    }
  }
  return keys;
}

export function ScientificPanel() {
  const [calc, setCalc] = useState<Calc | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [failed, setFailed] = useState(false);
  const [showingHistory, setShowingHistory] = useState(false);
  // **初期値は localStorage から読む。** WASM の読み込みとは無関係
  // ——履歴は計算エンジンの状態を含まない(設計書 §3)。
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory());

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

  // **押されたキー列を貯める。** `eq` を押した瞬間の中身が 1 件の式になる
  // (Task 10 ブリーフ「組み立て方」1)。React の state ではなく ref に
  // 置くのは、打鍵のたびに再描画を起こす理由が無いからである——`step` の
  // 更新だけで画面は動く。
  const keysRef = useRef<KeyToken[]>([]);

  // **`eq` の直後、次の `step` が確定してから綴る。** `press` の
  // `setStep` 更新関数の中で綴る(=副作用を起こす)と、直下のコメントと
  // 同じ理由でここも正しい置き場所ではなくなる——ここに「まだ綴っていない
  // キー列」を一時的に置き、下の effect が `step` の確定を待って処理する。
  const pendingSpellRef = useRef<KeyToken[] | null>(null);

  // 依存を空にして同一性を固定する。ここが変わると useKeyboard が
  // リスナを貼り直し、その隙間の打鍵が落ちる。
  const press = useCallback((token: KeyToken) => {
    const ready = calcRef.current;
    keysRef.current.push(token);
    if (token === "eq") {
      // **`eq` を積んだあとの列をそのまま持たせ、ここで空にする。**
      // これが `=` の 2 度押しを止める——2 度目は積む前が空の列なので、
      // 綴りも `""` になり `pushEntry` が積まない(ブリーフ「組み立て方」2)。
      pendingSpellRef.current = keysRef.current;
      keysRef.current = [];
    } else if (token === "ac") {
      // **`ac` は履歴を消さない**(設計書 §6)。消えるのは貯めている
      // キー列だけ——次の計算を「打った通り」に綴るためである。
      keysRef.current = [];
    }
    // 状態は不変値なので、直前の状態から次を作るだけでよい。
    setStep((previous) =>
      ready && previous ? ready.dispatch(previous.state, token) : previous,
    );
  }, []);

  // **1 件を積む。** `step` が確定してから(=`eq` の結果の表示が出てから)
  // 綴る・記録するので、`press` の中では副作用を起こさない。
  useEffect(() => {
    if (!step) return;
    const pendingKeys = pendingSpellRef.current;
    if (pendingKeys === null) return;
    pendingSpellRef.current = null;
    const ready = calcRef.current;
    if (!ready) return;
    // **綴るのは設定に関わらず毎回**——「呼ばれていないから記録しなかった」
    // と「呼ばれた結果を記録しなかった」を区別できる形にする
    // (Task 10 ブリーフ ★ Step 0)。判断は綴った後に効く。
    const expression = ready.spell(pendingKeys);
    // **`enabled` が false なら記録しない。消さない**(設計書 §7)——
    // ここで止まるのは「これから」記録する分だけで、既に貯まった `entries`
    // には触らない。
    if (!loadSettings().history.enabled) return;
    const entry: HistoryEntry = {
      expression,
      answer: step.display.main,
      angle: step.display.angle,
      error: step.display.error !== null,
    };
    setEntries((previous) => {
      const updated = pushEntry(previous, entry);
      saveHistory(updated);
      return updated;
    });
  }, [step]);

  // **呼び戻し。** 答の文字列をキー列に写し、`ac` のあとその列を送る——
  // つまり `press` をそのまま再利用する。**これは意図的である**:
  // 呼び戻しが本当に「手で打ったのと同じ」になるかどうか(設計書 §5 ★、
  // §13-8)は、実装をここで分けないことで測れる——`press` を経由する限り、
  // 呼び戻しも手打ちも同じ `dispatch` の列になる。
  //
  // **写せない形は触らない。** 指数部に符号がある等、今回のスコープ外の
  // 形は `mapAnswerToKeys` が `null` を返す——回避する仕掛けは作らず、
  // 何もしない(ブリーフ)。
  const recall = useCallback(
    (entry: HistoryEntry) => {
      const keys = mapAnswerToKeys(entry.answer);
      if (keys === null) return;
      press("ac");
      for (const key of keys) press(key);
      setShowingHistory(false);
    },
    [press],
  );

  const removeEntry = useCallback((index: number) => {
    setEntries((previous) => {
      const updated = removeAt(previous, index);
      saveHistory(updated);
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    const cleared = clearAll();
    setEntries(cleared);
    saveHistory(cleared);
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
      {showingHistory ? (
        // **盤面が丸ごと隠れる**(設計書 §9)。`Display` も含めて置き換える
        // ——`History.module.css` が Readout と同じ表示色を器の地色に
        // 使っているのは、この画面が単独で「表示面の続き」に見えるためで、
        // `Display` の下に重ねる部品ではない。
        <History
          entries={entries}
          onBack={() => setShowingHistory(false)}
          onRecall={recall}
          onRemove={removeEntry}
          onClearAll={clearHistory}
        />
      ) : (
        <>
          <Display display={step.display} />
          <Keypad
            sections={SCIENTIFIC_SECTIONS}
            onPress={press}
            onAction={(action) => {
              if (action === "history") setShowingHistory(true);
            }}
          />
        </>
      )}
    </div>
  );
}
