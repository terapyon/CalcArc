# 独立検証の穴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1.0 の門の 3 つ目——`spell()` の代わりの守り A、重量級の到達性の分類、重量級コーパスの期首——を 3 本の PR で入れる。

**Architecture:** PR 1 は `heavy/tests/ui/keys.ts` が盤面の面を「トークン・操作・Shift」に分類し、分類できない面で落ちる。PR 2 は core のテストに「入力中は綴りの末尾が engine の表示と一致する」を網羅と乱択で掛け、過去の欠陥版 4 つで赤を実測する。PR 3 は境界証明書に timing を運ばせたあと、新しいシャード `finance-start-000.json` を足す（`finance-000.json` は 1 バイトも変えない）。

**Tech Stack:** Rust（proptest）、TypeScript（vitest・Playwright）、Python（reference、`uv`）

**Spec:** `docs/superpowers/specs/2026-09-10-independent-verification-gaps-design.md`（裁定済み 2026-09-10、§7 の 5 点すべて推しどおり）

## Global Constraints

- **push と PR 作成は利用者の手番。** コミットとブランチ作成まで。
- **共有ワークツリー `/home/terapyon/dev/CalcArc` の HEAD を動かさない。** 隔離作業木で作業する。
- **`uv` は `--no-config` を付ける**——`lock` / `sync` / `run` のすべて（CLAUDE.md「踏んだ罠」）。
- **Rust を触ったらコミット前に `cargo fmt`**。`tools/` を触ったら `cd heavy && pnpm lint`（2 か所を見る）。
- **`finance-000.json` は 1 バイトも変えない。** 再現性の検査と `git diff --stat corpus/generated/` で毎回確かめる。
- **`release.yml` の既存の値、`finance-000.json` に対する既存の `minRate` の値を動かさない。**
- **この作業機で `pnpm heavy:ui` を全体では回さない**（segfault の実績）。`heavy:ui` の変更の最初の確認は CI の `Heavy corpus`（利用者が枝で手動起動）である。**「未確認」を「確認済み」に変えるのは、その走行を読んでから。**
- **番人は変異させて赤を見てから名指しする**（記憶 `cite-a-guard-only-after-mutating-it`）。赤の確かめは一時コミットの上で行い、戻しは再編集で（記憶 `red-check-procedure`）。
- コミットの末尾:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NbSckxyibTw2mVbKW34pYp
  ```

## 枝の形

3 本は**この順に縦積み**にする（裁定の順序どおり）。push で積み直しが要ることは記憶 `stacked-branches-need-rebase-after-push` のとおり。

```
origin/main (e266a6d)
└─ docs/independent-verification-gaps   設計書・計画・PR 1（到達性）
   └─ test/spell-differential            PR 2（spell の守り A）
      └─ heavy/finance-start             PR 3（期首）
```

## File Structure

| ファイル | PR | 責務 |
|---|---|---|
| `heavy/tests/ui/keys.ts` | 1 | 盤面の面の分類（`classifyFaces`）と `BUTTON_FOR` / `ACTION_BUTTONS` |
| `heavy/tests/unit/heavy-ui-keys.test.ts`（新） | 1 | 分類の単体（毎 PR） |
| `heavy/tests/ui/reachability.spec.ts` | 1 | 操作の面も到達性に入れる |
| `crates/calcarc-core/tests/spell_differential.rs`（新） | 2 | 不変条件 A（網羅 + 乱択） |
| `crates/calcarc-core/src/engine/spell.rs` | 2 | docstring の「番人」に A を足す（コードは触らない） |
| `docs/superpowers/specs/2026-09-03-history-design.md` | 2 | `独立: 不可能` の「実測前」を外す |
| `heavy/harness/timing.ts`（新） | 3 | 入力の `timing` を読む純関数 |
| `heavy/harness/heavy-harness.ts` | 3 | 複利 3 op が `timingOf(i)` を渡す |
| `heavy/tests/corpus/certificates.ts` | 3 | 複利の probe の `base` に `timing` を運ぶ |
| `heavy/tests/corpus/calls.spec.ts` | 3 | 証明書を金融の全シャードに掛ける／期首の被覆を固定 |
| `heavy/tests/corpus/corpus.ts` | 3 | 被覆のモデル名と必須シャードに期首を足す |
| `heavy/scripts/detection-power.mjs` | 3 | `ALL_SHARDS`・新しい変異・実測した `expectShards` / `minRate` |
| `heavy/tests/ui/finance-cases.ts` / `finance-ui.spec.ts` | 3 | 積立の位置を毎回押す／期首の 3 件 |
| `reference/src/calcarc_reference/corpus_calls.py` | 3 | 期首の層・乱択・被覆・`build_finance_start_shard` |
| `reference/scripts/generate_corpus.py` | 3 | 20 枚目を書き出す／腐った「18 枚」を直す |
| `reference/tests/test_generate_corpus.py` | 3 | 期首のシャードの契約 |
| `corpus/generated/finance-start-000.json`（新・生成物） | 3 | 期首のシャード |

---

# Part A — PR 1: 到達性

作業木: `<scratchpad>/wt-ivg`（枝 `docs/independent-verification-gaps`、設計書と計画が既に在る）。依存: `cd heavy && pnpm install --frozen-lockfile`、`cd web && pnpm install --frozen-lockfile`。

### Task 1: 盤面の面を 3 種に分類する

**Files:**
- Modify: `heavy/tests/ui/keys.ts`（全体を置き換える）
- Create: `heavy/tests/unit/heavy-ui-keys.test.ts`

**Interfaces:**
- Produces: `classifyFaces(sections: readonly KeypadSection<KeyToken>[]): Faces`、`BUTTON_FOR: ReadonlyMap<KeyToken, ButtonFor>`（**今までと同じ中身**）、`ACTION_BUTTONS: ReadonlyMap<KeyAction, ButtonFor>`、`SHIFT_ARIA_LABEL`、`interface ButtonFor { ariaLabel; needsShift; section }`

- [ ] **Step 1: 失敗する単体テストを書く**

`heavy/tests/unit/heavy-ui-keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KeyToken } from "../../../web/src/calc";
import { SCIENTIFIC_SECTIONS } from "../../../web/src/ui/Keypad/scientific";
import type { KeyDef, KeypadSection } from "../../../web/src/ui/Keypad/types";
import {
  ACTION_BUTTONS,
  BUTTON_FOR,
  classifyFaces,
  SHIFT_ARIA_LABEL,
} from "../ui/keys";

/**
 * **盤面の面は「トークン・操作・Shift」のどれか 1 つである。**
 *
 * 重量級の到達性検査は、以前は `token !== null` の面しか見なかった
 * ——`hist`(`token: null` / `action: "history"`)が落ちていた
 * (設計書 2026-09-10 §3)。**分類を網羅にして、どれにも当たらない面で
 * 落とす**——次に種類が増えた日に、ここが赤くなって決めさせる。
 */

const oneSection = (
  keys: KeyDef<KeyToken>[],
): KeypadSection<KeyToken>[] => [
  { ariaLabel: "試験の区画", columns: 1, height: "square", keys },
];

describe("classifyFaces", () => {
  it("classifies every face of the real keypad, with none left over", () => {
    const faces = SCIENTIFIC_SECTIONS.flatMap((section) =>
      section.keys.flatMap((key) => (key.shift ? [key, key.shift] : [key])),
    ).length;
    const classified = classifyFaces(SCIENTIFIC_SECTIONS);
    expect(
      classified.tokens.size + classified.actions.size + classified.shifts,
    ).toBe(faces);
    // **空で緑を返さない。** どの種も 1 つ以上ある(数は盤面から導き、書き写さない)。
    expect(classified.tokens.size).toBeGreaterThan(0);
    expect(classified.actions.size).toBeGreaterThan(0);
    expect(classified.shifts).toBeGreaterThan(0);
  });

  it("puts the history key behind Shift as an action, not as a token", () => {
    const def = SCIENTIFIC_SECTIONS.flatMap((s) => s.keys).find(
      (key) => key.shift?.action === "history",
    )?.shift;
    expect(def, "the keypad no longer carries a history face").toBeDefined();
    const button = ACTION_BUTTONS.get("history");
    expect(button?.ariaLabel).toBe(def?.ariaLabel);
    expect(button?.needsShift).toBe(true);
  });

  it("leaves BUTTON_FOR carrying tokens only", () => {
    for (const [token] of BUTTON_FOR) {
      expect(token).not.toBeNull();
    }
  });

  it("refuses a face that is neither a token, an action, nor Shift", () => {
    expect(() =>
      classifyFaces(
        oneSection([
          { token: null, label: "?", ariaLabel: "謎のキー", variant: "function" },
        ]),
      ),
    ).toThrow(/謎のキー/);
  });

  it("refuses the same action on two faces", () => {
    expect(() =>
      classifyFaces(
        oneSection([
          { token: null, label: "h", ariaLabel: "履歴 1", variant: "function", action: "history" },
          { token: null, label: "h", ariaLabel: "履歴 2", variant: "function", action: "history" },
        ]),
      ),
    ).toThrow(/history/);
  });

  it("refuses a Shift key whose name drifted from SHIFT_ARIA_LABEL", () => {
    expect(() =>
      classifyFaces(
        oneSection([
          { token: null, label: "S", ariaLabel: "別の名前", variant: "function", kind: "shift" },
        ]),
      ),
    ).toThrow(new RegExp(SHIFT_ARIA_LABEL));
  });
});
```

- [ ] **Step 2: 走らせて赤を見る**

Run: `cd heavy && pnpm vitest run tests/unit/heavy-ui-keys.test.ts`
Expected: FAIL（`classifyFaces` / `ACTION_BUTTONS` が export されていない）

- [ ] **Step 3: `keys.ts` を置き換える**

```ts
import type { KeyToken } from "../../../web/src/calc";
import { SCIENTIFIC_SECTIONS } from "../../../web/src/ui/Keypad/scientific";
import type {
  KeyAction,
  KeypadSection,
} from "../../../web/src/ui/Keypad/types";

