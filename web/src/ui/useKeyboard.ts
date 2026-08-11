import { useEffect, useRef } from "react";
import type { KeyToken } from "../calc";

/**
 * 物理キーボードのキーと calcarc-core のトークンの対応。
 *
 * 画面のボタンと同じトークンに写像するため、engine から見れば
 * どちらの経路で押されたかの区別は存在しない(設計書 §3.4)。
 */
export const KEYBOARD_MAP: Readonly<Record<string, KeyToken>> = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  ".": "dot",
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "=": "eq",
  Enter: "eq",
  Backspace: "del",
  Escape: "ac",
  "(": "lparen",
  ")": "rparen",
  j: "j",
  J: "j",
};

/**
 * 物理キーボードからの入力を受け付ける(base-spec §43、§50)。
 */
export function useKeyboard(onPress: (token: KeyToken) => void): void {
  // コールバックを ref 越しに呼び、リスナ自体は一度しか貼らない。
  //
  // 依存に onPress を置いて貼り直すと、貼り直しが走るのは描画の「後」なので、
  // 画面が更新されてから新しいリスナが付くまでのあいだ、打鍵が古い
  // コールバックに流れる。CI で実際にこれが起き、WASM の読み込み直後に
  // 打った先頭 2 文字が preventDefault されたうえ握り潰された。
  const latest = useRef(onPress);
  useEffect(() => {
    latest.current = onPress;
  });

  useEffect(() => {
    function handle(event: KeyboardEvent) {
      // ブラウザのショートカットを奪わない。
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      // ボタンにフォーカスがある状態の Enter は、そのボタン自身の起動に譲る。
      // window で捕まえて preventDefault すると、Tab で ▸∠ に移動して
      // Enter を押した人に = が実行されてしまい、キーボードだけでは
      // 極形式に切り替えられなくなる(base-spec §43 の Focus handling)。
      //
      // Enter に限定するのが要点。「ボタンにフォーカスがあれば全部無視」に
      // すると、マウスでキーを押した直後(フォーカスがそのボタンに残る)に
      // 数字が打てなくなり、操作が途切れる。
      if (
        event.key === "Enter" &&
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      ) {
        return;
      }
      const token = KEYBOARD_MAP[event.key];
      if (!token) {
        return;
      }
      // "/" のクイック検索や Backspace の戻るを抑える。
      event.preventDefault();
      latest.current(token);
    }

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
}
