# sw-navigation-fallback 修正報告

## ステータス

DONE

## コミット

`9348d0d` — Stop the service worker from answering /ogp.png with the app
ブランチ: `fix/sw-navigation-fallback`（push なし）

変更ファイル:
- `web/vite.config.ts` — `navigateFallback: "index.html"` の直後に
  `navigateFallbackDenylist: [/\.[^/]+$/]` を追加。
- `web/scripts/check-sw.mjs` — precache 検査（既存の 2 番）の直後に
  navigation fallback の除外を確認する検査を追加。
- `web/tests/e2e/pwa.spec.ts` — SW を実登録した上で `/ogp.png` に直接
  `goto` し、`content-type: image/png` が返ることを確認する E2E を追加。

## Step 3 の番号付け

既存の検査は 1（即時活性化なし）、2（precache に wasm）、3（manifest の
中身、コメント無番号の塊）の順。新しい検査は precache（2 番）の直後、
manifest ブロックの直前に置きたかったので、manifest ブロックのコメントを
「3. manifest の中身。」→「4. manifest の中身。」に振り直し、空いた 3 番を
新しい検査に割り当てた。manifest ブロックの見出しコメントは 1 行だけの
変更で済んだため、「2.5」のような変則番号を避けて連番を保つ方を選んだ。

## 赤確認の結果

**Step 5（check:sw）**: `navigateFallbackDenylist` の行を一時的に削除して
再ビルドし、`pnpm check:sw` を実行。

```
check:sw NG — sw.js の navigation fallback に除外が無い(navigateFallbackDenylist を確認。/ogp.png のような実ファイルが index.html にすり替わる)
 ELIFECYCLE  Command failed with exit code 1.
exit=1
```

期待通りに落ちた。再編集で行を戻し、再ビルド後 `check:sw OK` に戻ることを
確認済み。

**Step 6（E2E）追加確認**: 同じ削除状態で新しい E2E テストのみを実行。

```
Error: expect(received).toContain(expected) // indexOf
Expected substring: "image/png"
Received string:    "text/html;charset=utf-8"
```

症状報告そのもの（画像のはずが index.html＝アプリの HTML が返る）を
そのまま再現して落ちた。これも再編集で戻し、5 件全て green に復帰した
ことを確認済み。

## Step 6: E2E を書いたか

**書いた。** `web/tests/e2e/pwa.spec.ts` に
「an image path opened directly is not swallowed by the navigation
fallback」を追加。既存の「the service worker registration becomes ready」
と同じ手筋（`navigator.serviceWorker.ready` を待ってから操作）が使えたため
難航はしなかった。

書けた理由:
- 同ファイルの既存テストが SW の登録・活性化待ちのパターン
  （`page.evaluate(() => navigator.serviceWorker.ready)`）を既に持っていた
  ので、そこに `page.goto("/ogp.png")` を続けるだけで済んだ。
- 検証したい入力（アドレスバーへの直接入力）は Playwright の
  `page.goto()` がそのまま模擬できる。`page.request.get()` は使っていない
  ——これは SW を経由しない生 HTTP クライアントで、curl と同じく症状を
  再現できない（実際に一度これで書きかけて気づいた）。`page.goto()` の
  返す `Response` はブラウザのナビゲーションが実際に受け取ったものなので、
  SW 越しの応答を正しく観測できる。

Step 3（check:sw、成果物に除外があることの確認）と Step 6（E2E、実際に
その除外がブラウザの挙動を変えることの確認）の 2 層が揃ったので、
「workbox の仕様を信じるだけ」の状態ではなくなった。これで十分と判断する
——E2E が navigation リクエスト経由での応答を直接検証しているため、
workbox の内部実装の詳細（sw.js の生成のされ方）に依存せずに挙動を
固定できている。

## 検証ログ（Step 7）

```
pnpm typecheck   → 通過
pnpm lint        → Checked 85 files, No fixes applied
pnpm test        → 17 files / 159 tests 全て pass
pnpm exec vite build → 成功
pnpm check:sw    → check:sw OK — prompt 形 / wasm precache / manifest 完備
pnpm check:version → version 0.2.0 (Cargo.toml と web/package.json が一致)
pnpm exec playwright test pwa.spec.ts → 5 passed（新規テスト含む）
```

版数は 0.2.0 のまま変更なし。

## 備考

作業ディレクトリに `docs/unit-data-sscal-spec.md` という未追跡ファイルが
あったが、本タスクと無関係なため今回のコミットには含めていない
（そのまま作業ツリーに残してある）。

## 追記: レビュー Minor 対応（コミット `af3547e`）

レビュアー指摘: `NavigationRoute` の除外判定対象は workbox のバンドル上
`url.pathname + url.search`（クエリを含む、ハッシュは含まない）。
`vite.config.ts` のコメントは「パスにドットが入る経路が無い」としか書いて
おらず、クエリを勘定に入れていなかった。いまは無害（`?sw-toast=preview` に
ドットは無い）だが、将来 `?v=1.2.3` のようなクエリ付きリンクを足した人が
その 1 本だけ SPA フォールバックが黙って外れることに気づけない、という
指摘。

`web/vite.config.ts` の `navigateFallbackDenylist` 直前のコメントに、
判定対象が pathname + search でありクエリが対象に入ること、
`?v=1.2.3` のようなドット入りクエリを足すとその 1 本だけフォールバックが
外れることを追記した。コメントのみの変更のため `pnpm exec vite build &&
pnpm check:sw` は当然緑（確認済み、`check:sw OK`）。新規コミット
`af3547e`（`--amend` は使わず）。