/**
 * キートークン → 盤面のボタン。
 *
 * **手書きの表を持たない。** UI が描くのと同じ定義(`SCIENTIFIC_SECTIONS`)から
 * 導く。手で書くと、キーが Shift の裏に移動しても表は古いまま緑になり——
 * 「そのキーは押せる」という嘘が残る。
 *
 * 導いた結果、**どのトークンにもボタンが無い**なら、それは
 * 「盤面から到達できないキー」であり、**それ自体が発見である。**
 */
export interface ButtonFor {
  /** 押すボタンのアクセシブルネーム。 */
  ariaLabel: string;
  /** 押す前に Shift を押す必要があるか。 */
  needsShift: boolean;
  /** どの区画にあるか。region 起点で引くために要る。 */
  section: string;
}

export const SHIFT_ARIA_LABEL = "第2面に切り替え";

/** 盤面の面を 3 種に分けた結果。 */
export interface Faces {
  tokens: Map<KeyToken, ButtonFor>;
  actions: Map<KeyAction, ButtonFor>;
  /** `kind: "shift"` の面の数。名前は `SHIFT_ARIA_LABEL` と一致していることを確かめ済み。 */
  shifts: number;
}

/**
 * **盤面のすべての面(第 1 面・第 2 面)を「トークン・操作・Shift」のどれか
 * 1 つに分ける。どれにも当たらない面で落ちる**(設計書 2026-09-10 §3.2)。
 *
 * 以前はトークンを持つ面だけを表に入れ、残りを黙って捨てていた——`hist`
 * (`token: null` / `action: "history"`)がそこで落ち、テスト名
 * `every button the keypad claims can actually be pressed` が主張を超えていた。
 * **捨てる代わりに分類し、分類できないものを見つけたら止まる。**
 */
export function classifyFaces(
  sections: readonly KeypadSection<KeyToken>[],
): Faces {
  const tokens = new Map<KeyToken, ButtonFor>();
  const actions = new Map<KeyAction, ButtonFor>();
  let shifts = 0;

  const place = (
    face: {
      token: KeyToken | null;
      ariaLabel: string;
      action?: KeyAction;
      kind?: "shift";
    },
    needsShift: boolean,
    section: string,
  ): void => {
    const button = { ariaLabel: face.ariaLabel, needsShift, section };
    if (face.token !== null) {
      const existing = tokens.get(face.token);
      if (existing !== undefined) {
        throw new Error(
          `keys: ${face.token} appears twice on the keypad ` +
            `(${existing.ariaLabel} and ${face.ariaLabel}). The driver would ` +
            "press one of them arbitrarily.",
        );
      }
      tokens.set(face.token, button);
      return;
    }
    if (face.action !== undefined) {
      if (actions.has(face.action)) {
        throw new Error(
          `keys: the action ${face.action} appears twice on the keypad. ` +
            "The driver would press one of them arbitrarily.",
        );
      }
      actions.set(face.action, button);
      return;
    }
    if (face.kind === "shift" && !needsShift) {
      if (face.ariaLabel !== SHIFT_ARIA_LABEL) {
        throw new Error(
          `keys: the Shift key is named "${face.ariaLabel}", but the driver ` +
            `presses "${SHIFT_ARIA_LABEL}". Rename one of them.`,
        );
      }
      shifts += 1;
      return;
    }
    throw new Error(
      `keys: "${face.ariaLabel}" (${section}) is neither a token, an action, ` +
        "nor the Shift key — the heavy model cannot drive it. Decide what it " +
        "is and teach classifyFaces about it.",
    );
  };

  for (const section of sections) {
    for (const key of section.keys) {
      place(key, false, section.ariaLabel);
      if (key.shift !== undefined) {
        place(key.shift, true, section.ariaLabel);
      }
    }
  }
  return { tokens, actions, shifts };
}

const FACES = classifyFaces(SCIENTIFIC_SECTIONS);

export const BUTTON_FOR: ReadonlyMap<KeyToken, ButtonFor> = FACES.tokens;

/** 操作の面(`action`)→ 盤面のボタン。**トークンを送らない面**。 */
export const ACTION_BUTTONS: ReadonlyMap<KeyAction, ButtonFor> = FACES.actions;
```

- [ ] **Step 4: 走らせて緑を見る**

Run: `cd heavy && pnpm vitest run tests/unit/heavy-ui-keys.test.ts`
Expected: PASS（6 本）

- [ ] **Step 5: 赤を確かめる（名指しの前に）**

一時コミットを作ってから、`classifyFaces` の最後の `throw` を `return;` に置き換える → Step 4 のテスト「refuses a face that is neither…」が赤、「classifies every face…」も赤（数が合わなくなる）ことを見る。戻しは再編集で。

- [ ] **Step 6: 型と lint**

Run: `cd heavy && pnpm typecheck && pnpm lint`
Expected: 0 / 0

### Task 2: 到達性の検査に操作の面を入れる

**Files:**
- Modify: `heavy/tests/ui/reachability.spec.ts`

**Interfaces:**
- Consumes: `BUTTON_FOR`、`ACTION_BUTTONS`、`SHIFT_ARIA_LABEL`（Task 1）

- [ ] **Step 1: import と 2 本のテストを変える**

import を差し替える:

```ts
import { ACTION_BUTTONS, BUTTON_FOR, SHIFT_ARIA_LABEL } from "./keys";

/** 盤面の押せる面の全部。**トークンと操作の両方**(設計書 2026-09-10 §3)。 */
const PRESSABLE: [string, import("./keys").ButtonFor][] = [
  ...[...BUTTON_FOR].map(([token, b]) => [token, b] as [string, import("./keys").ButtonFor]),
  ...[...ACTION_BUTTONS].map(([action, b]) => [`action:${action}`, b] as [string, import("./keys").ButtonFor]),
];
```

`every button the keypad claims can actually be pressed` のループを `for (const [token, button] of BUTTON_FOR)` から `for (const [token, button] of PRESSABLE)` へ変える（本文はそのまま）。

`the keys behind Shift appear only after Shift is pressed` の最初の行を

```ts
  const shifted = PRESSABLE.filter(([, b]) => b.needsShift);
```

にし、Shift を押した後のループで**有効であることも見る**:

```ts
  // 押した後は 1 つだけあり、**押せる**(操作の面——`hist`——も含む)。
  const stillMissing: string[] = [];
  for (const [token, button] of shifted) {
    const locator = panel(page).getByRole("button", {
      name: button.ariaLabel,
      exact: true,
    });
    if ((await locator.count()) !== 1) {
      stillMissing.push(`${token} ("${button.ariaLabel}")`);
      continue;
    }
    if (!(await locator.isEnabled())) {
      stillMissing.push(`${token} ("${button.ariaLabel}") は在るが押せない`);
    }
  }
