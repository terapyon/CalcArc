# セキュリティの報告 / Security Policy

**[English](#english)**

## 報告のしかた

**脆弱性は公開の Issue に書かないでほしい。** 次の窓口から、非公開で報告できる。

**https://github.com/terapyon/CalcArc/security/advisories/new**

（リポジトリの **Security** タブ → **Report a vulnerability** と同じ場所である。）
報告は管理者にだけ見え、直すまで公開されない。日本語でも英語でも構わない。

書いてもらえると助かること:

- 何が起きるか（何が読める・書き換えられる・実行される か）
- 再現の手順（開いた URL、押したキー、使ったブラウザと版）
- 確かめた CalcArc の版（画面の下部の「CalcArc ○○ について」の ○○、または
  `https://calc.terapyon.net/build-info.json` の `commit`）

## 対象の版

**直すのは最新版だけである。** 本番 `https://calc.terapyon.net/` が配っている版と、
[Releases](https://github.com/terapyon/CalcArc/releases) の最新版がそれにあたる。
古い版へは直しを戻さない——直した版を新しいパッチ版として出す。

## 対象の範囲

CalcArc はブラウザの中だけで動く。**サーバを持たず、計算した値を送信しない。**
ほかのサイトへ出る通信は、為替レートの取得（`open.er-api.com`、ExchangeRate-API）だけである。
そのため、主に次を対象とする。

- **配信物**: `calc.terapyon.net` が配るページ・スクリプト・Service Worker
  （例: URL から入った値でスクリプトが動く、端末に保存した設定や履歴が
  ほかのサイトから読める）
- **依存**: 配信物に入る npm・Rust の依存
- **配る経路**: GitHub Actions のワークフローと、タグから本番へ出る扉
  （[docs/deploy.md](docs/deploy.md)）

次は対象外で、ふつうの [Issue](https://github.com/terapyon/CalcArc/issues) で受ける。

- **計算結果の誤り。** 計算結果は無保証である（[README](README.md)）。
  間違いを見つけたら、押したキーの順を添えて Issue へ
- 為替レートの値そのもの（取得元の値をそのまま使う）
- 最新版でない版だけに在る問題

## 返事について

**個人で運営しているので、返事までの日数は約束しない。** 受け取ったら、
まず受け取ったことを返す。直したら、報告者と相談のうえで
GitHub Security Advisory として公開し、望まれれば報告者の名前を載せる。

---

<a id="english"></a>

## Reporting a vulnerability

**Please do not report vulnerabilities in public issues.** Report them privately here:

**https://github.com/terapyon/CalcArc/security/advisories/new**

(This is the same as the repository's **Security** tab → **Report a vulnerability**.)
Only the maintainer can see the report, and it stays private until a fix is released.
Japanese or English is fine.

It helps to include:

- What happens (what can be read, changed, or executed)
- Steps to reproduce (the URL you opened, the keys you pressed, the browser and its version)
- The CalcArc version you checked (the number in "CalcArc x.y.z について" at the bottom
  of the screen, or `commit` in `https://calc.terapyon.net/build-info.json`)

## Supported versions

**Only the latest version is fixed.** That is the version served at
`https://calc.terapyon.net/` and the latest one in
[Releases](https://github.com/terapyon/CalcArc/releases).
Fixes are not backported; they ship as a new patch release.

## Scope

CalcArc runs entirely in the browser. **It has no server and does not send your
calculations anywhere.** The only request to another site fetches exchange rates
(`open.er-api.com`, by ExchangeRate-API). The main areas in scope are:

- **What is served**: the pages, scripts, and Service Worker served by `calc.terapyon.net`
  (e.g., a value from a URL causing script execution, or settings and history saved on
  the device being readable by another site)
- **Dependencies**: npm and Rust dependencies that end up in what is served
- **The delivery path**: the GitHub Actions workflows and the tag-only path to production
  ([docs/deploy.md](docs/deploy.md), in Japanese)

Out of scope — please use a regular [issue](https://github.com/terapyon/CalcArc/issues):

- **Wrong calculation results.** Results come with no warranty ([README](README.en.md)).
  If you find one, open an issue with the keys you pressed, in order
- The exchange-rate values themselves (they are used as the provider returns them)
- Problems that exist only in versions other than the latest

## Response

**This project is run by one person, so no response time is promised.** You will first
get an acknowledgement. Once fixed, the issue will be published as a GitHub Security
Advisory after discussing it with you, crediting you if you wish.
