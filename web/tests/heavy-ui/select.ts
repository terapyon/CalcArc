import { REQUIRED_KEYS } from "./presses";

/**
 * **代表の選び方だけを、コーパスの読み込みから切り離す。**
 *
 * `sampling.ts` はシャードをディスクから読むので、走行の外からは動かせない
 * (vitest は `import.meta.url` を `file:` で渡さない)。選び方そのものは
 * ディスクに触らない純関数なので、ここに置いて `tests/unit/` から確かめる。
 */

/** 等間隔に選ぶ。先頭だけ通すと、生成の後半の形をまったく踏まない。 */
function spread(count: number, length: number): number[] {
  const step = length / count;
  return Array.from({ length: count }, (_, i) => Math.floor(i * step));
}

/**
 * **必須キーを含むケースを先に確保してから、残りを等間隔で埋める。**
 *
 * 等間隔に選ぶだけだと、必須キーを含むケースが 1 件も選ばれないことが
 * ありうる。実測では既定の 100 件でたまたま 8 キーすべてが選ばれていたが、
 * それは**コーパスの並びに依存した偶然**である——`del` は打鍵可能な
 * 33,000 件のうち 3 件にしか現れず、その 3 件は 36 件しかないシャードに
 * 居るから全部選ばれていただけで、シャードが育てば真っ先に落ちる。
 *
 * **確保は上限(`count`)の内側で行う。** 確保した分だけ等間隔の網が粗く
 * なるが、必須キーは高々 9 件なので既定の 100 件に対して 1 割に満たない。
 */
export function selectSample<T extends { keys: string[] }>(
  items: T[],
  count: number,
): T[] {
  if (items.length <= count) {
    return items;
  }
  const chosen = new Set<number>();
  for (const { token } of REQUIRED_KEYS) {
    if (chosen.size >= count) {
      break;
    }
    const index = items.findIndex((item) => item.keys.includes(token));
    if (index >= 0) {
      chosen.add(index);
    }
  }
  for (const index of spread(count, items.length)) {
    if (chosen.size >= count) {
      break;
    }
    chosen.add(index);
  }
  return [...chosen].sort((a, b) => a - b).map((index) => items[index] as T);
}
