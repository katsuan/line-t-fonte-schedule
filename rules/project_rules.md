# T-FONTE_reminder Project Rules

## 目的

このファイルは、共通 `RULES` を `T-FONTE_reminder` 向けに具体化したローカルルールです。
GAS と LINE メッセージ生成が中心のため、責務分離、設定管理、メッセージ体験、運用時の安全性を明確にします。

参照元（開発者がローカルで管理する共通 RULES、プロジェクト外の内部資産、非公開）:

- 共通 RULES: `01_architecture_and_implementation_rules.md`
- 共通 RULES: `04_naming_and_directory_rules.md`
- 共通 RULES: `05_messaging_experience_rules.md`

## ファイル命名（レイヤー番号）

共通 RULES の `04_naming_and_directory_rules.md` に従い、先頭番号でレイヤーを表す。

- `00_*` 共通設定・ロガー・デバッグログ
- `10_*` ドメインロジック
- `20_*` ルーティング
- `30_*` Web入口・Flex表示整形

`00_const.gs` はグローバル定数の初期化を持つため、番号にかかわらず他ファイルより先に評価される前提を崩さない（`const` を伴うトップレベル参照を追加する場合は評価順に注意する）。

## このプロジェクトで固定する責務

- `00_const.gs`
  Spreadsheet・設定値・quick reply アクションなどのグローバル初期化だけを持つ
- `00_LoggerLib.gs`
  ログ初期化だけを持つ
- `00_debugLog.gs`
  スプレッドシート(`DebugLog`シート)への簡易ログ出力だけを持つ
- `10_reminderCore.gs`
  予定取得、キャッシュ、リマインド判定、テキスト文面生成の共通ロジックを持つ
- `11_scheduleRegistration.gs`
  `#予定登録`テキストのパース、確認待ちデータの一時保存（CacheService）、`#予定確定`/`#予定キャンセル`によるシート書き込み・破棄を持つ
- `20_handleTextMessage.gs`
  テキスト入力の解釈と、どのメッセージ生成処理を呼ぶかのルーティングだけを持つ
- `30_webappFlexEndpoint.gs`
  Web App 入口と、Flex Message 用の整形・表示ロジックを持つ

## 追加ルール

### 1. 入口は薄く保つ

- `doGet` と `handleTextMessage` に業務判断を増やしすぎない
- 新しい入力トリガーは、条件分岐を直書きで増やす前にルーティング関数へ集約する
- 将来 `doPost` や定期実行の入口が増えても、共通ロジックは `10_reminderCore.gs` か専用関数へ寄せる

### 2. 予定データの取得と表示整形を分ける

- Spreadsheet 読み取り、Properties キャッシュ、天気 API 呼び出しは取得責務として扱う
- 月別グルーピング、表示件数制御、altText 組み立て、Flex bubble 組み立ては表示責務として扱う
- 表示都合の値を、リマインド送信判定の条件として逆流させない

### 3. 設定値は意味ごとにまとめる

- UI 設定は `FLEX_CONFIG` や `AUTO_REMINDER_GUIDE_CONFIG` のように用途別に持つ
- キャッシュや保持日数のような運用設定は `10_reminderCore.gs` 側へ置く
- Script Properties に置くべき値はコードへ直書きしない

### 4. メッセージ体験は「確認しやすさ」を優先する

- 予定一覧は比較しやすい順序で並べる
- 最後のメッセージに quick reply を付け、次の行動を切らさない
- 自動送信向けメッセージでは、送信される本文と遷移先が追えるガイドを維持する

### 4.1 LIFF / shareTargetPicker の送信制約

- LIFF 画面のプレビュー用 JSON と、`shareTargetPicker` に渡す送信用 JSON は別物として扱う
- 送信用 JSON は表示再現よりも送信成功率を優先して削る
- 送信用に残すリンクは footer 配下の `button` + `uri` のみとし、それ以外の `action` は落とす
- 送信用 Flex は carousel のまま渡さず、必要に応じて bubble 単位へ分解する
- 送信不能の切り分け時は、まず `docs/backups/` へ現状 HTML を退避してから調整する

### 5. GAS 運用ルール

- ローカルファイルを正本とし、Apps Script エディタだけで修正を完結させない
- `appsscript.json` と `.gs` ファイルの責務差を README に残す
- キャッシュキーや保存形式を変える場合は、既存 Script Properties への影響を明示する

## リファクタリング方針

- 1 回の変更で責務をまたぐ巨大改修は避ける
- まず重複除去、命名改善、入口の簡素化から進める
- ファイル分割を行う場合は、README とこのルールの責務定義を同時に更新する

## 次に分割候補となる領域

- `10_reminderCore.gs` 内の weather 取得まわり
- `10_reminderCore.gs` 内の upcoming records cache まわり
- `30_webappFlexEndpoint.gs` 内の Flex bubble renderer 群
