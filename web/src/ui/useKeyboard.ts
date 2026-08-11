import { useEffect } from "react";
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
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      // ブラウザのショートカットを奪わない。
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const token = KEYBOARD_MAP[event.key];
      if (!token) {
        return;
      }
      // "/" のクイック検索や Backspace の戻るを抑える。
      event.preventDefault();
      onPress(token);
    }

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onPress]);
}
