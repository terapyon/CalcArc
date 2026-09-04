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
 * **前回の答を左辺として引き継ぐキー。この列の中で最初に見つかる非無音キーが
 * これなら、その計算は前回の答の続き**(連鎖)である——値のキーで始まれば
 * 新しい計算(設計書 §0 の「診断」のためには、`× 2 → 6+8j` のような自分
 * だけでは説明できない行を作らない)。判定は綴った文字列を見ずに、**キー
 * そのもの**で行う(Fix round 3 finding 11)。
 *
 * # engine から導く。手で並べない(H-4)
 *
 * 以前ここは「二項演算子」だけを手で並べた集合で、**後置関数と符号キーが
 * 漏れていた**——`3 + 1 = √ =` は式「√」・答「2」、`3 + 4 = +/− =` は
 * 式「+/−」・答「-7」として記録されていた。どちらも式が自分の答を作れない。
 * **手で並べたことが漏れの原因**なので、集合は engine の分岐から機械的に
 * 導く。導き直し方:
 *
 * ```
 * git grep -n 'state\.current' crates/calcarc-core/src/engine/mod.rs
 * ```
 *
 * 引き継ぐ値は `EngineState::current` である。出てきた行を**読む**(引き継ぐ)
 * と**上書きする**(新しく始める)に分ける。2026-09-04 現在:
 *
 * **読む(この集合に入る):**
 * - `:173` `push_binop` の `state.operands.push(state.current)`
 *   → `add` `sub` `mul` `div` `pow` `n_p_r` `n_c_r`
 * - `:195` `finish` の `state.operands.push(state.current)` → `eq`
 * - `:245` `close_paren` の `state.operands.push(state.current)` → `rparen`
 * - `:269` `apply_unary` の `state.current = f(state.current)?`
 *   → `n_fact` `sqrt` `sqr` `neg` `sin` `cos` `tan` `ln` `log10` `exp_e`
 *     `recip` `asin` `acos` `atan`(`apply()` で `apply_unary` を呼ぶ腕の全部)
 *
 * **上書きする(入らない):**
 * - `:238` `open_paren` の `state.current = Value::ZERO` → `lparen`
 * - `:371` `:376` `state.current = Value::real(...)` → `pi` `e`
 * - `:135` `commit_entry` が `buffer.value()?` で置き換える
 *   → `Buffer` に入るキー(数字・`dot`・`zeros3`・`exp`・`j`・`dms`)
 * - `:188` `:206` `:257` は上の腕が読んだ**あと**に自分で置き直す行なので、
 *   新しいキーは足さない。
 *
 * **`current` に触れないキー:** `del`(`delete_one`)・`ac`・`angle_toggle`・
 * `polar_toggle`・`eng`。前 4 つのうち `del` と 3 つのトグルは
 * `SILENT_CONTINUATION_KEYS` が先に読み飛ばす。
 *
 * **註 1: `neg`。** `apply()` の `Key::Neg` は、指数入力中なら `Buffer` 側
 * (`toggle_exponent_sign`)へ行き `apply_unary` を呼ばない。しかし**この判定
 * に掛かる `neg` は列の先頭**であり、直前が `=` である以上 `Buffer` は無い
 * ので、必ず `apply_unary` に落ちる。
 *
 * **註 2: `eq` と `rparen` は集合に居るが、記録される行にはならない。**
 * 先頭が `eq` の列(=`=` の 2 度押し)は `spell` が `""` を返し
 * (`spell.rs` の `Key::Eq` は綴りに何も足さない)、`pushEntry` が式の空な行を
 * 捨てる。**ただし左辺を足してからでは遅い**——`"2 "` は空ではない。だから
 * 下の組み立てには「綴りが空なら左辺も付けない」条件が要る(そこのコメント)。
 * 先頭が `rparen` の列は、
 * 直前の `=`(`finish`)が演算子スタックを空にしているので `close_paren` が
 * `SyntaxError` になり、エラー中の `=` は積まれない(`press` の門番、H-3)。
 * **それでも手で外さない**——外した瞬間この集合は「engine から導いた物」から
 * 「手で選んだ物」に戻る。H-4 はその手選びが生んだ欠陥である。
 *
 * **番人。** TypeScript から engine は呼べない(jsdom に WASM は無い)ので、
 * この集合が上の列挙と一致していることを機械で見張るものは置けない。代わりに
 * 置いたのは `web/tests/e2e/history.spec.ts` の
 * 「a chain continued by a postfix function or the sign key…」——実 WASM に
 * 対して `√` と `+/−` を通す 1 本である。**14 の後置関数は `apply_unary` の
 * 同じ 1 行を共有する**ので、その行の性質が変われば、この 2 つの見本が赤くなる。
 */