```

`hist` は**押さない**（押すと履歴の画面へ移る。押した先は web の E2E が持つ）。

- [ ] **Step 2: 手元で到達性の 1 本だけ回せるか試す**

Run: `cd heavy && pnpm --dir ../web wasm && pnpm exec playwright test --config playwright.ui.config.ts tests/ui/reachability.spec.ts`
Expected: 4 passed。**segfault したらそこで止め、Step 3 は CI へ回す**（「未確認」と記録）。

- [ ] **Step 3: 赤を確かめる（手元で回せた場合だけ）**

一時コミットの上で `web/src/ui/Keypad/scientific.ts` の `hist` の `ariaLabel: "履歴"` を `"履歴X"` に変える → Shift のテストが赤（「pressing Shift did not reveal them」に `action:history`）。戻しは再編集で。

- [ ] **Step 4: 単体・型・lint・コミット**

Run: `cd heavy && pnpm test && pnpm typecheck && pnpm lint`
Expected: 全部緑

```bash
git add heavy/tests/ui/keys.ts heavy/tests/unit/heavy-ui-keys.test.ts heavy/tests/ui/reachability.spec.ts
git commit  # 件名: "Classify every keypad face so the heavy reachability check sees hist"
```

---

# Part B — PR 2: `spell` の守り A

作業木: 同じ木で `git switch -c test/spell-differential`。

### Task 3: 不変条件 A を網羅と乱択に掛ける

**Files:**
- Create: `crates/calcarc-core/tests/spell_differential.rs`

**Interfaces:**
- Consumes: `calcarc_core::{EngineState, Key, reduce, render}`、`calcarc_core::engine::spell::spell`、`EngineState` の公開フィールド `buffer: Option<Buffer>` と `error`

- [ ] **Step 1: テストを書く**

```rust
//! **入力中は、綴りの最後の語が engine の表示と一致する**(設計書
//! `2026-09-10-independent-verification-gaps-design.md` §2.4、不変条件 A)。
//!
//! `spell` は `Buffer` を本物で歩かせるが、**キーをどこへ振り分けるか**
//! (バッファを開く／確定する／捨てる)は `apply()` を読んで手で写した
//! `match` である。**写しの残りはここで、次にこの族が入るならここ**である。
//! 振り分けがずれると、次の数字で `spell` は新しい語を始め、engine は
//! 書き足す——**最後の語と表示が食い違う。**
//!
//! **逆写像を書かない**(案 B を採らなかった理由、§2.5)。比べる相手は
//! engine 自身の表示だけである。
//!
//! **捕まえないもの**: 字形の側のずれ(`3 + DEL 4` を `34` と綴る。`DEL` の
//! 直後は開いたバッファが無いので A は何も言わない——`spell_table.rs:211` の
//! 行が持つ)と、web の 2 件(履歴の欠陥 6・7)。

use calcarc_core::engine::spell::spell;
use calcarc_core::{EngineState, Key, reduce, render};
use proptest::prelude::*;

/// A を 1 回確かめる。入力中でなければ何も言わない。
fn check(keys: &[Key], state: &EngineState) -> Result<(), String> {
    if state.buffer.is_none() || state.error.is_some() {
        return Ok(());
    }
    let shown = render(state).main;
    let spelled = spell(keys);
    let last = spelled.rsplit(' ').next().unwrap_or("");
    if last == shown {
        Ok(())
    } else {
        let tokens: Vec<&str> = keys.iter().map(|k| k.token()).collect();
        Err(format!(
            "入力中なのに綴りの最後の語が表示と違う: 表示 {shown:?} / 綴り {spelled:?}\n  keys: {tokens:?}"
        ))
    }
}

/// **網羅の同値類。** `engine_robustness.rs` の `ALL_CLASSES`(17)に
/// **`Zeros3` と `Neg` を足したもの**——どちらも過去の欠陥の鍵である
/// (`000` の `del`、指数の符号)。`ALL_CLASSES` には無い。
const CLASSES: [Key; 19] = [
    Key::Digit(3),
    Key::Digit(0),
    Key::Dot,
    Key::J,
    Key::Sub,
    Key::Div,
    Key::Eq,
    Key::LParen,
    Key::RParen,
    Key::Del,
    Key::Ac,
    Key::PolarToggle,
    Key::Sqrt,
    Key::Pi,
    Key::Exp,
    Key::Pow,
    Key::Dms,
    Key::Zeros3,
    Key::Neg,
];

fn walk(state: &EngineState, keys: &mut Vec<Key>, depth: usize, max: usize) {
    if depth == max {
        return;
    }
    for &key in &CLASSES {
        let (next, _) = reduce(state, key);
        keys.push(key);
        if let Err(why) = check(keys, &next) {
            panic!("{why}");
        }
        // エラーからは AC 以外で新しい状態に届かない(`engine_robustness.rs` の I5)。
        if state.error.is_none() || key == Key::Ac {
            walk(&next, keys, depth + 1, max);
        }
        keys.pop();
    }
}

/// **長さ 5 までのすべての列**(19 類)。字数上限(12)には `3 000 000 000 000`
/// (5 打鍵・13 桁)で届き、指数の符号には `3 Exp 3 +/−`(4 打鍵)で届く。
#[test]
fn every_sequence_up_to_five_keys_spells_the_entry_as_the_engine_shows_it() {
    walk(&EngineState::initial(), &mut Vec::new(), 0, 5);
}

