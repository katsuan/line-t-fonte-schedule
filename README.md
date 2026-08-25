# T-FONTE_reminder

Google Apps Script で動く、予定リマインド配信プロジェクトです。
Spreadsheet の予定を読み取り、LINE 向けのテキスト通知と Flex Message を生成します。

## Structure

ファイル名の先頭番号はレイヤーを表す（共通 RULES の `04_naming_and_directory_rules.md` 準拠）。

- `00_*` 共通設定・ロガー・デバッグログ
- `10_*` ドメインロジック（予定取得・リマインド判定・予定登録パース）
- `20_*` ルーティング（テキストトリガー解釈）
- `30_*` Web入口・Flex表示整形

同じ番号内の並びは責務の近さを表し、実行順を厳密に保証するものではない（`00_const.gs` はグローバル定数の初期化が他ファイルより先に必要なため、番号にかかわらず必ず最初に評価される前提を保つ）。

- `00_const.gs`
  Spreadsheet・設定値・アイコン・quick reply アクションなどのグローバル初期化
- `00_LoggerLib.gs`
  Logger 初期化
- `00_debugLog.gs`
  親プロジェクトの実行ログを確認できない場合向けの、スプレッドシート(`DebugLog`シート)への簡易ログ出力
- `10_reminderCore.gs`
  予定取得、キャッシュ、リマインド判定、テキスト文面生成
- `11_scheduleRegistration.gs`
  `#予定登録` からのテキスト予定一括登録（パース・確認保留・確定書き込み）
- `20_handleTextMessage.gs`
  テキストトリガーのルーティング
- `30_webappFlexEndpoint.gs`
  Web App 入口と Flex Message の整形
- `appsscript.json`
  Apps Script マニフェスト
- `rules/project_rules.md`
  このプロジェクト専用のローカル RULES
- `docs/backups/`
  大きな送信仕様変更や LIFF 切り分け前の退避ファイル置き場

## 版情報

- デプロイ時に `version.json`（commit SHA・生成時刻）を公開ページ直下に生成する（`.github/workflows/deploy-pages.yml`）
- 公開ページの版確認は `<公開URL>/version.json` を参照する
- この仕組みは LearningPlatform の `docs/version.json` 自動更新パターンを移植したもの（2026-08-15）

## Rules

共通ルールは、開発者がローカルで管理する共通 RULES（プロジェクト外の内部資産、非公開）を参照し、このプロジェクトでは [rules/project_rules.md](rules/project_rules.md) を追加ルールとして扱います。

特に次を固定方針にします。

- 入口は薄くし、取得・判定・表示を分ける
- GAS のローカルソースを正本にする
- Flex Message の表示都合を判定ロジックへ混ぜない
- quick reply や導線付きメッセージで次の操作を切らさない
- `shareTargetPicker` 向け送信データは、表示用 Flex と分けて安全側へ整形する

## Entry Points

- `doGet`
  Web App から Flex Message JSON を返す
- `handleTextMessage`
  チャット上のテキストトリガーを解釈して返答メッセージを選ぶ
- `main`
  定期実行を想定した自動リマインド送信処理

## Config And Dependencies

- タイムゾーンは `Asia/Tokyo`
- 外部ライブラリは `LINE_func`, `LineApiDriver`, `LoggerLib`
- 環境依存値は `SETTING`, `SHEETS`, `ACTIONS`, `SENDERS`, `LIFF_URLS`, `WEATHER_CONFIG` などの設定側で管理する前提
- Script Properties にはキャッシュや送信済みキーを保存する

## Refactoring Policy

- 大きな 1 ファイル構成のままでも、入口・取得・判定・表示の境界は守る
- 新しい機能追加時は、まず既存の責務へ乗るか確認する
- `10_reminderCore.gs` の weather / cache、`30_webappFlexEndpoint.gs` の renderer 群は今後の分割候補