const CARRIED_VALUE_TOKENS: ReadonlySet<KeyToken> = new Set([
  // mod.rs:173 push_binop
  "add",
  "sub",
  "mul",
  "div",
  "pow",
  "n_p_r",
  "n_c_r",
  // mod.rs:195 finish
  "eq",
  // mod.rs:245 close_paren
  "rparen",
  // mod.rs:269 apply_unary
  "n_fact",
  "sqrt",
  "sqr",
  "neg",
  "sin",
  "cos",
  "tan",
  "ln",
  "log10",
  "exp_e",
  "recip",
  "asin",
  "acos",
  "atan",
]);

/**
 * **連鎖の判定で読み飛ばすキー。** `spell()` の「七つの無音キー」から
 * `eq`・`ac` を除いたもの——この 2 つは `press` の設計上、この列の先頭に
 * 来ることが無い(`eq` は必ず列を終えて `pendingSpellRef` に渡り、`ac` は
 * 積んだ直後に列を空にする)。
 *
 * **Fix round 4 finding B。** 答を ENG や極形式で確認してから続きを打つ
 * のは、ごく普通の操作である——極形式は設計書自身が動機として挙げている
 * 例そのもの。`del`(押しても何も消えない——直前の `=` の直後は buffer が
 * 無いので、`delete_one` は何もしない)も同様に、続きの判定を壊してはい
 * けない。**「列の先頭キー」だけを見ていた版は、これらのキーが 1 つでも
 * 挟まると連鎖を見失い、`3 = ENG × 2 =` や `3 = ▸∠ × 2 =` を「新しい計算」
 * として `× 2` のまま記録していた。**
 */
const SILENT_CONTINUATION_KEYS: ReadonlySet<KeyToken> = new Set([
  "del",
  "angle_toggle",
  "eng",
  "polar_toggle",
  "dms",
]);

/**
 * 履歴の答(表示文字列)を、呼び戻すためのキー列に写す。
 *
 * **答は表示文字列であって、打鍵の記録ではない。** 桁区切りのカンマ・
 * 小数点・仮数部と指数部それぞれの符号・指数(`e`)のいずれも持ちうる
 * (設計書 §5 ★)。**仮数の符号と指数の符号は独立に付き、送る位置が違う**
 * ——`crates/calcarc-core/tests/engine_table.rs:125`
 * (`the_sign_key_follows_the_exponent_while_one_is_open`、設計書コメント
 * 「指数入力中は指数の符号、それ以外は確定値の符号」)の通り、`neg` は
 * 「指数入力中かどうか」で宛先が変わる。**仮数の符号は `exp` を送る前に、
 * 指数の符号は指数の桁を送った後に**送る(`exp` を送った時点で「指数
 * 入力中」に入るため)。
 *
 * **これは「4 形のうちの負」を仮数だけの話に限らない。**
 * `crates/calcarc-core/src/numeric/format.rs` の `EXP_LOW_EXPONENT = -9`
 * により、絶対値が 1e-9 未満の答は指数が負のまま普通に出る(大きい数で
 * 割るだけで届く)——一覧の見た目は成功した行と同じ `<button>` なので、
 * ここを写せないままにすると押しても静かに何も起きない行ができる
 * (Fix round 1 finding 1)。
 *
 * **それでも写せない形は `null` を返す**——虚数(`j`)・極形式(`∠`)・
 * 60 進(`°′″`)のように、そもそも数字キーの列で表せない綴りがそれに
 * 当たる。呼び出し側(`recall`)はこれを「触らない」で応じる。
 *
 * **`maxEntryLen` を超える仮数も `null` を返す**(Fix round 3 finding)。
 * `crates/calcarc-core/src/engine/state.rs` の `MAX_ENTRY_LEN` は
 * 入力欄の桁数に上限を掛けており、それを超える桁は engine 側で黙って
 * 捨てられる——`0.03333333333`(13 文字)を打ち直すと `0.0333333333`
 * (12 文字)という**別の数**が入力欄に残ってしまう。上限は
 * `calc.maxEntryLen()` 経由で境界の向こうから受け取る(TypeScript に
 * 数をハードコードしない)。
 *
 * **記録する側(下の `useEffect`)は、この関数の結果を `History` の
 * `canRecall` prop へそのまま渡す。** `error: true` は積まない
 * ——「計算が失敗した」(`step.display.error !== null`、`history/
 * types.ts` の本来の意味のまま)と「この答は入力へ戻せない」は別の事実
 * であり、同じ欄に混ぜると、成功した計算(例: `3+4j`)がエラーの色
 * (`--error-fg`)で表示される嘘になる(Fix round 2 finding。以前の
 * Fix round 1 はこの 2 つを混ぜており、それ自体が指摘された)。
 * `History`(`web/src/ui/History/`)は押せるかどうかを `canRecall` から、
 * 色を `entry.error` から、独立に決める。
 */