/// 入力に寄せた乱択。**長い数**(字数上限の上での `.`・`000` の上限跨ぎ)に
/// 届かせるため、数字と入力のキーを厚くする。`engine_robustness.rs` の
/// `weighted_key` は `Zeros3`・`Exp`・`Dms` を 1 つも引かないので使わない。
fn entry_key() -> impl Strategy<Value = Key> {
    prop_oneof![
        6 => prop::sample::select(vec![Key::Digit(0), Key::Digit(3), Key::Digit(7)]),
        2 => Just(Key::Zeros3),
        2 => Just(Key::Dot),
        2 => Just(Key::Exp),
        2 => Just(Key::Neg),
        2 => Just(Key::Del),
        1 => Just(Key::J),
        1 => Just(Key::Dms),
        2 => prop::sample::select(vec![Key::Add, Key::Sub, Key::Mul, Key::Div]),
        1 => prop::sample::select(vec![Key::LParen, Key::RParen, Key::Eq]),
        1 => prop::sample::select(vec![Key::Sqrt, Key::Sin, Key::Pi, Key::E]),
        1 => Just(Key::Ac),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    #[test]
    fn random_entry_heavy_sequences_spell_the_entry_as_the_engine_shows_it(
        raw in prop::collection::vec(entry_key(), 0..40)
    ) {
        let mut state = EngineState::initial();
        let mut keys = Vec::new();
        for key in raw {
            // エラーに落ちたら AC を挟んで生き延びさせる(綴りにも同じ AC を入れる)。
            if state.error.is_some() {
                state = reduce(&state, Key::Ac).0;
                keys.push(Key::Ac);
            }
            state = reduce(&state, key).0;
            keys.push(key);
            if let Err(why) = check(&keys, &state) {
                prop_assert!(false, "{}", why);
            }
        }
    }
}
```

- [ ] **Step 2: いまの `spell` で走らせる**

Run: `cargo test -p calcarc-core --test spell_differential -- --nocapture`
Expected: 2 passed。**所要時間を `time` で測って記録する**（設計書 §8 の実測前）。網羅が 60 秒を超えたら、`CLASSES` から表示トグルの `PolarToggle` を外して測り直し、外した理由を註に書く。

- [ ] **Step 3: 偽の赤が出たら止める**

緑にならなかった場合、**それは A の前提（「入力中は `render(...).main` が `buffer.text()` そのもの」）が崩れた箇所である**。直さずに報告する（設計書に書き戻してから進む）。

- [ ] **Step 4: 一時コミット**

```bash
cargo fmt
git add crates/calcarc-core/tests/spell_differential.rs
git commit -m "WIP spell differential (red-check base)"
```

### Task 4: 過去の欠陥版 4 つで A の赤を実測する

**Files:**
- 変更しない（一時的に `crates/calcarc-core/src/engine/spell.rs` を差し替え、戻す）
- Modify（記録）: `docs/superpowers/specs/2026-09-10-independent-verification-gaps-design.md` §2.6

- [ ] **Step 1: 4 版を順に当てる**

```bash
for v in 8d94c57 b89a093 5d6b9ba a8a20e9; do
  echo "===== $v ====="
  git show "$v:crates/calcarc-core/src/engine/spell.rs" > crates/calcarc-core/src/engine/spell.rs
  cargo test -p calcarc-core --test spell_differential 2>&1 | grep -E 'test result|panicked|keys:|minimal failing input|表示' | head -12
  git show HEAD:crates/calcarc-core/src/engine/spell.rs > crates/calcarc-core/src/engine/spell.rs
done
git status --porcelain   # 空であること
```

Expected（見立て。設計書 §2.6）: 4 版とも赤。反例は `8d94c57` が `000` の `del`、`b89a093` が `dms`、`5d6b9ba` が `j`/`Exp` の `del`、`a8a20e9` が指数の符号か字数上限。

- [ ] **Step 2: コンパイルできない版があった場合**

その版だけ、**逆にテストを過去の木へ持っていく**:

```bash
git worktree add --detach /tmp/claude-1000/-home-terapyon-dev-CalcArc/6d3f235a-bf78-4fce-8121-beb0c8c7c3d9/scratchpad/wt-old "$v"
cp crates/calcarc-core/tests/spell_differential.rs <wt-old>/crates/calcarc-core/tests/
(cd <wt-old> && cargo test -p calcarc-core --test spell_differential 2>&1 | tail -20)
git worktree remove --force <wt-old>
```

`EngineState` の `error` / `buffer` がその版で公開されていなければ、それも記録する。

- [ ] **Step 3: 結果を設計書 §2.6 に書き戻す**

見立ての表を**実測の表**に置き換える（版・赤か緑か・縮めた反例・対応する欠陥）。**赤くならなかった版があれば、それを「A が捕まえないもの」に足す**（裁定の条件）。見立てと食い違った対応も同じ節に書く。

### Task 5: `独立: 不可能` を確定させ、番人を名指しする

**Files:**
- Modify: `crates/calcarc-core/src/engine/spell.rs`（docstring のみ）
- Modify: `crates/calcarc-core/tests/spell_table.rs`（冒頭の docstring のみ）
- Modify: `docs/superpowers/specs/2026-09-03-history-design.md:189-192` と `:480-481`

- [ ] **Step 1: `spell.rs` の宣言に A を足す**

`//! 独立: 不可能。…**番人は `tests/spell_table.rs` の表**であり、…` の段落の直後に:

```rust
//! **番人はもう 1 つある**——`tests/spell_differential.rs` が、長さ 5 までの
//! 全列と入力に寄せた乱択で「入力中は綴りの最後の語が engine の表示と一致する」
//! を確かめる。**写しの残り(キーの振り分け)を見るのはこちら**である。
//! 過去の欠陥版 4 つで赤くなることを実測した(設計書
//! `2026-09-10-independent-verification-gaps-design.md` §2.6)。
```

- [ ] **Step 2: 履歴の設計書の「実測前」を外す**

`:191` の「`独立: 不可能`** が正直な見立てである（**実測前**——参照実装を書く段で確定させる）。§13 に残す。」を

```
**`独立: 不可能`** で**確定**した（2026-09-10、`2026-09-10-independent-verification-gaps-design.md` §2.1）。
代わりに守るのは `spell_table.rs` の表と `spell_differential.rs`（不変条件 A）である。
```

に、`:480-481` の §13-5 を「**確定済み**（上と同じ）」に置き換える。

- [ ] **Step 3: ゲートとコミット**

```bash
cargo fmt && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
node tools/check-citations.mjs
git add -A && git commit --amend   # WIP を本コミットにする。件名: "Guard spell's remaining hand copy with an entry-vs-display differential"
```

Expected: 全部緑。本文に §2.6 の実測表の要約を入れる。

---

# Part C — PR 3: 期首

作業木: 同じ木で `git switch -c heavy/finance-start`。依存に `cd reference && uv sync --no-config --locked`。

### Task 6: 境界証明書に timing を運ばせる（**先のコミット**）

**Files:**
- Create: `heavy/harness/timing.ts`
- Modify: `heavy/tests/corpus/certificates.ts`（`compoundDepositForProbes` と `compoundPeriodsForProbes` の `base`）
- Create: `heavy/tests/unit/certificates-timing.test.ts`

**Interfaces:**
- Produces: `timingOf(input: Record<string, unknown>): "end" | "start"`（`heavy/harness/timing.ts`）

- [ ] **Step 1: 失敗するテストを書く**

`heavy/tests/unit/certificates-timing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { timingOf } from "../../harness/timing";
import {
  compoundDepositForProbes,
  compoundPeriodsForProbes,
} from "../corpus/certificates";
import type { CallCase } from "../corpus/corpus";

/**
 * **証明書は期首の答を期首で検算する**(設計書 2026-09-10 §4.4)。
 *
 * 以前は正算の入力 `base` を timing 抜きで組んでいた——harness の既定は
 * 期末なので、期首の逆算を**期末の腕で**検算していた。
 */
const depositFor = (timing?: "start"): CallCase => ({
  id: "t-1",
  op: "compound_deposit_for",
  input: {
    principal: "0",
    target: "1000",
    rate: "3.0",
    periods_per_year: 12,
    periods: 12,
    tax: false,
    ...(timing ? { timing } : {}),
  },
  expect: { deposit: "80" },
}) as unknown as CallCase;

const periodsFor = (timing?: "start"): CallCase => ({
  id: "t-2",
  op: "compound_periods_for",
  input: {
    principal: "0",
    deposit: "100",
    target: "1000",
    rate: "3.0",
    periods_per_year: 12,
    tax: false,
    ...(timing ? { timing } : {}),
  },
  expect: { periods: "3" },
}) as unknown as CallCase;

describe("timingOf", () => {
  it("reads the end when the case says nothing (the end corpus carries no timing)", () => {
    expect(timingOf({})).toBe("end");
  });
  it("reads start and end as written", () => {
    expect(timingOf({ timing: "start" })).toBe("start");
    expect(timingOf({ timing: "end" })).toBe("end");
  });
  it("refuses a spelling it does not know instead of falling back to the end", () => {
    expect(() => timingOf({ timing: "beginning" })).toThrow(/beginning/);
  });
});

describe("the compound certificates carry the case's timing", () => {
  it("probes a start deposit_for at the start", () => {
    for (const probe of compoundDepositForProbes([depositFor("start")])) {
      expect(probe.input.input.timing).toBe("start");
    }
  });
  it("probes a start periods_for at the start", () => {
    for (const probe of compoundPeriodsForProbes([periodsFor("start")])) {
      expect(probe.input.input.timing).toBe("start");
    }
  });
  it("adds no timing to an end case (finance-000's probes do not change)", () => {
    for (const probe of [
      ...compoundDepositForProbes([depositFor()]),
      ...compoundPeriodsForProbes([periodsFor()]),
    ]) {
      expect("timing" in probe.input.input).toBe(false);
    }
  });
});
```

- [ ] **Step 2: 赤を見る**

Run: `cd heavy && pnpm vitest run tests/unit/certificates-timing.test.ts`
Expected: FAIL（`../../harness/timing` が無い）

- [ ] **Step 3: `heavy/harness/timing.ts` を書く**

```ts
/**
 * 入力の積立の位置。**書いていなければ期末**——期末のコーパス
 * (`finance-000.json`)は `timing` を持たない(設計書 2026-09-10 §4.4)。
 *
 * **知らない綴りは落とす。** 黙って期末へ倒すと、綴りを間違えた期首の
 * ケースが期末として照合され、**もっともらしい不一致**になる。
 */
export function timingOf(input: Record<string, unknown>): "end" | "start" {
  const value = input.timing;
  if (value === undefined) return "end";
  if (value === "end" || value === "start") return value;
  throw new Error(
    `timingOf: the case's timing is ${JSON.stringify(value)}; expected "end" or "start"`,
  );
}
```

- [ ] **Step 4: `certificates.ts` の 2 か所の `base` に timing を運ぶ**

`compoundDepositForProbes` と `compoundPeriodsForProbes` の `const base = { … tax: taxed, };` の閉じ括弧の直前に 1 行ずつ足す:

```ts
      // **期首の答は期首で検算する**(設計書 2026-09-10 §4.4)。期末のケースは
      // `timing` を持たないので何も足さない——`finance-000.json` の probe は不変。
      ...(c.input.timing === undefined ? {} : { timing: c.input.timing }),
```

`Probe` の `input.input` の型が `Record<string, string | number | boolean>` なら型は通る。

- [ ] **Step 5: 緑を見る**

Run: `cd heavy && pnpm vitest run tests/unit/certificates-timing.test.ts`
Expected: PASS（6 本）

- [ ] **Step 6: harness が `timingOf` を使う**

`heavy/harness/heavy-harness.ts` の複利 3 op の `"end",` を `timingOf(i),` に置き換え、`import { timingOf } from "./timing";` を足す。上の註「複利の 3 つは積立の位置(`timing`)を `"end"` と書いて渡す。…範囲外。」を次に置き換える:

```ts
  // **複利の 3 つは積立の位置をケースから読む**(`timingOf`)。**書いて
  // いなければ期末**——期末のコーパスは `timing` を持たない。知らない綴りは
  // 落とす。境界と TS のラッパーに既定値が無いこと(渡し忘れが黙って期末に
  // ならないこと、設計書 2026-09-03 §5.4.1)は変わらない——既定を持つのは
  // この harness の読み取りだけで、そこは明示の分岐である。
```

- [ ] **Step 7: `finance-000.json` の既存ケースが 1 件も動かないことを確かめる**

Run: `cd heavy && pnpm heavy 2>&1 | tail -4`
Expected: 257 passed（09-09 と同じ本数）。証明書 4 本が緑。

- [ ] **Step 8: ゲートとコミット（証明書だけ）**

```bash
cd heavy && pnpm test && pnpm typecheck && pnpm lint
git add heavy/harness/timing.ts heavy/harness/heavy-harness.ts heavy/tests/corpus/certificates.ts heavy/tests/unit/certificates-timing.test.ts
git commit  # 件名: "Carry the case's timing into the compound certificates and the harness"
```

### Task 7: 生成器の期末の前提に timing を通す（`finance-000.json` は不変）

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`

