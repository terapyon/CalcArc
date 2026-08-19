import type { ModuleId } from "../../route";
import styles from "./Nav.module.css";

// **一時的な再 export。Task 3 で消す。**
// これが無いと、まだ Nav から ModuleId を取っている App.tsx が Task 2 の
// コミット時点で型検査に落ちる。**全コミットを緑に保つ**ためだけの 1 行で、
// 恒久的な依存ではない(ハッシュの語彙はルーティングの持ち物である)。
export type { ModuleId };

// タブの表示ラベルはモジュールの固有名詞なので英語のまま
// (アクセシブルネームは <nav> 側の aria-label で日本語にする)。
//
// **href は既定カテゴリまで書く**(設計書 §3)。`#scale` だと同じ画面に
// URL が 2 つでき、E2E の toHaveURL 期待がその曖昧さを引き継ぐ。
const MODULES: { id: ModuleId; href: string; label: string }[] = [
  { id: "scientific", href: "#scientific", label: "Scientific" },
  { id: "convert", href: "#convert", label: "Convert" },
  { id: "scale", href: "#scale/data-scale", label: "Scale" },
  { id: "finance", href: "#finance", label: "Finance" },
];

export function Nav({ current }: { current: ModuleId }) {
  return (
    <nav aria-label="計算機の切り替え" className={styles.nav}>
      {MODULES.map((m) => (
        <a
          key={m.id}
          href={m.href}
          aria-current={m.id === current ? "page" : undefined}
          className={styles.tab}
        >
          {m.label}
        </a>
      ))}
    </nav>
  );
}