function mapAnswerToKeys(
  answer: string,
  maxEntryLen: number,
): KeyToken[] | null {
  const stripped = answer.replace(/,/g, "");
  let body = stripped;
  let mantissaNegative = false;
  if (body.startsWith("-")) {
    mantissaNegative = true;
    body = body.slice(1);
  }

  const eIndex = body.indexOf("e");
  const mantissa = eIndex === -1 ? body : body.slice(0, eIndex);
  let exponent = eIndex === -1 ? null : body.slice(eIndex + 1);
  let exponentNegative = false;
  if (exponent?.startsWith("-")) {
    exponentNegative = true;
    exponent = exponent.slice(1);
  }

  // 仮数・指数それぞれの符号を取り除いたあとにまだ `-` が残っているのは、
  // 二重符号など今回の対象外の形。
  if (mantissa.includes("-")) return null;
  if (exponent?.includes("-")) return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(mantissa)) return null;
  if (exponent !== null && !/^[0-9]+$/.test(exponent)) return null;
  // **仮数の桁(小数点を含む)が engine の上限を超えるなら送らない。**
  // `MAX_ENTRY_LEN` は `state.digits`(小数点も 1 文字に数える)の長さに
  // 掛かる上限で、上限を超えて送っても engine 側が黙って切り詰めるので、
  // 送った桁と違う数が入力欄に残る(Fix round 3 finding)。
  if (mantissa.length > maxEntryLen) return null;

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
  // **仮数の符号は指数を開く前に送る。** `exp` のあとは「指数入力中」に
  // 移り、`neg` の宛先が指数へ変わる。
  if (mantissaNegative) keys.push("neg");
  if (exponent !== null) {
    keys.push("exp");
    for (const ch of exponent) {
      const token = digitToken(ch);
      if (token === null) return null;
      keys.push(token);
    }
    // **指数の符号は指数の桁を送った後。** `engine_table.rs` の同テストは
    // `exp, neg, 桁` の順でも同じ値になることを確かめているが、ここでは
    // 桁の後に統一する(どちらでも良いので実装を単純な方に倒した)。
    if (exponentNegative) keys.push("neg");
  }
  return keys;
}