**Interfaces:**
- Produces: `_compound_reached(…, timing: compound_ref.Timing = compound_ref.END)`、`_deposit_for_target_exists(rate, periods, timing=END)`、`_deposit_for_construction(row, timing=END)`、`compound_deposit_for_exclusions(covered, timing=END)`、`_finance_entry(index, op, params, stratum, prefix="fin")`

- [ ] **Step 1: 引数を足す（既定は期末）**

- `_compound_reached` の引数の末尾に `timing: compound_ref.Timing = compound_ref.END` を足し、`compound_ref.reached(principal, deposit, num, den, periods, tax, timing)` と渡す。
- `_deposit_for_target_exists(rate: str, periods: int, timing: compound_ref.Timing = compound_ref.END)` にし、中の `_compound_reached(0, 1, rate, int(per_year), periods, bool(tax), timing)`。
- `_deposit_for_construction(row, timing: compound_ref.Timing = compound_ref.END)` にし、中の 2 か所の `_compound_reached(0, 1, rate, int(per), …, tax, timing)`。
- `compound_deposit_for_exclusions(covered, timing: compound_ref.Timing = compound_ref.END)` にし、`_deposit_for_target_exists(str(rate), int(periods), timing)`。
- `_finance_entry(index, op, params, stratum, prefix: str = "fin")` にし、`"id": f"{prefix}-{index:06d}"`。

- [ ] **Step 2: `finance-000.json` が 1 バイトも動かないことを確かめる**

Run:

```bash
cd reference && uv run --no-config python scripts/generate_corpus.py && cd .. && git diff --stat corpus/generated/
cd reference && uv run --no-config pytest -q tests/test_generate_corpus.py tests/test_corpus_reproducibility.py
git status --porcelain reference/uv.lock   # 空であること
```

Expected: `git diff --stat corpus/generated/` が空。テストが緑。

### Task 8: 期首のシャードを作る

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`（末尾に節を足す）
- Modify: `reference/scripts/generate_corpus.py`
- Modify: `reference/tests/test_generate_corpus.py`
- Create（生成物）: `corpus/generated/finance-start-000.json`

**Interfaces:**
- Produces: `build_finance_start_shard(seed: int, count: int) -> dict`、`FINANCE_START_MODEL = "finance-start-v1"`、`FINANCE_START_REQUIREMENTS`、`FINANCE_START_STRATA`

- [ ] **Step 1: 非単調な谷を期首・積立 1 円で探す（1 回だけの測定）**

`_find_non_monotone_net_valley` に `timing: compound_ref.Timing = compound_ref.END` を足して `compound_ref.reached(…, True, timing)` と渡す。そのうえで:

```bash
cd reference && uv run --no-config python -c "
from calcarc_reference import corpus_calls as c, compound_ref as r
num, den = r.rate_fraction('0.0001', 1)
try:
    print(c._find_non_monotone_net_valley(1_000_000, 1, num, den, 200, r.START))
except RuntimeError as e:
    print('見つからない:', e)
"
```

**見つかったら** Step 3 の `FINANCE_START_STRATA` に谷の層を足す（`_non_monotone_net_strata` と同じ形、`deposit: "1"`、`timing: "start"`）。**見つからなければ層を入れず**、結果を設計書 §4.3 に書き戻す（見立て「平らになる」が当たったかどうか）。

- [ ] **Step 2: 期首の契約テストを書く（赤）**

`reference/tests/test_generate_corpus.py` の末尾に:

```python
# ---------------------------------------------------------------------------
# 期首のシャード(設計書 2026-09-10 §4)
# ---------------------------------------------------------------------------


def _start_shard() -> dict:
    return corpus_calls.build_finance_start_shard(seed=20260910, count=generate_corpus.FINANCE_START_COUNT)


def test_the_start_shard_is_all_compound_and_all_start() -> None:
    """**期首のシャードは複利の 3 op だけ・全件期首。** 期末は `finance-000.json` と golden が持つ。"""
    cases = _start_shard()["cases"]
    assert cases, "期首のシャードが空"
    assert {c["op"] for c in cases} == set(corpus_calls.COMPOUND_OPS)
    assert all(c["input"].get("timing") == "start" for c in cases)
    assert all(c["id"].startswith("fin-start-") for c in cases)


def test_every_start_case_can_tell_start_from_end() -> None:
    """**積立 0 の期首は期末と同じ答を返す**(`cases.py:754`)——期首の腕を
    1 度も見ないケースを入れても検出力にならない。正算と必要期間は積立 > 0。
    必要積立額は積立が答なので、正常ケースの答が 1 円以上であることを見る。"""
    for c in _start_shard()["cases"]:
        if c["op"] in ("compound_grow", "compound_periods_for"):
            assert int(c["input"]["deposit"]) > 0, c["id"]
        elif "error" not in c["expect"]:
            assert int(c["expect"]["deposit"]) > 0, c["id"]


def test_the_start_shard_carries_its_own_coverage() -> None:
    shard = _start_shard()
    cov = shard["coverage"]
    assert cov["model"] == corpus_calls.FINANCE_START_MODEL == "finance-start-v1"
    assert [r["id"] for r in cov["requirements"]] == [
        r.id for r in corpus_calls.FINANCE_START_REQUIREMENTS
    ]
    for r in cov["requirements"]:
        assert r["unmet_cells"] == 0, f"{r['id']} に未達が残っている"
    assert list(shard) == ["schema", "generated_by", "rejections", "coverage", "cases"]


def test_the_start_requirements_are_finance_v1s_compound_requirements_by_reference() -> None:
    """**因子表も要求も写さない。** `finance-v1` の複利 3 要求そのものを指す。"""
    for r in corpus_calls.FINANCE_START_REQUIREMENTS:
        assert r is corpus_calls._REQUIREMENT_OF[r.scope]


def test_generating_the_start_shard_twice_is_byte_identical() -> None:
    first, second = _start_shard(), _start_shard()
    assert json.dumps(first) == json.dumps(second)
```

Run: `cd reference && uv run --no-config pytest -q tests/test_generate_corpus.py -k start`
Expected: FAIL（`build_finance_start_shard` が無い）

- [ ] **Step 3: 期首の節を `corpus_calls.py` の末尾に足す**

```python
# ---------------------------------------------------------------------------
# 期首のシャード `finance-start-000.json`(設計書 2026-09-10 §4)
#
# **`finance-000.json` は 1 バイトも変えない。** 期首は別の seed・別の層・
# 別の署名集合で作る——既存の乱数列にも、既存の重複判定にも触れない。
# ---------------------------------------------------------------------------

FINANCE_START_MODEL = "finance-start-v1"

#: **`finance-v1` の複利 3 要求をそのまま指す**(写さない)。
FINANCE_START_REQUIREMENTS: tuple[coverage.Requirement, ...] = tuple(
    _REQUIREMENT_OF[op] for op in COMPOUND_OPS
)

#: 期首の層が使った (op, input) の署名。**`_PAIRWISE_CLAIMED_SIGNATURES` と混ぜない。**
_START_CLAIMED_SIGNATURES: set[str] = set()


def _claim_start_signature(op: str, params: dict) -> bool:
    signature = _finance_signature(op, params)
    if signature in _START_CLAIMED_SIGNATURES:
        return False
    _START_CLAIMED_SIGNATURES.add(signature)
    return True


def _start_stratum(op: str, name: str, params: dict) -> Stratum:
    result = compound_ref.compute(op, params)
    return Stratum(op, name, result.get("error", "ok"), 0, lambda rng, i, params=params: params)


def _start_pairwise_strata() -> tuple[Stratum, ...]:
    """複利 3 op のペアワイズ行を**期首で**作る。行そのものは `finance-v1` と同じ。"""
    strata: list[Stratum] = []
    for index, row in enumerate(_PAIRWISE_COMPOUND_GROW_ROWS):
        params = {
            "principal": "1000000",
            "deposit": "10000",
            "rate": row["rate"],
            "periods_per_year": row["periods_per_year"],
            "periods": row["periods"],
            "tax": row["tax"],
            "timing": compound_ref.START,
        }
        if _claim_start_signature("compound_grow", params):
            strata.append(_start_stratum("compound_grow", f"start_pairwise_{index:04d}", params))
    for index, row in enumerate(_PAIRWISE_COMPOUND_DEPOSIT_FOR_ROWS):
        constructed = _deposit_for_construction(row, compound_ref.START)
        if constructed is None:
            continue
        periods, per_year, target = constructed
        params = {
            "principal": "0",
            "target": str(target),
            "periods": periods,
            "rate": row["rate"],
            "periods_per_year": per_year,
            "tax": row["tax"],
            "timing": compound_ref.START,
        }
        if _claim_start_signature("compound_deposit_for", params):
            strata.append(
                _start_stratum("compound_deposit_for", f"start_pairwise_{index:04d}", params)
            )
    for index, row in enumerate(_PAIRWISE_COMPOUND_PERIODS_FOR_ROWS):
        target = _compound_reached(
            0, 1000, row["rate"], row["periods_per_year"], 10, row["tax"], compound_ref.START
        )
        assert target is not None and target > 0, f"期首 periods_for pairwise: 構成が失敗した {row}"
        params = {
            "principal": "0",
            "deposit": "1000",
            "target": str(target),
            "rate": row["rate"],
            "periods_per_year": row["periods_per_year"],
            "tax": row["tax"],
            "timing": compound_ref.START,
        }
        if _claim_start_signature("compound_periods_for", params):
            strata.append(
                _start_stratum("compound_periods_for", f"start_pairwise_{index:04d}", params)
            )
    return tuple(strata)


