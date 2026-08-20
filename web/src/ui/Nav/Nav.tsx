import type { ModuleId } from "../../route";
import styles from "./Nav.module.css";

// タブの表示ラベルはモジュールの固有名詞なので英語のまま
// (アクセシブルネームは <nav> 側の aria-label で日本語にする)。
//
// **href は既定カテゴリまで書く**(設計書 §3)。`#scale` だと同じ画面に
// URL が 2 つでき、E2E の toHaveURL 期待がその曖昧さを引き継ぐ。
//
// `Record<ModuleId, ...>` にしているのは、系統を 1 つ書き忘れたら
// typecheck が落ちるようにするため——配列だと 1 件抜けても型は通る。
const MODULES: Record<ModuleId, { href: string; label: string }> = {
  scientific: { href: "#scientific", label: "Scientific" },
  convert: { href: "#convert/length", label: "Convert" },
  scale: { href: "#scale/data-scale", label: "Scale" },
  finance: { href: "#finance", label: "Finance" },
};

// 描画順は MODULES(Record)の鍵から取る。順序だけの配列を別に持つと
// MODULES と食い違いうるので持たない——ORDER の網羅性は MODULES が
// `Record<ModuleId, ...>` である(1 系統でも欠けたら typecheck が落ちる)
// ことに乗って保証される。
const ORDER: readonly ModuleId[] = Object.keys(MODULES) as ModuleId[];

export function Nav({ current }: { current: ModuleId }) {
  return (
    <nav aria-label="計算機の切り替え" className={styles.nav}>
      {ORDER.map((id) => {
        const m = MODULES[id];
        return (
          <a
            key={id}
            href={m.href}
            aria-current={id === current ? "page" : undefined}
            className={styles.tab}
          >
            {m.label}
          </a>
        );
      })}
    </nav>
  );
}