export function ScientificPanel() {
  const [calc, setCalc] = useState<Calc | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [failed, setFailed] = useState(false);
  const [showingHistory, setShowingHistory] = useState(false);
  // **`Settings.history.enabled` を書く唯一の場所(Task 14)。** 読む側
  // (`recordHistory` の effect、下)は毎回 `loadSettings()` を直接読むので、
  // この state は画面表示専用——`History` にいまの値を渡し、チェックボックス
  // が現在の設定を映す。既定は入(設計書 §7 / `defaultSettings()`)。
  const [recordingEnabled, setRecordingEnabledState] = useState(
    () => loadSettings().history.enabled,
  );
  // **初期値は localStorage から読む。** WASM の読み込みとは無関係
  // ——履歴は計算エンジンの状態を含まない(設計書 §3)。
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory());
  // **`saveHistory` を呼ぶ 3 箇所(積む・消す・全消し)が最新の一覧を
  // 読むための ref。** `setEntries` の更新関数の中で `previous` から
  // 次を作り、その中で `saveHistory`(副作用)を呼んでいた版があった
  // (Fix round 3 finding)——StrictMode は更新関数を 2 度呼ぶので、
  // その中に置いた副作用も 2 度走る。下の 60 行ほど先のコメント(設定の
  // 書き戻し)と同じ理由で、副作用は effect かイベントハンドラの本体に
  // 置き、更新関数は純粋なままにする。`clearHistory` は元々そうなって
  // いた——他の 2 箇所をそれに合わせる。
  const entriesRef = useRef<HistoryEntry[]>(entries);

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

  // **連鎖(chained `=`)の左辺として使う、直前の `=` の答。**(Fix round 3
  // finding 11)`3 + j4 = × 2 =` は engine の `current` を積み増して
  // `6+8j` を計算する(`crates/calcarc-core/tests/engine_table.rs` の
  // `multiplies_a_complex_number_by_a_real`)が、2 度目の `=` の綴りは
  // 「× 2」だけ——自分だけでは何も説明しない行になる(設計書 §0 が守り
  // たいものそのもの)。
  //
  // **一覧の先頭行から借りない。** 借りると、その行が消されたとき
  // (`removeEntry`)や全消しのあと(`clearHistory`)、記録が切られている
  // とき(そもそも積まれていない)に engine 側とずれる——engine は
  // 借りる先が無くなっても値を持ち続けているのに、一覧からは読めなく
  // なる。**engine 側(=このコンポーネントが最後の `=` で見た答)を
  // 直接持つ。** 記録の on/off に関わらず更新する(下の effect)——
  // 連鎖の継ぎ目は engine の値であって、記録するかどうかとは無関係。
  //
  // **`ac` で空にする**(`press` の `ac` 分岐)。`AC` は次の計算を
  // 始める操作であり、そのあとに来る二項演算子は前回の続きではない
  // ——空にしないと、`AC` のあと `× 2 =`(0 に 2 を掛けるだけの、
  // 前回とは無関係な計算)が古い答を左辺として誤って記録する。
  const carriedAnswerRef = useRef<string | null>(null);

  // **いま表示がエラー状態か。**(H-3)`crates/calcarc-core/src/engine/
  // mod.rs:29` の「エラー中は AC 以外を受け付けない。」——engine は `AC`
  // 以外のキーを**一切状態に反映せずに捨てる**。`press` はそれを知らずに
  // `keysRef` へ積み続けていたので、**engine が一度も見ていない打鍵が
  // そのまま式になっていた**: `1 ÷ 0 =` のあと `7 + 8 =` と打つと、
  // 式「7 + 8」・答「Math ERROR」という、**自分の答を作れない行**が
  // 残っていた(設計書 §0 が守りたいものそのもの)。
  //
  // **`step` ではなく ref で持つ理由は `calcRef` と同じ**——`press` の
  // 依存を空にしたまま最新の値を読むためである。**書き込みは effect**
  // (下)で、React は次の離散イベント(クリック・keydown)を処理する前に
  // 保留中の passive effect を流すので、次の打鍵はこの値を見る。
  const errorRef = useRef(false);
  useEffect(() => {
    errorRef.current = step !== null && step.display.error !== null;
  }, [step]);

  // 依存を空にして同一性を固定する。ここが変わると useKeyboard が
  // リスナを貼り直し、その隙間の打鍵が落ちる。
  const press = useCallback((token: KeyToken) => {
    const ready = calcRef.current;
    // **`ready` が無いあいだは列に積まない**(Fix round 3 finding)。
    // `useKeyboard(press)` は WASM の読み込み中(`Loading…` 表示中)にも
    // グローバルなキーリスナを貼る。ここを `ready` で守らずに積んでいた
    // 版では、読み込み前に打ったキーが `keysRef`/`pendingSpellRef` に
    // 残ったまま `dispatch` されずに捨てられ、次に積む列の頭に紛れ込む
    // ——engine が一度も見ていないキーが式に混ざる余地ができていた。
    // **エラー中は `AC` 以外を積まない**(H-3)。engine の分岐
    // (`reduce` の `key == Key::Ac` / `next.error.is_some()`)をそのまま
    // 写したもので、**「engine が状態に反映したキーだけが式になる」**と
    // いう不変条件を、この 1 行が保つ。
    //
    // **エラーを起こしたキー自身は積む。** ここで見ているのは打鍵**前**の
    // 状態だからで、これは意図である——`1 ÷ 0 =` は式「1 ÷ 0」・答
    // 「Math ERROR」として記録されるべき 1 件であり、その式は自分の答を
    // ちゃんと説明している(`error: true` の行はそのために在る)。
    //
    // **エラーの時点で積まれていた列はそのまま残す。** 中断された入力
    // (`1 . 5 .` の `1` `.` `5`)を捨てるかどうかは**外から見分けられない**
    // ——エラーから抜ける道は `AC` だけであり(engine/mod.rs:29)、その
    // `AC` がここで列を空にするからである。見分けられない以上、**規則を
    // 1 つ増やさない**ほうを選んだ。番人は
    // `ScientificPanel.test.tsx` の
    // 「leaves no fragment of the entry that the error interrupted」——
    // 残した列が次の式に漏れないこと(=外から見える約束)を見張る。
    if (ready && !(errorRef.current && token !== "ac")) {
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
        // **`pendingSpellRef` も一緒に捨てる**(Fix round 3 finding)。
        // ここを空にしないと、`eq` の直後・下の effect が `step` の
        // 確定を待っているあいだに `ac` を押した場合、まだ消費されて
        // いない古い保留列が残ったままになり、その後の無関係な `step`
        // 変化(次の計算の完了)にこの古い列が消費されて、`ac` で捨てた
        // はずの計算が履歴に積まれてしまう。
        pendingSpellRef.current = null;
        // **連鎖の左辺も一緒に捨てる**(Fix round 3 finding 11)。`AC` の
        // あとに来る二項演算子は前回の続きではない。
        carriedAnswerRef.current = null;
      }
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
    const spelled = ready.spell(pendingKeys);
    // **連鎖なら直前の答を左辺として前に足す**(Fix round 3 finding 11)。
    // 「無音キーを読み飛ばした先頭が、前回の答を引き継ぐキーか」で決める——綴った文字列
    // を見て推測しない(`spelled` の頭が `×` のような記号になっているかを
    // 見るのではなく、キーそのものを見る)。**無音キーを読み飛ばすのが
    // 重要**(Fix round 4 finding B)——答を ENG や極形式・角度モードで
    // 確認してから続きを打つのは普通の操作で、`del`(直前の `=` の直後は
    // 何も消さない)もこの判定を壊してはいけない。先頭キーだけを見ると
    // `3 = ENG × 2 =` のような列で連鎖を見失う。
    const first = pendingKeys.find((key) => !SILENT_CONTINUATION_KEYS.has(key));
    const isContinuation =
      first !== undefined && CARRIED_VALUE_TOKENS.has(first);
    const carried = carriedAnswerRef.current;
    // **綴りが空なら左辺も付けない。** `=` の 2 度押しは空の列を綴るので
    // `spelled` が `""` になり、`pushEntry` がその行を捨てる——という約束
    // (`web/src/history/index.ts`)に乗っている。ここで `${carried} ` を
    // 前に足すと式が `"2 "`(末尾の空白 1 つ)になって空でなくなり、
    // **2 度押しが行を作ってしまう**。`eq` は前回の答を読むキーなので
    // `CARRIED_VALUE_TOKENS` に居り(`finish`、mod.rs:195)、この 1 条件が
    // 無いと集合を engine から導いた途端にその行が生まれる。
    const expression =
      isContinuation && carried !== null && spelled !== ""
        ? `${carried} ${spelled}`
        : spelled;
    // **次の連鎖のために、いま確定した答を持っておく。** 記録の on/off に
    // 関わらず更新する——連鎖の継ぎ目は engine 側の値であって、記録するか
    // どうかとは無関係(このあとの `enabled` チェックより前に置く理由)。
    //
    // **エラーで終わった答は左辺にしない**(H-3)。`"Math ERROR"` は数では
    // ないので、`Math ERROR × 2` のような行を作ってしまう。エラーは連鎖を
    // 終わらせる——`AC` と同じ扱いで空にする。
    //
    // **これに番人は置けない。** 上の `press` の門番があるかぎり、エラーの
    // あとに来る二項演算子は engine にも `keysRef` にも届かず、`AC`(唯一の
    // 出口)は `carriedAnswerRef` を自分で空にするので、**この行の有無は
    // 外から観測できない**。代わりに守っているのは `press` の門番のほうで、
    // その番人は上の 2 つの検査(「does not record keys the engine threw
    // away…」「records nothing at all when the error was raised…」)である。
    // ここはその門番が将来狭められた日のための二重化として置く。
    carriedAnswerRef.current =
      step.display.error === null ? step.display.main : null;
    // **`enabled` が false なら記録しない。消さない**(設計書 §7)——
    // ここで止まるのは「これから」記録する分だけで、既に貯まった `entries`
    // には触らない。
    if (!loadSettings().history.enabled) return;
    // **`error` は `history/types.ts` が言う意味のまま**——計算が
    // `CalcErrorCode` で終わったかどうかだけ。「この答は入力へ戻せる
    // か」は別の欄では持たず、`History` へ `canRecall` として渡す
    // (下の `<History>`。Fix round 2)。
    const entry: HistoryEntry = {
      expression,
      answer: step.display.main,
      angle: step.display.angle,
      error: step.display.error !== null,
    };
    const updated = pushEntry(entriesRef.current, entry);
    entriesRef.current = updated;
    setEntries(updated);
    saveHistory(updated);
  }, [step]);

  // **呼び戻し。** 答の文字列をキー列に写し、`ac` のあとその列を送る——
  // つまり `press` をそのまま再利用する。**これは意図的である**:
  // 実装をここで分けないことで、呼び戻しは(この `press` の列を送る限り)
  // 手打ちと同じ `dispatch` の列になる。**これは「同じ経路を通る」という
  // コードの性質であって、実機の計算コアで両者が同じ状態に落ち着くことを
  // 確かめたわけではない**(設計書 §5 ★、§13-8。狭めたが閉じていない
  // ——`docs/superpowers/sdd/history-HANDOFF.md` 参照)。
  //
  // **写せない形は触らない。** 虚数・極形式・60 進のように、そもそも
  // 数字キーの列で表せない形は `mapAnswerToKeys` が `null` を返す——
  // 回避する仕掛けは作らず、何もしない(ブリーフ)。**通常はここへ
  // 来ない**——`<History>` の `canRecall` に同じ関数を渡してあるので、
  // そうした答は `History` 側でボタンにならない(Fix round 2)。ここが
  // `null` を受け取るとしたら、それより前の版で貯まった古い履歴
  // (`localStorage` に残っている旧データ)が読み込まれた場合などの備え。
  const recall = useCallback(
    (entry: HistoryEntry) => {
      // calcRef を読むのは、`recall` の依存を `[press]` に固定したまま
      // 上限を最新の値で読むため——`calc` state をここで直接読むと、
      // このクロージャが最初に作られた描画(WASM 未読込で `calc` が
      // `null` だった描画)の値に固定されてしまう。
      const ready = calcRef.current;
      if (!ready) return;
      const keys = mapAnswerToKeys(entry.answer, ready.maxEntryLen());
      if (keys === null) return;
      press("ac");
      for (const key of keys) press(key);
      setShowingHistory(false);
    },
    [press],
  );

  const removeEntry = useCallback((index: number) => {
    const updated = removeAt(entriesRef.current, index);
    entriesRef.current = updated;
    setEntries(updated);
    saveHistory(updated);
  }, []);

  const clearHistory = useCallback(() => {
    const cleared = clearAll();
    entriesRef.current = cleared;
    setEntries(cleared);
    saveHistory(cleared);
  }, []);

  // **切る/入れる。消すとは別の操作**(設計書 §7)——`entries` には
  // 一切触らない。書き込みは `updateSettings` 経由(P-1 設計書 §6 の
  // 通り、`web/src/ui/storage.ts` だけが Storage を掴む形を保つ)。
  //
  // **ミラーは書こうとした値ではなく、書いた後に実際に読める値から作る**
  // (Fix round finding)。`browserStorage()` は、Storage への参照そのもの
  // が投げるとき(Safari のプライベートモード等)`null` を
  // 返し、`saveSettings` は静かに何もしない——ここで `enabled` を
  // そのまま state に入れると、記録は続いているのにチェックボックスだけ
  // 「切れた」と嘘をつく。書いた直後に `loadSettings()` を読み直せば、
  // 書けなかった場合は既定(`enabled: true`)へ跳ね返る。
  const setRecordingEnabled = useCallback((enabled: boolean) => {
    updateSettings((current) => ({
      ...current,
      history: { ...current.history, enabled },
    }));
    setRecordingEnabledState(loadSettings().history.enabled);
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
          // **押せるかどうかは綴りを知っている側(ここ)が決める**
          // (Fix round 2)。`entry.error` とは独立——エラーで終わった
          // 計算(`Math ERROR`)は `mapAnswerToKeys` がどのみち `null` を
          // 返すのでここでも押せなくなるが、それは結果が一致しているだけで、
          // `History` 側は 2 つの理由を区別しない(区別するのは色だけ)。
          canRecall={(entry) =>
            mapAnswerToKeys(entry.answer, calc.maxEntryLen()) !== null
          }
          recordingEnabled={recordingEnabled}
          onRecordingEnabledChange={setRecordingEnabled}
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