#: 期首の層。**Step 1 で谷が見つかった場合だけ、ここに谷の層を足す。**
FINANCE_START_STRATA: tuple[Stratum, ...] = _start_pairwise_strata()


def _compound_start_params(rng: random.Random, op: str) -> dict:
    """期首の乱択入力。**積立は 1 円以上**(積立 0 は期首の腕を見ない)。"""
    periods_per_year = rng.choice(PERIODS_PER_YEAR_OK)
    for _attempt in range(_INVERSE_CONSTRUCTION_MAX_ATTEMPTS):
        principal = rng.randint(0, PRINCIPAL_MAX)
        deposit = rng.randint(1, DEPOSIT_MAX)
        rate = _rate(rng)
        periods = rng.randint(1, COMPOUND_PERIODS_MAX)
        tax = rng.random() < 0.5
        if op == "compound_grow":
            return {
                "principal": str(principal),
                "deposit": str(deposit),
                "periods": periods,
                "rate": rate,
                "periods_per_year": periods_per_year,
                "tax": tax,
                "timing": compound_ref.START,
            }
        target = _compound_reached(
            principal, deposit, rate, periods_per_year, periods, tax, compound_ref.START
        )
        if target is None or target <= 0:
            continue
        if op == "compound_deposit_for":
            return {
                "principal": str(principal),
                "target": str(target),
                "periods": periods,
                "rate": rate,
                "periods_per_year": periods_per_year,
                "tax": tax,
                "timing": compound_ref.START,
            }
        if op == "compound_periods_for":
            return {
                "principal": str(principal),
                "deposit": str(deposit),
                "target": str(target),
                "rate": rate,
                "periods_per_year": periods_per_year,
                "tax": tax,
                "timing": compound_ref.START,
            }
        raise ValueError(f"unknown compound op: {op!r}")
    raise RuntimeError(f"{op}(期首): 有効な入力を引けなかった(構成の式を疑う)")


def _finance_start_provenance() -> str:
    """期首のシャードを作ったもの。**期首の取り決めも Rust と共有している。**"""
    return (
        f"{_provenance()}。"
        "ただし丸めの取り決め——毎期の利息を切り捨てること、積立を期首に"
        "置くときはその期の利息を積立額にも付けること、税を国税と地方税で別々に"
        "掛けること——は Rust と共有している(compound_ref の docstring が関数ごとに"
        "「独立: 不可能」と宣言している)。**このシャードが確かめるのは、Rust と"
        "Python の期首の腕が同じ手順で同じ答を出すことである。** 別手順の検算は"
        "`compound_ref.closed_form`(独立: 別手順、期首を持つ)が参照側のテストで持つ。"
    )


def build_finance_start_shard(seed: int, count: int) -> dict:
    """期首のシャード。**層を先に全部入れ、残りを乱択で埋める**(`build_finance_shard` と同じ流儀)。"""
    if len(FINANCE_START_STRATA) > count:
        raise RuntimeError(f"期首の層 {len(FINANCE_START_STRATA)} 件が総件数 {count} を超えている")
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    rejections: dict[str, object] = {
        "dup": 0,
        "reference_gave_up": {reason.value: 0 for reason in GaveUpReason},
    }
    for stratum in FINANCE_START_STRATA:
        params = stratum.build(rng, 0)
        key = repr((stratum.op, sorted(params.items())))
        if key in seen:
            continue
        seen.add(key)
        entries.append(_finance_entry(len(entries), stratum.op, params, stratum.key, "fin-start"))
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(f"期首: {attempts} 回試して {len(entries)}/{count} 件")
        op = rng.choice(COMPOUND_OPS)
        params = _compound_start_params(rng, op)
        key = repr((op, sorted(params.items())))
        if key in seen:
            rejections["dup"] += 1
            continue
        seen.add(key)
        try:
            entries.append(_finance_entry(len(entries), op, params, f"{op}/start_random", "fin-start"))
        except ReferenceGaveUp as gave_up:
            rejections["reference_gave_up"][gave_up.reason.value] += 1
    covered = covered_cells_from_cases(entries)
    exclusions = compound_deposit_for_exclusions(covered, compound_ref.START)
    gave_up = rejections["reference_gave_up"]
    coverage_payload = coverage.build_payload(
        FINANCE_START_MODEL,
        FINANCE_START_REQUIREMENTS,
        covered,
        exclusions,
        {
            "candidate_duplicate": rejections["dup"],
            "oracle_near_yen_boundary": gave_up["near_yen_boundary"],
            "oracle_search_limit": gave_up["compound_deposit_search_limit"],
        },
    )
    for summary in coverage_payload["requirements"]:  # type: ignore[attr-defined]
        if summary["unmet_cells"]:
            raise RuntimeError(
                f"期首 {summary['id']}: 未達セルが {summary['unmet_cells']} 件ある(設計書 §13.1)"
            )
    return {
        "schema": SCHEMA,
        "generated_by": _finance_start_provenance(),
        "rejections": rejections,
        "coverage": coverage_payload,
        "cases": entries,
    }
```

`covered_cells_from_cases` は op で要求を引くので、そのまま使える。

- [ ] **Step 4: `generate_corpus.py` で 20 枚目を書き出す**

`FINANCE_COUNT = 3500` の下に:

```python
# 期首のシャードの総件数(設計書 2026-09-10 §4.3)。**`finance-000.json` の複利の
# 件数(437 + 431 + 315 = 1,183)に揃えた出発点**で、被覆の門が通る最小ではない。
FINANCE_START_COUNT = 1200
```

`_shards` の `yield "finance-000.json", …` の直後に:

```python
    # **期首は別のシャード**(設計書 2026-09-10 §4.2)。`finance-000.json` を
    # 1 バイトも変えないために、seed も層も別に持つ。
    yield "finance-start-000.json", build_finance_start_shard(seed=20260910, count=FINANCE_START_COUNT)
```

`_shards` の docstring の「書き出す 18 枚を」を「書き出すシャードを」に、「18 枚ぶんの payload」を「全部の payload」に直す（**実際は 19 枚で、数が腐っていた。枚数を書かない**）。`build_finance_start_shard` を import 行に足す。

- [ ] **Step 5: 生成して、`finance-000.json` が動いていないことを確かめる**

```bash
cd reference && uv run --no-config python scripts/generate_corpus.py
cd .. && git status --porcelain corpus/generated/
```

Expected: `?? corpus/generated/finance-start-000.json` の 1 行だけ。`M` が 1 行でもあれば止める。

- [ ] **Step 6: 被覆の実数を固定する（測ってから書く）**

```bash
cd reference && uv run --no-config python -c "
import json; d = json.load(open('../corpus/generated/finance-start-000.json'))
print(len(d['cases']))
for r in d['coverage']['requirements']: print(r['scope'], r['covered_cells'], r['excluded_cells'], r['required_cells'])
import collections; print(collections.Counter(c['op'] for c in d['cases']))
"
```

印字された数を使って `test_generate_corpus.py` に足す:

```python
def test_the_start_coverage_totals_are_the_ones_we_measured() -> None:
    """**3 対象それぞれの数を固定する**(2026-09-10 実測)。"""
    got = {
        r["scope"]: (r["covered_cells"], r["excluded_cells"], r["required_cells"])
        for r in _start_shard()["coverage"]["requirements"]
    }
    assert got == {
        "compound_grow": (<印字の値>),
        "compound_deposit_for": (<印字の値>),
        "compound_periods_for": (<印字の値>),
    }
```

（`<印字の値>` は Step 6 の出力をそのまま写す。**推測で埋めない。**）

- [ ] **Step 7: 期首の答が期末と違うことを数える（期首の腕を本当に見ているか）**

```python
def test_most_start_answers_differ_from_the_end_answer() -> None:
    """**同じ入力を期末で解くと答が変わる**——このシャードが期首の腕を見ている証拠。
    金利 0 などでは同じになりうるので全件は求めず、実測の下限を置く。"""
    differ = 0
    normal = 0
    for c in _start_shard()["cases"]:
        if "error" in c["expect"]:
            continue
        normal += 1
        end = compound_ref.compute(c["op"], {**c["input"], "timing": "end"})
        if end != c["expect"]:
            differ += 1
    assert normal > 0
    assert differ >= <実測の下限>
```

`<実測の下限>` は一度 `differ` と `normal` を印字して、**実測値そのもの**を入れる（小さくは丸めない——減ったら気づけるように）。

- [ ] **Step 8: reference のゲート**

```bash
cd reference && uv run --no-config ruff check && uv run --no-config ruff format --check && uv run --no-config mypy && uv run --no-config pytest -q
cd .. && git status --porcelain reference/uv.lock   # 空
```

Expected: 全部緑。

### Task 9: 重量級に 20 枚目を受け取らせる

**Files:**
- Modify: `heavy/tests/corpus/corpus.ts`（`SUPPORTED_COVERAGE_MODELS`・`COVERAGE_REQUIRED_SHARDS`）
- Modify: `heavy/tests/corpus/calls.spec.ts`
- Modify: `heavy/scripts/detection-power.mjs`（`ALL_SHARDS` とその註）

- [ ] **Step 1: 被覆のモデルと必須シャードに足す**

`SUPPORTED_COVERAGE_MODELS` に `"finance-start-v1",`、`COVERAGE_REQUIRED_SHARDS` の `"finance-000.json",` の直後に `"finance-start-000.json",`。

- [ ] **Step 2: 証明書を金融の全シャードに掛ける（`finance-000.json` のテスト名は変えない）**

`calls.spec.ts` の `FINANCE_SHARD` の節を次に置き換える:

```ts
const FINANCE_SHARDS = SHARDS.filter(({ name }) => name.startsWith("finance-"));
const FINANCE_SHARD = FINANCE_SHARDS.find(({ name }) => name === "finance-000.json");
if (FINANCE_SHARD === undefined) {
  throw new Error(
    "calls.spec.ts: finance-000.json is not among the call shards — the " +
      "inverse certificates have nothing to certify.",
  );
}
const FINANCE_CASES = FINANCE_SHARD.shard.cases;

for (const { name, shard } of FINANCE_SHARDS) {
  for (const { op, build } of CERTIFICATES) {
    // **`finance-000.json` のテスト名は 1 文字も変えない**——報告書と
    // 変異の記録がその名前で赤を数えている。期首のシャードだけ名前に付ける。
    const title =
      name === "finance-000.json"
        ? `${op}'s answer is the boundary, not just a number`
        : `${op}'s answer in ${name} is the boundary, not just a number`;
    test(title, async ({ page }) => {
      await openHarness(page);
      const probes = build(shard.cases);
      // `loan_*` の証明書は期首のシャードに対象が無い(複利だけのシャード)。
      if (name !== "finance-000.json" && op.startsWith("loan_")) {
        expect(probes).toEqual([]);
        return;
      }
      expect(
        probes.length,
        `${op} in ${name}: built zero boundary checks — either the corpus has ` +
          `no normal ${op} cases, or the certificate is not wired up`,
      ).toBeGreaterThan(0);
      const mismatches = await runProbes(page, probes, CERT_BATCH);
      expect(
        mismatches,
        `${op} in ${name}: ${mismatches.length} of ${probes.length} boundary ` +
          "checks failed. Each line says which case, and which side of the " +
          "boundary (the answer itself, or one step past it), broke.",
      ).toEqual([]);
    });
  }
}
```

`CERTIFICATES` の `op` の綴りが `loan_` で始まることを実装の日に確かめる（違えば条件を合わせる）。

- [ ] **Step 3: 期首の被覆の実数を固定する**

`実物の finance-000.json が、測った数をそのまま載せている` の直後に、同じ形で `実物の finance-start-000.json が…` を足す。`coverage?.model` は `"finance-start-v1"`、`totals` は Task 8 Step 6 の印字の値。

- [ ] **Step 4: `ALL_SHARDS` とその註**

`"finance-000.json (calls)",` の直後に `"finance-start-000.json (calls)",`。註の「正当に 19 枚目を足す日には、ここの更新が意識的な 1 行になる。」を次に置き換える:

```
 * **正当にシャードを足す日には、ここの更新が意識的な 1 行になる。**それが
 * この定数の狙いである。**枚数は書かない**——「19 枚目を足す日には」と
 * 書いていた註は、19 枚目が入ったあとも同じ文のまま腐っていた
 * (2026-09-10、期首のシャード＝20 枚目を足す段で見つけた)。
```

- [ ] **Step 5: 重量級のコーパスを回す**

Run: `cd heavy && pnpm heavy 2>&1 | tail -6`
Expected: `every call in finance-start-000.json matches the reference` を含めて全部緑（本数は 257 + 期首の分）。**証明書の期首の 2 本（`compound_deposit_for` / `compound_periods_for` in finance-start-000.json）が緑**であることを見る。

- [ ] **Step 6: 赤を確かめる（証明書の timing）**

一時コミットの上で、Task 6 Step 4 で足した 2 行を消す → 期首の証明書が赤くなることを見る（期末の腕で検算するので境界がずれる）。**赤くならなかった場合、それ自体を報告する**（期首と期末で境界が偶然一致するケースしか無いということで、証明書が期首を見ていない）。戻しは再編集で。

### Task 10: 検出力——新しい変異と、反応したシャードの実測

**Files:**
- Modify: `heavy/scripts/detection-power.mjs`

- [ ] **Step 1: 変異 `compound-start-deposit-at-end` を足す**

`compound-deposit-at-start` の直後に:

```js
  {
    id: "compound-start-deposit-at-end",
    what: "期首の腕を期末と同じにする(積立に、その期の利息を付けない)",
    file: "crates/calcarc-core/src/finance/compound.rs",
    from: `    let balance = match timing {
        DepositTiming::End => balance,
        DepositTiming::Start => balance.checked_add(deposit).ok_or(CalcError::Overflow)?,
    };
    let interest = rate.interest_floor(balance)?;
    let balance = balance.checked_add(interest).ok_or(CalcError::Overflow)?;
    match timing {
        DepositTiming::End => balance.checked_add(deposit).ok_or(CalcError::Overflow),
        DepositTiming::Start => Ok(balance),
    }`,
    to: `    let balance = match timing {
        DepositTiming::End => balance,
        DepositTiming::Start => balance,
    };
    let interest = rate.interest_floor(balance)?;
    let balance = balance.checked_add(interest).ok_or(CalcError::Overflow)?;
    match timing {
        DepositTiming::End => balance.checked_add(deposit).ok_or(CalcError::Overflow),
        DepositTiming::Start => balance.checked_add(deposit).ok_or(CalcError::Overflow),
    }`,
    // **期首の腕を 2 本とも動かす**——片方だけだと「積立が消える」別の、
    // はるかに大きい壊れ方になる(`compound-deposit-at-start` の当て直しで
    // 確かめた教訓と同じ)。**期末の変異と組で、腕の独立を両方向から見る**:
    // これは期首のシャードだけで赤く、`compound-deposit-at-start` は
    // `finance-000.json` だけで赤い(設計書 2026-09-10 §4.5)。
    expectShards: ["finance-start-000.json (calls)"],
  },
```

- [ ] **Step 2: 手元で `heavy:power` を回して反応を測る**

Run: `cd heavy && pnpm heavy:power 2>&1 | tail -5`（約 11〜15 分）。**segfault したら、Task 10 を CI の最初の走行へ回す**（下限 1 のまま出し、実測が来てから Step 3）。

期待と違う反応が出るのは想定のうち（`verdictFor` が赤を返しても `detection-power.json` は書かれる）。反応を読む:

```bash
cd heavy && node -e '
const d = JSON.parse(require("fs").readFileSync("detection-power.json","utf8"));
for (const r of d.results) if (Object.keys(r.caught).some(k => k.startsWith("finance-")))
  console.log(r.id.padEnd(36), JSON.stringify(r.caught), r.ok ? "ok" : "NG: " + r.why);
'
```

- [ ] **Step 3: 実測から `expectShards` と `minRate` を書く**

各金融の変異について:

- **反応したシャードの集合をそのまま `expectShards` にする**（推測で足さない）。
- `finance-000.json (calls)` の `minRate` は**動かさない**。**件数が 09-10 の値（`compound-deposit-at-start` 910、`round-once` 612、`binary-search` 1 ほか）から動いていないこと**を確かめる。動いていたら止めて報告する。
- `finance-start-000.json (calls)` の `minRate` は `Math.floor(caught / 総件数 * 1000) / 1000`。0 になるなら置かない（下限 1）。
- **`compound-deposit-at-start` が期首のシャードで反応していたら止める**——期末の腕が期首に漏れている（腕の独立が崩れている）。
- **`compound-start-deposit-at-end` が `finance-000.json` で反応していたら止める**——同じ理由の逆向き。
- 変異ごとの註に、測った日・件数・総件数を書く（`compound-deposit-at-start` の註と同じ形）。

- [ ] **Step 4: もう一度回して全部「期待どおり」**

Run: `cd heavy && pnpm heavy:power 2>&1 | tail -3`
Expected: 失敗 0。

### Task 11: 実画面——積立の位置を毎回押し、期首を 3 件打つ

**Files:**
- Modify: `heavy/tests/ui/finance-cases.ts`
- Modify: `heavy/tests/ui/finance-ui.spec.ts`
- Modify: `heavy/tests/unit/heavy-ui-finance.test.ts`

**Interfaces:**
- Consumes: `timingOf`（Task 6、`heavy/harness/timing.ts`）
- Produces: `TIMING_KEY`、`pickStartCase(face, cases): CallCase`

- [ ] **Step 1: 失敗する単体テストを書く**

`heavy-ui-finance.test.ts` の `describe("keySequence", …)` に:

```ts
  it("always presses a deposit-timing key, because the choice outlives the page", () => {
    // **選択は localStorage に保存され、開き直しても残る。** 期首のケースの
    // あとの期末のケースが期首で打たれないよう、既定を仮定せず毎回押す。
    const grow = FACES.find((face) => face.op === "compound_grow");
    if (grow === undefined) throw new Error("no compound_grow face");
    const end = keySequence(grow, growCase({}));
    expect(end).toContain(TIMING_KEY.end);
    const start = keySequence(grow, growCase({ timing: "start" }));
    expect(start).toContain(TIMING_KEY.start);
    expect(start).not.toContain(TIMING_KEY.end);
  });
```

`describe("expressible", …)` に:

```ts
  it("accepts the deposit timing as a choice, not as a field to type", () => {
    const grow = FACES.find((face) => face.op === "compound_grow");
    if (grow === undefined) throw new Error("no compound_grow face");
    expect(expressible(grow, growCase({ timing: "start" }))).toBe(true);
    expect(expressible(grow, growCase({ timing: "sometime" }))).toBe(false);
  });
```

`describe("pickStartCase", …)` を新しく:

```ts
describe("pickStartCase", () => {
  it("takes the middle passing start case of the face's op", () => {
    const grow = FACES.find((face) => face.op === "compound_grow");
    if (grow === undefined) throw new Error("no compound_grow face");
    const cases = [0, 1, 2].map((n) => ({ ...growCase({ timing: "start" }), id: `s-${n}` }));
    expect(pickStartCase(grow, cases).id).toBe("s-1");
  });
  it("refuses to run when the corpus has no start case for the face", () => {
    const grow = FACES.find((face) => face.op === "compound_grow");
    if (grow === undefined) throw new Error("no compound_grow face");
    expect(() => pickStartCase(grow, [growCase({})])).toThrow(/start/);
  });
});
```

`growCase` は同ファイルに無ければ足す:

```ts
const growCase = (extra: Record<string, string>): CallCase =>
  ({
    id: "g-1",
    op: "compound_grow",
    input: {
      principal: "1000000",
      deposit: "10000",
      rate: "3.0",
      periods_per_year: 12,
      periods: 120,
      tax: false,
      ...extra,
    },
    expect: { final_balance: "1", net: "1" },
  }) as unknown as CallCase;
```

Run: `cd heavy && pnpm vitest run tests/unit/heavy-ui-finance.test.ts`
Expected: FAIL（`TIMING_KEY` / `pickStartCase` が無い）

- [ ] **Step 2: `finance-cases.ts` を変える**

`TAX_KEY` の下に:

```ts
/**
 * 積立の位置の 2 キー(`web/src/ui/Keypad/finance.ts` の `timing:*`)。
 *
 * **毎回どちらかを押す。** 選択は `localStorage` に保存され、ページを開き
 * 直しても残る——期首のケースのあとの期末のケースが、期首のまま打たれる
 * (設計書 2026-09-10 §4.6)。税を毎回押しているのと同じ理由である。
 */
export const TIMING_KEY = {
  end: "積立を期末に行う",
  start: "積立を期首に行う",
} as const;
```

`CHOSEN_NOT_TYPED` を `new Set(["periods_per_year", "tax", "timing"])` に。`expressible` の入力のループの `if (key === "tax") continue;` の直後に:

```ts
    if (key === "timing") {
      if (value !== "end" && value !== "start") return false;
      continue;
    }
```

`keySequence` の `keys.push("複利の周期と積立の位置を選ぶ", period);` を:

```ts
    keys.push(
      "複利の周期と積立の位置を選ぶ",
      period,
      TIMING_KEY[timingOf(input)],
    );
```

にし、`import { timingOf } from "../../harness/timing";` を足す。`pickCases` の下に:

```ts
/**
 * **期首の正常ケースを 1 件、真ん中から引く**(設計書 2026-09-10 §4.6)。
 * 期首のシャードは複利だけで、異常ケースを持つとは限らないので正常だけを見る。
 */
export function pickStartCase(face: FinanceFace, cases: CallCase[]): CallCase {
  const pool = cases.filter(
    (testCase) =>
      testCase.op === face.op &&
      testCase.input.timing === "start" &&
      !("error" in testCase.expect) &&
      expressible(face, testCase),
  );
  const chosen = pool[Math.floor(pool.length / 2)];
  if (chosen === undefined) {
    throw new Error(
      `finance-ui: the corpus has no passing start case for ${face.op} that ` +
        "this panel can express — the start faces would verify nothing.",
    );
  }
  return chosen;
}
```

- [ ] **Step 3: `finance-ui.spec.ts` を変える**

`financeCases` の定義の下に:

```ts
/** **既存の 16 件は `finance-000.json` からだけ引く**——期首を足しても 1 件も変えない。 */
const endCases: CallCase[] = loadCallShards()
  .filter(({ name }) => name === "finance-000.json")
  .flatMap(({ shard }) => shard.cases);
const startCases: CallCase[] = loadCallShards()
  .filter(({ name }) => name === "finance-start-000.json")
  .flatMap(({ shard }) => shard.cases);
```

`const picks = FACES.map((face) => pickCases(face, financeCases));` を `pickCases(face, endCases)` に。既存の `for (const { face, normal, error } of picks)` の後に:

```ts
for (const face of FACES.filter((f) => f.compound)) {
  const start = pickStartCase(face, startCases);
  test(`${face.op}: ${where(start)} typed on the real panel, deposit at the start`, async ({
    page,
  }) => {
    await typeCase(page, face, start);
    await expect(main(page)).not.toHaveText("");
    expect(readAnswer(await main(page).innerText())).toEqual(
      expectedAnswer(face, start),
    );
  });
}
```

（既存の正常ケースのテスト本文が「答が出るまで待つ」書き方をしていれば、その待ち方をそのまま写す。）`pickStartCase` を import に足す。

- [ ] **Step 4: 単体・型・lint**

Run: `cd heavy && pnpm test && pnpm typecheck && pnpm lint`
Expected: 全部緑。

- [ ] **Step 5: 実画面は手元で回さない**

`finance-ui.spec.ts` の確認は **CI の `Heavy corpus` の最初の走行**で行う（Global Constraints）。報告では「未確認」と書く。

### Task 12: 記録とゲートとコミット

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-independent-verification-gaps-design.md`（§4.7・§4.8 に実測を書き戻す）
- Modify: `docs/superpowers/sdd/heavy-HANDOFF.md` §2（現在地）
- Modify: `docs/corpus-measurements.md`（期首のシャードの件数・被覆・検出）

- [ ] **Step 1: 実測を書き戻す**

§4.7 の「新しい表」に Task 8 Step 6 の件数（op ごと）を、§4.8 に Task 10 の反応と件数を書く。`heavy-HANDOFF.md` §2 には「期首のシャードを足した（20 枚目）。`heavy:ui` の期首 3 件は CI の最初の走行で確かめる（未確認）」を §7 の書き方（§2 に置いて、測ったら消す）で。

- [ ] **Step 2: 全部のゲート**

```bash
cargo test --workspace
cd web && pnpm typecheck && pnpm lint && pnpm test && cd ..
cd heavy && pnpm test && pnpm typecheck && pnpm lint && pnpm heavy && cd ..
cd reference && uv run --no-config pytest -q && cd ..
node tools/check-version.mjs && node tools/check-boundary.mjs && node tools/check-citations.mjs
git status --porcelain reference/uv.lock   # 空
git diff --stat origin/main -- corpus/generated/finance-000.json   # 空
```

- [ ] **Step 3: コミット**

`finance-start-000.json` と生成器・重量級の変更を 1 本（Task 7〜11）、記録を 1 本に分けてコミットする。件名の例: "Add the start-of-period finance shard as a twentieth corpus shard" / "Record what the start shard measured"。

---

## 引き渡し

各 PR の終わりに、先端の SHA・回したゲート・**回していないもの（とくに `heavy:ui`）**・赤を確かめた変異を監視役へ報告する。push と PR は利用者の手番。
